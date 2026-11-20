/* Single-document external Agent adapters. Deliberately owns no OCR/model client. */
(function (root) {
  'use strict';
  var protocol = root.AgentHandoffProtocol, workspace = root.AgentTaskWorkspace, renderGeneration = 0;
  var copy = function (value) { return JSON.parse(JSON.stringify(value)); };
  var names = { 'document-ocr': 'OCR 提取内容', 'document-translation': '对照翻译', 'document-qa': '问一问' };
  function context() {
    var kb = root.TransferContext.getKanban(), data = typeof currentData !== 'undefined' ? currentData : null;
    var idx = typeof pdfViewState !== 'undefined' ? pdfViewState.currentDocIdx : null;
    var doc = kb.documents.find(function (item) { return item.idx === idx; });
    if (!data || !doc || !doc.docId) throw new Error('请先打开一篇审查文档');
    var dossier = [data.office, data.applicationNumber || data.docNumber || data.raw].join(':');
    var attachment = root.TransferFileDock.describePayloads(data, [doc])[0];
    return { dossier: dossier, document: { id: String(doc.docId), idx: doc.idx, name: doc.name || doc.desc || doc.docCode, pages: Number(doc.numberOfPages) || 0 },
      attachment: { url: attachment.url, fileName: attachment.fileName }, extraction: copy(kb.extractions[idx] || null) };
  }
  function same(a, b) { return a.dossier === b.dossier && a.document.id === b.document.id && a.attachment.url === b.attachment.url; }
  function validate(task, payload) {
    function text(value) { return typeof value === 'string' && !!value.trim(); }
    if (task.taskType === 'document-ocr') {
      if (!Array.isArray(payload.pages) || !payload.pages.length) throw new Error('OCR 结果需要 pages：每页包含 page 和 text');
      var seen = new Set();
      payload.pages.forEach(function (page) {
        if (!Number.isInteger(page.page) || page.page < 1 || task.input.document.pages && page.page > task.input.document.pages || seen.has(page.page) || typeof page.text !== 'string') throw new Error('OCR 页码超出范围、重复或文字格式错误');
        seen.add(page.page);
      });
      if (!payload.pages.some(function (page) { return text(page.text); })) throw new Error('OCR 结果没有文字，请让 Agent 核对 PDF');
    } else if (task.taskType === 'document-translation') {
      if (!Array.isArray(payload.segments) || !payload.segments.length) throw new Error('翻译结果需要 segments：逐段的 sourceId、original 和 translated');
      var ids = new Set();
      payload.segments.forEach(function (segment) {
        var source = task.input.sources.find(function (source) { return source.id === segment.sourceId; });
        if (!source || ids.has(segment.sourceId) || segment.original !== source.text || !text(segment.translated)) throw new Error('译文原文与材料不匹配、缺少译文或编号重复');
        ids.add(segment.sourceId);
      });
      if (ids.size !== task.input.sources.length) throw new Error('译文没有完整覆盖所选内容，请补齐全部段落');
    } else {
      if (!text(payload.report)) throw new Error('回答需要非空 report');
      var sources = Array.isArray(task.input.sources) ? task.input.sources : [];
      var hasAttachment = !!(task.input.attachment && task.input.attachment.url);
      (payload.evidence || []).forEach(function (e) {
        if (!text(e.quote)) throw new Error('回答的引文需要非空 quote');
        var source = sources.find(function (s) { return s.id === e.sourceId; });
        if (source) {
          if (!source.text.includes(e.quote)) throw new Error('回答的引文无法在当前文档验证');
          return;
        }
        // 扫描件没有提取文本，或 Agent 直接引用 PDF 页码时，无法逐字比对。
        // 只要随任务带了 PDF，就允许把回答带回主页面，引文标记为“未验证”。
        if (!hasAttachment) throw new Error('回答的引文无法在当前文档验证');
      });
    }
    return payload;
  }
  function sourcesFor(snapshot, selected) {
    var ext = snapshot.extraction || {}, blocks = (ext.blocks || []).filter(function (b) { return !selected || selected.includes(b.block_id); });
    var sources = [];
    if (selected && !blocks.length) throw new Error('请先选择文档文本块');
    if (blocks.length) blocks.forEach(function (block) { sources.push.apply(sources, root.AgentSourceReferences.textSources('block:' + block.block_id, block.content || '', { blockId: block.block_id, page: block.page })); });
    else sources = root.AgentSourceReferences.textSources('document:text', ext.markdown || ext.text || '', {});
    return sources;
  }
  async function create(type, snapshot, question, language, selected) {
    var sources = type === 'document-ocr' ? [] : sourcesFor(snapshot, selected);
    if (type === 'document-translation' && !sources.length) throw new Error('当前文档尚无提取内容，请先交给 Agent 做 OCR，再进行对照翻译');
    if (type === 'document-qa' && !question.trim()) throw new Error('请填写想问 Agent 的问题');
    if (!sources.length && !snapshot.attachment.url) throw new Error('该文档没有可交接的 PDF 或提取内容');
    var instructions = type === 'document-ocr'
      ? '读取随任务附上的 PDF，逐页提取全文，保持表格和段落顺序。不编造无法识别的内容，使用 [无法辨认]。payload 返回 {"pages":[{"page":1,"text":"该页全文"}],"report":"识别情况"}。空白页也返回空 text；只处理了部分页时如实说明。'
      : type === 'document-translation'
        ? '将全部 sources 逐段翻译为 ' + language + '，保持术语、数字、权利要求和表格结构。每个来源返回一项，不合并或遗漏。payload 返回 {"segments":[{"sourceId":"来源编号","original":"来源 text 逐字复制","translated":"译文"}],"report":"翻译说明"}。'
        : '回答 input.question。依据当前文档 sources；没有提取内容时请读取附上的 PDF，并在回答中标注页码。不得编造引文。payload 返回 {"report":"中文回答，注明依据和不确定处","evidence":[{"sourceId":"来源编号","quote":"逐字引文"}]}，PDF 页码引用写在 report 中。';
    return protocol.create({ taskType: type, label: snapshot.document.name + ' · ' + names[type], input: Object.assign(copy(snapshot), { sources: sources, question: question || '', language: language || '', selected: selected || null }), target: {}, instructions: instructions });
  }
  function resultText(task, payload) {
    if (task.taskType === 'document-ocr') return payload.pages.slice().sort(function (a, b) { return a.page - b.page; }).map(function (p) { return '第 ' + p.page + ' 页\n' + p.text; }).join('\n\n');
    if (task.taskType === 'document-translation') return task.input.sources.map(function (s) { var segment = payload.segments.find(function (r) { return r.sourceId === s.id; }); return segment.original + '\n\n' + segment.translated; }).join('\n\n');
    return payload.report;
  }
  function apply(task, payload) { validate(task, payload); return '已收到结果，核对后点击「确认采用此版本」写回当前文档'; }
  function extractionFor(task, payload) {
    var pages = payload.pages.slice().sort(function (a, b) { return a.page - b.page; });
    return { text: pages.map(function (p) { return p.text; }).join('\n\n'), markdown: pages.map(function (p) { return p.text; }).join('\n\n'),
      blocks: pages.map(function (p) { return { block_id: 'agent-page-' + p.page, page: p.page, label: 'text', content: p.text }; }),
      engine: 'external-agent', ocrPages: pages.map(function (p) { return p.page; }), partial: !task.input.document.pages || pages.length < task.input.document.pages, pageDimensions: {}, agentTaskId: task.taskId };
  }
  function show(task, payload, activate) {
    var idx = task.input.document.idx, type = task.taskType;
    if (activate !== false) enterReadingMode(type === 'document-ocr' ? 'extract' : type === 'document-translation' ? 'translate' : 'chat');
    if (type === 'document-ocr') { updateExtractPanel(); return; }
    var content = document.getElementById(type === 'document-translation' ? 'pdf-translate-content' : 'chat-messages');
    if (type === 'document-translation') {
      content.replaceChildren();
      task.input.sources.forEach(function (source) {
        var segment = payload.segments.find(function (s) { return s.sourceId === source.id; });
        var row = document.createElement('section'); row.className = 'reader-agent-pair'; row.dataset.blockId = source.blockId || ''; row.dataset.page = source.page || '';
        [segment.original, segment.translated].forEach(function (text, i) { var p = document.createElement('p'); p.className = i ? 'reader-agent-translated' : 'reader-agent-original'; p.textContent = text; row.appendChild(p); }); content.appendChild(row);
      });
    } else {
      chatHistory.push({ role: 'user', content: task.input.question }, { role: 'assistant', content: payload.report });
      appendChatMessage('user', task.input.question); appendChatMessage('assistant', payload.report);
    }
    content.dataset.agentDocument = String(idx);
  }
  async function accept(task, payload, revisionHash) {
    validate(task, payload);
    var live = context();
    if (!same(live, task.input)) throw new Error('请打开创建任务时的同一案卷和审查文档后采用');
    var idx = live.document.idx, kb = root.TransferContext.getKanban(), old = kb.extractions[idx] || null;
    var stored = workspace.getStore().list().find(function (t) { return t.taskId === task.taskId; });
    var fingerprint = await protocol.hash(live.extraction), known = fingerprint === await protocol.hash(task.input.extraction);
    if (!known && task.taskType === 'document-ocr') {
      for (var revision of stored.revisions || []) if ((revision.acceptance || []).length && fingerprint === await protocol.hash(extractionFor(task, revision.payload))) known = true;
    }
    if (!known) throw new Error('文档提取内容已变化，请重新交接，避免覆盖新版本');
    stored.previousAnalyses = stored.previousAnalyses || [];
    stored.previousAnalyses.push({ savedAt: Date.now(), report: JSON.stringify({ extraction: old, readerResults: kanbanState.readerAgentResults || {} }, null, 2) });
    workspace.getStore().put(stored); await workspace.flush();
    var latest = context();
    if (!same(latest, live) || await protocol.hash(latest.extraction) !== await protocol.hash(live.extraction)) throw new Error('采用期间文档已切换或更新，请回到原文档重新采用');
    if (task.taskType === 'document-ocr') {
      kanbanState.extractions[idx] = extractionFor(task, payload);
      kanbanState.traceIndex = kanbanState.traceIndex || {};
      Object.keys(kanbanState.traceIndex).forEach(function (key) { if (key.startsWith('D' + idx + '_')) delete kanbanState.traceIndex[key]; });
      kanbanState.extractions[idx].blocks.forEach(function (b) { kanbanState.traceIndex['D' + idx + '_' + b.block_id] = { docIdx: idx, page: b.page, content: b.content, originalBlockId: b.block_id, label: b.label }; });
      root.selectReaderDoc(idx, true);
    }
    kanbanState.readerAgentResults = kanbanState.readerAgentResults || {};
    var resultKey = live.document.id + ':' + task.taskType + ':' + task.input.language;
    kanbanState.readerAgentResults[resultKey] = { taskId: task.taskId, hash: revisionHash, payload: copy(payload) };
    renderGeneration++; kanbanState.hasUnsavedWork = true; show(task, payload); autoSaveCache();
    return '已采用到「' + live.document.name + '」的' + names[task.taskType] + '；原内容已备份';
  }
  function attachmentDock(dialog) {
    var section = document.createElement('div'); section.className = 'reader-agent-attachment'; section.hidden = true;
    section.innerHTML = '<p>没有提取全文时，务必将 PDF 和指令一起发给 Agent。</p><button type="button" data-reader-pdf>准备 PDF 附件</button> <button type="button" data-reader-show hidden>打开文件位置</button><span role="status"></span>';
    dialog.querySelector('[data-step=send]').appendChild(section);
    var cache = new Map(), pending = new Set(), selectedId = '', button = section.querySelector('[data-reader-pdf]'), status = section.querySelector('[role=status]');
    function selected() { return workspace.getStore().list().find(function (t) { return t.taskId === dialog.querySelector('#agent-task-select').value; }); }
    function refresh(task) {
      section.hidden = !(task && task.input.attachment);
      if (!task) return;
      if (selectedId !== task.taskId) { selectedId = task.taskId; status.textContent = ''; }
      var result = cache.get(task.taskId);
      button.textContent = result ? '拖出 PDF 附件' : pending.has(task.taskId) ? '准备中…' : '准备 PDF 附件';
      button.disabled = pending.has(task.taskId); button.draggable = !!result;
      button.ondragstart = result ? function (event) { event.preventDefault(); root.TransferFileDock.startDrag(result.filePath); } : null;
      var show = section.querySelector('[data-reader-show]'); show.hidden = !result;
      show.onclick = result ? function () { root.TransferFileDock.showItem(result.filePath); } : null;
    }
    button.onclick = async function () {
      var task = selected(); if (!task || pending.has(task.taskId)) return;
      try {
        if (!task.input.attachment.url) throw new Error('该文档暂不支持导出 PDF，请从原文档下载后附上');
        pending.add(task.taskId); refresh(task); status.textContent = '正在准备 PDF…';
        var result = cache.get(task.taskId) || await root.TransferFileDock.exportPdf(task.taskId, task.input.attachment);
        if (!result || !result.ok) throw new Error(result && result.error || 'PDF 准备失败');
        cache.set(task.taskId, result);
        if (dialog.isConnected && selectedId === task.taskId) status.textContent = 'PDF 已就绪，可拖入 Agent';
      } catch (error) { if (dialog.isConnected && selectedId === task.taskId) status.textContent = error.message + '，可重试'; }
      finally { pending.delete(task.taskId); if (dialog.isConnected) refresh(selected()); }
    };
    return refresh;
  }
  function importTask(task, type) {
    root.AgentHandoffPanel.open({
      title: names[type] + ' · 带回 Agent 结果',
      description: '把 Agent 返回的结果粘贴或拖入下方，核对后采用。',
      taskType: type, store: workspace.getStore(), taskId: task.taskId, stage: 'receive',
      createTask: null, apply: apply, accept: accept
    });
  }
  async function open(type, selection) {
    var snapshot = context(), question = document.getElementById('chat-input').value.trim(), language = document.getElementById('pdf-translate-lang').value;
    var selected = selection ? (pdfViewState.selectedBlockIds || []).slice() : null;
    await workspace.ready;
    var task = await create(type, snapshot, question, language, selected);
    // 任务只用于可选的结果回流；失败也不影响本次「打包拖给 Agent」。
    var saved = true;
    try { workspace.getStore().put(task); } catch (error) { saved = false; console.warn('[Handoff] 保存任务失败，仍可打包：', error.message); }
    root.HandoffQuickPanel.open({
      title: names[type] + ' · 交给 Agent',
      prompt: protocol.prompt(task),
      attachment: task.input.attachment,
      baseName: snapshot.document.name + ' · ' + names[type],
      onImport: saved ? function () { importTask(task, type); } : null
    });
  }
  function warn(error) { if (typeof showToast === 'function') showToast(error.message); else root.alert(error.message); }
  function init() {
    Object.keys(names).forEach(function (type) { workspace.register(type, { apply: apply, accept: accept }); });
    var labels = { 'pdf-ocr-btn': 'OCR · Agent', 'pdf-translate-btn': '翻译 · Agent', 'pdf-translate-selection-btn': '译选 · Agent' };
    Object.keys(labels).forEach(function (id) { var button = document.getElementById(id); button.title = '将当前文档交给外部 Agent 处理'; button.querySelector('span').textContent = labels[id]; });
    document.querySelector('#reader-chat-panel .chat-title').textContent = '问一问 · Agent';
    document.querySelector('.right-panel-tab[data-panel=chat]').textContent = '问一问 · Agent';
    var hint = document.createElement('p'); hint.className = 'reader-agent-hint'; hint.textContent = '输入问题后交给 Agent，返回结果将在这里显示。Enter 准备任务，Shift+Enter 换行。'; document.querySelector('#reader-chat-panel .chat-input-area').before(hint);
    document.getElementById('chat-input').placeholder = '输入问题，交给 Agent 分析当前文档…';
    document.getElementById('chat-send-btn').title = '交给 Agent'; document.getElementById('chat-send-btn').textContent = '交给 Agent';
    var ask = document.getElementById('reader-chat-toggle'); ask.innerHTML = '问一问 · Agent'; ask.title = '针对当前审查文档向 Agent 提问';
    [['.reader-extract-header', 'reader-agent-ocr', '交给 Agent 提取'], ['.pdf-translate-header-actions', 'reader-agent-translate', '交给 Agent 翻译']].forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.id = item[1]; button.className = 'btn-secondary btn-small'; button.textContent = item[2]; document.querySelector(item[0]).appendChild(button);
    });
    document.addEventListener('click', function (event) {
      var button = event.target.closest('#pdf-ocr-btn,#pdf-translate-btn,#pdf-translate-selection-btn,#chat-send-btn,.extract-continue-ocr-btn,#reader-agent-ocr,#reader-agent-translate,#reader-chat-toggle');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (button.id === 'reader-chat-toggle') { enterReadingMode('chat'); return; }
      void open(button.id === 'chat-send-btn' ? 'document-qa' : button.id.includes('translate') ? 'document-translation' : 'document-ocr', button.id === 'pdf-translate-selection-btn').catch(warn);
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.target.id !== 'chat-input' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation(); void open('document-qa').catch(warn);
    }, true);
    // The ledger is the durable source for accepted translations and Q&A, including after restart.
    async function restore() {
      var version = ++renderGeneration, live;
      try { live = context(); } catch (_) { return; }
      await workspace.ready;
      var fingerprint = await protocol.hash(live.extraction), matches = [];
      for (var task of workspace.getStore().list().slice().reverse()) {
        if (!names[task.taskType] || task.taskType === 'document-ocr' || !same(live, task.input)) continue;
        var accepted = (task.revisions || []).filter(function (r) { return r.acceptance && r.acceptance.length; }).sort(function (a, b) { return b.acceptance.at(-1).at - a.acceptance.at(-1).at; })[0];
        if (accepted && await protocol.hash(task.input.extraction) === fingerprint) matches.push({ task: task, payload: accepted.payload });
      }
      if (version !== renderGeneration || !same(live, context())) return;
      document.getElementById('pdf-translate-content').replaceChildren(); document.getElementById('chat-messages').replaceChildren(); chatHistory = [];
      matches.forEach(function (m) { if (m.task.taskType !== 'document-translation' || m.task.input.language === document.getElementById('pdf-translate-lang').value) show(m.task, m.payload, false); });
    }
    var originalSelect = root.selectReaderDoc;
    root.selectReaderDoc = function () { var value = originalSelect.apply(this, arguments); void restore().catch(warn); return value; };
    document.getElementById('pdf-translate-lang').addEventListener('change', function () { void restore().catch(warn); });
  }
  root.ReaderAgentHandoff = { open: open, create: create, validate: validate, accept: accept, context: context, resultText: resultText, attachmentDock: attachmentDock };
  if (typeof module === 'object' && module.exports) module.exports = root.ReaderAgentHandoff;
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
})(globalThis);
