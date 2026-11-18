/* Structured external analysis adapters. No credentials or model network requests. */
(function (root) {
  'use strict';
  var refs = root.AgentSourceReferences, protocol = root.AgentHandoffProtocol, workspace = root.AgentTaskWorkspace;
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  function patent(scope) { return scope === 'popup' ? root._patentPopupData : root._currentPatentData; }
  function number(data) { return String(data && (data.patent_number || data.publication_number || data.application_number) || ''); }
  function supportInput(scope, indexes) {
    var data = patent(scope), api = root.ClaimSupportAnalysis;
    if (!data || !data.description) throw new Error('请打开包含说明书全文的专利');
    var claims = indexes.map(function (index) { var c = data.claims[index]; return c && { number: String(c.num || index + 1), text: String(c.text || ''), index: index }; }).filter(Boolean);
    if (!claims.length) throw new Error('请先在支撑面板选择权利要求');
    var id = number(data), sources = [];
    api.paragraphs(data.description).forEach(function (p, i) { sources.push.apply(sources, refs.textSources(id + ':description:' + i + ':' + p.id, p.text, { patentNumber: id, paragraph: p.id, ordinal: i })); });
    return { patentNumber: id, claims: claims, sources: sources };
  }
  function description(input) {
    var paragraphs = new Map();
    input.sources.forEach(function (s) { if (!paragraphs.has(s.ordinal)) paragraphs.set(s.ordinal, { id: s.paragraph, text: '' }); paragraphs.get(s.ordinal).text += s.text; });
    return Array.from(paragraphs.values()).map(function (p) { return '[' + p.id + '] ' + p.text; }).join('\n');
  }
  async function createSupport(scope) {
    var api = root.ClaimSupportAnalysis, panel = document.querySelector(scope === 'popup' ? '#ppv-content' : '#patent-detail-content');
    var indexes = api.selectedIndexes(scope).slice();
    if (!indexes.length) { var select = panel && panel.querySelector('.claim-support-select'); indexes = [Number(select && select.value || 0)]; }
    var input = supportInput(scope, indexes);
    return protocol.create({ taskType: 'claim-support', label: input.patentNumber + ' · ' + input.claims.length + ' 项支撑定位', input: input, target: { scope: scope },
      instructions: api.prompt() + '\n输入说明书已规范化为 sources；段落号为 paragraph 字段。最终 payload 改为 {"claims":[{"number":"权项号","result":上述 features/summary 结构}],"report":"总体核查摘要"}。必须返回每条输入权项，不遗漏任何限定。分包时只引用本包来源，不把缺少其他包证据认定为缺少公开。' });
  }
  function validateSupport(task, payload) {
    if (!Array.isArray(payload.claims) || payload.claims.length !== task.input.claims.length) throw new Error('支撑结果必须完整覆盖所选权项');
    var desc = description(task.input);
    return task.input.claims.map(function (claim) {
      var matches = payload.claims.filter(function (item) { return String(item.number) === claim.number; });
      if (matches.length !== 1) throw new Error('权项号遗漏或重复：' + claim.number);
      var raw = matches[0].result, result = root.ClaimSupportAnalysis.validateResult(raw, desc, claim.text);
      if (result.features.length !== raw.features.length) throw new Error('权项 ' + claim.number + ' 含无法在原文验证的特征');
      // Invalid quotes must be corrected rather than quietly presented as strong support.
      result.features.forEach(function (f, i) { if (f.evidence.length !== (raw.features[i].evidence || []).length) throw new Error('证据段落或引用不存在，请修正权项 ' + claim.number + ' 的证据'); if (!f.evidence.length && ['strong', 'partial'].includes(raw.features[i].status)) throw new Error('没有原文证据的特征必须标为 missing，请修正权项 ' + claim.number); });
      return { claim: claim, result: result };
    });
  }
  function mergeSupport(task, payloads) {
    var claims = task.input.claims.map(function (claim) {
      var features = new Map(), summaries = [];
      payloads.forEach(function (payload) {
        validateSupport(task, payload);
        var result = payload.claims.find(function (c) { return String(c.number) === claim.number; }).result;
        if (result.summary) summaries.push(result.summary);
        result.features.forEach(function (feature) {
          var key = String(feature.claimText).normalize('NFKC').replace(/\s+/g, ''), old = features.get(key);
          if (!old) features.set(key, clone(feature));
          else { old.evidence = (old.evidence || []).concat(feature.evidence || []).filter(function (e, i, all) { return all.findIndex(function (x) { return x.paragraph === e.paragraph && x.quote === e.quote; }) === i; }); if (old.evidence.length) old.status = 'partial'; }
        });
      });
      return { number: claim.number, result: { features: Array.from(features.values()).map(function (f, i) { f.id = 'F' + (i + 1); if (!f.evidence || !f.evidence.length) f.status = 'missing'; return f; }), summary: summaries.join('\n'), summaryZh: '分包证据已汇集；跨包特征边界及支持程度请在原文中复核。' } };
    });
    return { claims: claims, report: '分包支撑证据已合并；同义但不同原文边界的特征保留供人工复核。' };
  }
  async function acceptSupport(task, payload) {
    var checked = validateSupport(task, payload), scopes = ['detail', 'popup'], scope;
    for (var candidate of scopes) {
      if (number(patent(candidate)) !== task.input.patentNumber) continue;
      var input = supportInput(candidate, task.input.claims.map(function (c) { return c.index; }));
      if (await protocol.hash(input) === task.sourceHash) { scope = candidate; break; }
    }
    if (!scope) throw new Error('请打开与交接时一致的原专利、权项和说明书后采用');
    checked.forEach(function (item) { root.ClaimSupportAnalysis.accept(scope, item.claim.index, item.result); });
    return '已采用 ' + checked.length + ' 项支撑定位，可点击段落证据查看原文';
  }
  function reviewInput(selected) {
    var kb = root.TransferContext.getKanban(), data = typeof currentData !== 'undefined' ? currentData : null;
    var documents = kb.documents.filter(function (doc) { return selected.includes(doc.idx); });
    if (!documents.length) throw new Error('请先选择审查/答复文档');
    var sources = [], manifest = documents.map(function (doc) {
      var extraction = kb.extractions[doc.idx], text = extraction && (extraction.markdown || extraction.text) || '';
      var docId = String(doc.docId || [doc.docCode, doc.date, doc.name || doc.desc, doc.idx].join('|'));
      var meta = { documentId: docId, documentName: doc.name || doc.desc || doc.docCode || '文档', date: doc.date || '', docIdx: doc.idx };
      if (text.trim()) sources.push.apply(sources, refs.textSources('document:' + docId + ':text', text, meta));
      if (extraction && Array.isArray(extraction.blocks)) extraction.blocks.forEach(function (b) {
        sources.push.apply(sources, refs.textSources('document:' + docId + ':block:' + b.block_id, b.content || '', Object.assign({}, meta, { blockId: b.block_id, page: b.page || b.pageNum || null })));
      });
      return { id: docId, name: meta.documentName, date: meta.date, type: doc.type || '', idx: doc.idx, hasText: !!text.trim() || !!(extraction && extraction.blocks && extraction.blocks.length) };
    });
    if (!sources.length) throw new Error('所选文档尚无 OCR 全文，请先完成解析');
    // 把全案时间轴作为独立字段交给 Agent，保证报告能解释
    // 审查意见—答复—授权之间的日期和顺序，而不是只拿到几段 OCR。
    var timeline;
    if (root.TransferContext && typeof root.TransferContext.renderTimelineTable === 'function') {
      timeline = root.TransferContext.renderTimelineTable(data && data.office, kb.documents || []);
    } else {
      timeline = (kb.documents || []).slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }).map(function (doc, i) {
        return (i + 1) + '. ' + (doc.date || '—') + ' · ' + (doc.docCode || '') + ' · ' + (doc.name || doc.desc || '') + ' · ' + (doc.type || '');
      }).join('\n');
    }
    return { patentNumber: number(data) || String(data && data.applicationNumber || ''), timeline: timeline, documents: manifest, sources: sources };
  }
  async function createReview(instructions, selectedOverride) {
    var kb = root.TransferContext.getKanban(), selected = typeof _kanbanSelected !== 'undefined' && _kanbanSelected.size ? Array.from(_kanbanSelected) : kb.documents.map(function (d) { return d.idx; });
    var input = reviewInput(selectedOverride || selected);
    return protocol.create({ taskType: 'review-report', label: (input.patentNumber || '案卷') + ' · 审查与答复分析', input: input, target: {},
      instructions: '按日期梳理审查意见—申请人答复—修改—授权的链条，分析争议焦点、权项变化、引用文献和仍待确认的问题。输入中的 timeline 是全案时间轴，必须先据此建立事件顺序。没有OCR全文的文档只列为材料缺口。不得把推测当事实；每个关键结论提供 sourceId 和原文 quote。输出 {"report":"中文 Markdown 报告，使用 ### 分节","evidence":[{"sourceId":"输入编号","quote":"逐字引文","explanation":"关联结论"}]}。分包报告明确本包覆盖范围，合并不推断未读材料。\n补充要求：' + instructions });
  }
  function reviewView(task, result) {
    var container = document.getElementById('kanban-analysis-content'); if (!container) return;
    container.replaceChildren(); container.dataset.agentReport = task.taskId; var pre = document.createElement('div'); pre.className = 'kanban-analysis-content markdown-body agent-return-report';
    if (typeof renderAnalysisModules === 'function') { pre.innerHTML = renderAnalysisModules(savedReview(task, result)); pre.querySelectorAll('.analysis-module-regen-btn').forEach(function (button) { button.remove(); }); }
    else { pre.style.whiteSpace = 'pre-wrap'; pre.textContent = result.report; } container.appendChild(pre);
    result.evidence.forEach(function (item) {
      var source = task.input.sources.find(function (s) { return s.id === item.sourceId; });
      var button = document.createElement('button'); button.textContent = source.documentName + ' · ' + item.quote.slice(0, 60); button.onclick = function () { refs.view(source, item.quote); }; container.appendChild(button);
    });
  }
  function savedReview(task, result) {
    var text = result.report + (result.evidence.length ? '\n\n### 原文证据\n' + result.evidence.map(function (e) { var s = task.input.sources.find(function (s) { return s.id === e.sourceId; }); return '[' + s.id + '] ' + s.documentName + '\n' + e.quote + '\n' + e.explanation; }).join('\n\n') : '');
    // Existing cache readers use raw Markdown HTML. Neutralize HTML and links at this boundary.
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
  }
  async function acceptReview(task, payload) {
    var result = refs.report(task, payload), input = reviewInput(task.input.documents.map(function (d) { return d.idx; }));
    if (!Object.prototype.hasOwnProperty.call(task.input, 'timeline')) delete input.timeline;
    if (await protocol.hash(input) !== task.sourceHash) throw new Error('当前案卷或 OCR 原文已经变化，请打开原案卷或重新创建任务');
    var kb = root.TransferContext.getKanban();
    if (kb.analysis && kb.analysis !== savedReview(task, result)) { var saved = workspace.getStore().list().find(function (t) { return t.taskId === task.taskId; }); saved.previousAnalyses = saved.previousAnalyses || []; if (!saved.previousAnalyses.some(function (p) { return p.report === kb.analysis; })) saved.previousAnalyses.push({ report: kb.analysis, savedAt: Date.now() }); workspace.getStore().put(saved); await workspace.flush(); }
    kb.analysis = savedReview(task, result); kb.hasUnsavedWork = true; kb.lastAnalyzedIdxs = task.input.documents.map(function (d) { return d.idx; });
    kb.analysisSystemPrompt = task.instructions; kb.analysisUserMessage = protocol.prompt(task);
    if (typeof analysisChatHistory !== 'undefined') analysisChatHistory = [];
    reviewView(task, result);
    if (typeof autoSaveCache === 'function') autoSaveCache();
    if (typeof showAnalysisChatToggle === 'function') showAnalysisChatToggle();
    return '已采用为当前审查分析；原分析已保存在任务备份中';
  }
  function shareInput(ids, mode) {
    var store = root.PatentShareStore, project = store.getSnapshot(), patents = project.patents.filter(function (p) { return ids.includes(p.id); }), sources = [];
    if (!patents.length) throw new Error('请先将专利加入分享项目并选中');
    var selectedField = mode.startsWith('custom:') ? mode.slice(7) : '', globalScope = store.getAIContextScope();
    var records = patents.map(function (p) {
      var field = (p.processedFields || []).find(function (f) { return f.id === selectedField; });
      if (selectedField && !field) throw new Error('加工字段已删除或属于其他专利，请仅选择对应专利');
      var scope = field && field.contextScope || globalScope, meta = { patentId: p.id, patentNumber: p.patentNumber };
      function add(kind, text, more) { sources.push.apply(sources, refs.textSources(p.id + ':' + kind, text, Object.assign({}, meta, more))); }
      if (scope.abstract) add('abstract', p.fields && p.fields.abstract && p.fields.abstract.value || '');
      if (scope.claims) (p.claims || []).forEach(function (c, i) { add('claim:' + i, c.text, { claimNumber: c.number || i + 1 }); });
      if (scope.description) add('description', p.description || '');
      if (scope.annotations) add('annotations', JSON.stringify({ claims: p.claimsAnnotations || [], description: p.descriptionAnnotations || [] }));
      return { id: p.id, patentNumber: p.patentNumber, scope: scope, fieldId: field && field.id || '', fieldLabel: field && field.label || '', fieldPrompt: field && field.prompt || '' };
    });
    if (!sources.some(function (s) { return s.text.trim(); })) throw new Error('所选原文范围没有可分析内容');
    return { projectId: project.id, mode: mode, patents: records, sources: sources };
  }
  async function createShare(ids, mode, extra) {
    var input = shareInput(ids, mode), prompt = mode.startsWith('custom:') ? input.patents.map(function (p) { return p.fieldLabel + '\n' + p.fieldPrompt; }).join('\n') : root.PatentShareAI.getAIPrompt(mode);
    if (mode === 'comparison' && input.patents.length < 2) throw new Error('多专利比较至少需要两篇专利');
    var modeLabel = { summary: '技术解读', elements: '技术要素', embodiments: '实施例分析', comparison: '多专利比较' }[mode] || input.patents[0].fieldLabel;
    return protocol.create({ taskType: 'share-processing', label: '分享加工 · ' + modeLabel + ' · ' + input.patents.length + ' 篇', input: input, target: { projectId: input.projectId },
      instructions: prompt + '\n' + extra + '\n仅根据输入 sources 工作，尊重每篇的 scope 和 fieldPrompt。最终 payload 为 {"report":"总体说明或多专利比较报告","items":[{"patentId":"输入专利ID","content":"可编辑的中文解读/技术要素/实施例/自定义字段结果"}],"evidence":[{"sourceId":"原文ID","quote":"逐字引文","explanation":"对应结论"}]}。每篇输入专利恰好返回一个 item；不在本包的材料注明未覆盖。' });
  }
  function validateShare(task, payload) {
    var result = refs.report(task, payload);
    if (!Array.isArray(payload.items) || payload.items.length !== task.input.patents.length) throw new Error('加工结果需完整返回每篇专利的 items');
    task.input.patents.forEach(function (patent) { var matches = payload.items.filter(function (i) { return i.patentId === patent.id; }); if (matches.length !== 1 || typeof matches[0].content !== 'string' || !matches[0].content.trim() || matches[0].content.length > 200000) throw new Error('专利加工内容缺失、重复或过长：' + patent.patentNumber); });
    return result;
  }
  function mergeShare(task, payloads) {
    payloads.forEach(function (p) { validateShare(task, p); });
    var merged = refs.mergeReports(task, payloads);
    merged.items = task.input.patents.map(function (p) { return { patentId: p.id, content: payloads.map(function (part, i) { return '### 材料分包 ' + (i + 1) + '\n' + part.items.find(function (item) { return item.patentId === p.id; }).content; }).join('\n\n') }; }); return merged;
  }
  async function acceptShare(task, payload, hash) {
    validateShare(task, payload);
    var input = shareInput(task.input.patents.map(function (p) { return p.id; }), task.input.mode);
    if (await protocol.hash(input) !== task.sourceHash) throw new Error('请打开原分享项目，保持原文、范围和字段提示词一致后采用');
    var store = root.PatentShareStore, project = store.getSnapshot(), label = { summary: '技术解读', elements: '技术要素', embodiments: '实施例', comparison: '多专利比较' }[task.input.mode] || task.input.patents[0].fieldLabel || '自定义加工';
    // Append drafts instead of overwriting accepted or manually edited content.
    payload.items.forEach(function (item) {
      var p = project.patents.find(function (p) { return p.id === item.patentId; }), snapshot = task.input.patents.find(function (p) { return p.id === item.patentId; });
      var existing = (p.processedFields || []).find(function (f) { return f.agentTaskId === task.taskId && f.agentResultHash === hash; });
      if (existing) return;
      var created = store.addProcessedField(item.patentId, label + ' · Agent', snapshot.fieldPrompt || root.PatentShareAI.getAIPrompt(task.input.mode), 'text', snapshot.scope);
      if (!created.ok) throw new Error('无法创建分享加工草稿');
      store.updateProcessedField(item.patentId, created.field.id, { value: task.input.mode === 'comparison' ? payload.report + '\n\n' + item.content : item.content,
        source: 'ai', model: 'External Agent', agentTaskId: task.taskId, agentResultHash: hash, reviewState: 'pending', generatedAt: new Date().toISOString(), evidence: (payload.evidence || []).filter(function (e) { return task.input.sources.some(function (s) { return s.id === e.sourceId && s.patentId === item.patentId; }); }).map(function (e) { return { source: p.patentNumber + ' · Agent', locator: e.sourceId, quote: e.quote }; }) });
    });
    await store.flush();
    if (store.getPersistenceState && store.getPersistenceState().mode !== 'indexeddb') throw new Error('分享草稿尚未保存到磁盘；结果已保留在任务台账，请处理分享项目的存储问题后重试');
    return '已追加 ' + payload.items.length + ' 个可编辑加工草稿；请在分享工作台审核确认后发布';
  }
  var routes = {
    'claim-support': { apply: async function (task, p) { validateSupport(task, p); return '支撑结果已校验并保存版本；展开结果版本后采用'; }, accept: acceptSupport, merge: mergeSupport },
    'review-report': { apply: async function (task, p) { refs.report(task, p); return '审查报告已保存为待审核版本；采用后写入当前分析'; }, accept: acceptReview, merge: refs.mergeReports },
    'share-processing': { apply: async function (task, p) { validateShare(task, p); return '分享加工结果已保存版本；采用后追加草稿供审核'; }, accept: acceptShare, merge: mergeShare },
    report: { apply: async function (task, p) { refs.report(task, p); return '通用报告已保存，可查看原文证据或编辑修订'; }, accept: async function (task, p) { refs.report(task, p); return '报告已审核采用'; }, merge: refs.mergeReports }
  };
  Object.keys(routes).forEach(function (type) { workspace.register(type, routes[type]); });
  refs.setLocator(function (source) {
    if (source.documentId && source.blockId && typeof onTraceClick === 'function') {
      var kb = root.TransferContext.getKanban(), doc = kb.documents.find(function (d) { return String(d.docId) === source.documentId; });
      var ext = doc && kb.extractions[doc.idx], block = ext && (ext.blocks || []).find(function (b) { return b.block_id === source.blockId && String(b.content).includes(source.text); });
      if (block && kb.traceIndex && kb.traceIndex['D' + doc.idx + '_' + block.block_id]) return function () { onTraceClick('D' + doc.idx + '_' + block.block_id); };
    }
    if (source.paragraph) for (var scope of ['detail', 'popup']) {
      var data = patent(scope);
      if (number(data) === source.patentNumber && root.ClaimSupportAnalysis.paragraphs(data.description).some(function (p) { return p.id === source.paragraph && p.text.includes(source.text); })) return (function (selected) { return function () { root.ClaimSupportAnalysis.locate(selected, source.paragraph); }; })(scope);
    }
    return null;
  });
  async function open(type, scope) {
    await workspace.ready;
    var mode = 'summary', ids = [], extra = '', route = routes[type];
    if (type === 'share-processing') ids = root.PatentShareStore.getSnapshot().patents.map(function (p) { return p.id; });
    root.AgentHandoffPanel.open(Object.assign({ title: { 'claim-support': 'Agent 权利要求支撑定位', 'review-report': 'Agent 审查与答复分析', 'share-processing': 'Agent 分享内容加工' }[type],
      description: '准备材料 → 交给外部 Agent → 拖回结果 → 查看版本和证据 → 采用。无需 API；长文可选择分包交接。', taskType: type, reviewFirst: true, store: workspace.getStore(),
      createTask: function () { return type === 'claim-support' ? createSupport(scope) : type === 'review-report' ? createReview(extra, scope && scope.selectedIdxs) : createShare(ids, mode, extra); },
      configure: function (dialog) {
        var config = document.createElement('div'); config.className = 'agent-report-config';
        var instruction = document.createElement('textarea'); instruction.placeholder = '补充分析要求（可选）'; instruction.setAttribute('aria-label', '补充分析要求'); instruction.style.minHeight = '60px'; instruction.oninput = function () { extra = instruction.value; };
        if (type === 'share-processing') {
          var select = document.createElement('select'); select.setAttribute('aria-label', '分享加工类型');
          [['summary','技术解读'],['elements','技术要素'],['embodiments','实施例分析'],['comparison','多专利比较']].forEach(function (pair) { var o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1]; select.appendChild(o); });
          var patents = root.PatentShareStore.getSnapshot().patents;
          patents.forEach(function (p) { (p.processedFields || []).forEach(function (field) { var o = document.createElement('option'); o.value = 'custom:' + field.id; o.textContent = p.patentNumber + ' · ' + field.label; select.appendChild(o); }); });
          select.onchange = function () { mode = select.value; }; config.appendChild(select);
          patents.forEach(function (p) { var label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.onchange = function () { ids = check.checked ? ids.concat(p.id) : ids.filter(function (id) { return id !== p.id; }); }; label.appendChild(check); label.appendChild(document.createTextNode(p.patentNumber + ' ')); config.appendChild(label); });
        }
        if (type !== 'claim-support') config.appendChild(instruction);
        dialog.querySelector('[data-step="prepare"]').prepend(config);
      }
    }, route));
  }
  function button(host, type, scope, label) {
    if (!host || host.querySelector('[data-agent-report="' + type + '"]')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary btn-small'; b.dataset.agentReport = type; b.textContent = label;
    b.onclick = function () { open(type, scope).catch(function (error) { root.alert(error.message); }); }; host.prepend(b);
  }
  function ensure() {
    ['detail', 'popup'].forEach(function (scope) { var parent = document.querySelector(scope === 'popup' ? '#ppv-content' : '#patent-detail-content'); button(parent && parent.querySelector('.claim-support-toolbar'), 'claim-support', scope, '交给 Agent / 导入'); });
    button(document.querySelector('.share-workspace-header-actions'), 'share-processing', '', 'Agent 加工 / 导入');
    var container = document.getElementById('kanban-analysis-content');
    if (container && !container.querySelector('.agent-return-report')) {
      try {
        var analysis = root.TransferContext.getKanban().analysis;
        if (analysis) workspace.getStore().list().filter(function (t) { return t.taskType === 'review-report'; }).some(function (task) {
          return (task.revisions || []).some(function (revision) { if ((revision.acceptance || []).length && savedReview(task, refs.report(task, revision.payload)) === analysis) { reviewView(task, refs.report(task, revision.payload)); return true; } return false; });
        });
      } catch (_) { /* The workspace may still be hydrating. */ }
    }
  }
  function init() { ensure(); var timer; new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(ensure, 60); }).observe(document.body, { childList: true, subtree: true }); }
  root.AgentReportHandoff = { open: open, createSupport: createSupport, createReview: createReview, createShare: createShare, routes: routes, ensure: ensure, supportInput: supportInput, reviewInput: reviewInput, shareInput: shareInput };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis);
