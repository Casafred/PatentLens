(function (root) {
  'use strict';
  function download(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    var link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  async function copy(text) {
    var bridge = root.electronAPI;
    if (!bridge && root.parent && root.parent.location.origin === root.location.origin) bridge = root.parent.electronAPI;
    if (bridge && bridge.agentHandoffCopyText) {
      var copied = await bridge.agentHandoffCopyText(text);
      if (!copied || !copied.ok) throw new Error('复制失败，请下载任务文件');
      return;
    }
    if (bridge && bridge.copyToClipboard) {
      var result = await bridge.copyToClipboard(text);
      if (result === true || result && result.ok === true) return;
    }
    await navigator.clipboard.writeText(text);
  }
  function open(options) {
    var existing = document.querySelector('.agent-task-overlay');
    if (existing) { existing.focus(); return; }
    if (!document.getElementById('agent-task-style')) {
      var style = document.createElement('style'); style.id = 'agent-task-style';
      style.textContent = '.agent-task-overlay{position:fixed;inset:0;background:#0007;z-index:16000;display:grid;place-items:center;padding:20px;font:14px/1.6 system-ui;color:var(--text-primary,#172033)}.agent-task-dialog{background:var(--bg-primary,#fff);border:1px solid var(--border-color,#ccd5e1);border-radius:16px;width:min(920px,100%);max-height:90vh;overflow:auto;padding:24px;box-shadow:0 18px 70px #0004}.agent-task-dialog h2{font-size:20px;margin:0}.agent-task-dialog p{margin:8px 0 14px;color:var(--text-secondary,#617085)}.agent-task-header,.agent-task-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.agent-task-header{justify-content:space-between}.agent-task-dialog button{font:inherit;border:1px solid var(--border-color,#cbd5e1);background:var(--bg-secondary,#f1f5f9);color:inherit;border-radius:7px;padding:7px 12px;cursor:pointer}.agent-task-dialog button:disabled{opacity:.5;cursor:wait}.agent-task-dialog .agent-task-primary{background:#167756;color:white;border-color:#167756}.agent-task-dialog select,.agent-task-dialog textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:var(--bg-secondary,#f8fafc);border:1px solid var(--border-color,#cbd5e1);border-radius:8px;padding:10px}.agent-task-dialog textarea{resize:vertical;min-height:160px}.agent-task-drop{margin:18px 0 10px;padding:18px;border:2px dashed #88b6a6;border-radius:10px;background:#12805b0a}.agent-task-drop.dragging{background:#12805b22}.agent-task-status{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;min-height:24px}.agent-task-status.error{color:#c43535}.agent-task-status.success{color:#16815c}.agent-task-step{display:block;margin:18px 0 8px;font-weight:650}.agent-task-dialog summary{cursor:pointer}.agent-task-dialog details textarea{min-height:120px}.agent-task-dialog .agent-task-close{font-size:20px;line-height:1}';
      document.head.appendChild(style);
    }
    if (!document.getElementById('agent-workflow-style')) {
      var workflowStyle = document.createElement('style'); workflowStyle.id = 'agent-workflow-style';
      workflowStyle.textContent = [
        '.agent-task-overlay{z-index:100060;box-sizing:border-box;padding:20px}',
        '.agent-task-dialog{box-sizing:border-box;padding:24px;width:min(860px,100%);max-height:calc(100dvh - 40px)}',
        '.agent-task-dialog [hidden]{display:none!important}',
        '.agent-task-header{position:sticky;top:-24px;background:var(--bg-primary,#fff);z-index:2;padding:12px 0}',
        '.agent-task-description{font-size:13px}.agent-task-selector{display:flex;align-items:center;gap:12px;margin:16px 0}',
        '.agent-task-selector label{flex-shrink:0;font-weight:600}.agent-task-selector select{min-width:0}',
        '.agent-task-nav{display:flex;gap:8px;margin:20px 0}.agent-task-nav button{flex:1;text-align:left;padding:12px}',
        '.agent-task-nav button[aria-selected=true]{border-color:#16815c;background:#16815c18;color:var(--accent,#16815c);font-weight:700}',
        '.agent-task-context{border:1px solid var(--border-color,#cbd5e1);border-radius:12px;padding:16px;margin-bottom:18px}',
        '.agent-task-context strong{display:block;font-size:16px}.agent-task-context p{margin:5px 0 0}',
        '.agent-task-stage h3{font-size:17px;margin:0 0 8px}.agent-task-stage>p{font-size:13px}',
        '.agent-task-stage .agent-task-actions{margin:14px 0}.agent-task-stage details{margin:14px 0}',
        '.agent-task-stage textarea{min-height:100px}.agent-task-stage .agent-task-prompt{min-height:220px}',
        '.agent-task-history{border-top:1px solid var(--border-color,#cbd5e1);padding-top:16px}',
        '.agent-task-history>summary{font-weight:650}.agent-task-tools{border-top:1px solid var(--border-color,#cbd5e1);padding-top:16px;margin-top:22px;font-size:13px}',
        '.agent-task-tools .agent-task-actions{margin-top:12px}.agent-task-status:empty{display:none}',
        '.agent-task-status{padding:10px 12px;border-radius:8px;background:#16815c0c}.agent-task-status.error{background:#c435350c}',
        '.agent-task-status.success{color:var(--accent,#16815c)}.agent-task-status.error{color:var(--danger,#c43535)}',
        '.agent-task-dialog,.agent-task-dialog button,.agent-task-dialog select,.agent-task-dialog textarea,.agent-task-context,.agent-task-history,.agent-task-tools{border-color:var(--border,#cbd5e1)}',
        '.agent-task-acceptance{font-size:12px;white-space:pre-wrap}.agent-task-empty{padding:16px;background:#16815c0a;border-radius:10px}',
        '.agent-task-report{font:inherit;line-height:1.7;overflow-wrap:anywhere}.agent-report-config{margin-bottom:14px}',
        '.agent-task-dialog button:focus-visible,.agent-task-dialog summary:focus-visible{outline:2px solid #16815c;outline-offset:3px}',
        '@media(max-width:600px){.agent-task-overlay{padding:8px}.agent-task-dialog{padding:16px;max-height:calc(100dvh - 16px)}.agent-task-header{top:-16px}.agent-task-nav{gap:4px}.agent-task-nav button{font-size:12px;padding:10px 6px}.agent-task-selector{display:block}}'
      ].join('');
      document.head.appendChild(workflowStyle);
    }
    var previous = document.activeElement;
    var overlay = document.createElement('div'); overlay.className = 'agent-task-overlay'; overlay.tabIndex = -1;
    overlay.innerHTML = `<section class="agent-task-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-task-title">
      <header class="agent-task-header"><h2 id="agent-task-title"></h2><button type="button" class="agent-task-close" aria-label="关闭">×</button></header>
      <p class="agent-task-description"></p>
      <div class="agent-task-selector"><label for="agent-task-select">继续已有任务</label><select id="agent-task-select" aria-label="交接任务"></select></div>
      <nav class="agent-task-nav" role="tablist" aria-label="Agent 操作步骤">
        <button type="button" role="tab" data-stage="prepare" id="agent-tab-prepare" aria-controls="agent-stage-prepare">1　准备材料</button>
        <button type="button" role="tab" data-stage="send" id="agent-tab-send" aria-controls="agent-stage-send">2　交给 Agent</button>
        <button type="button" role="tab" data-stage="receive" id="agent-tab-receive" aria-controls="agent-stage-receive">3　带回结果</button>
      </nav>
      <div class="agent-task-context"><strong></strong><p></p></div>
      <div role="status" aria-live="polite" class="agent-task-status"></div>
      <section class="agent-task-stage" data-step="prepare" id="agent-stage-prepare" role="tabpanel" aria-labelledby="agent-tab-prepare">
        <h3 class="agent-task-step">准备这次任务的材料</h3><p>从当前工作台创建任务，保存本次使用的原文。已有任务可直接进入下一步。</p>
        <div class="agent-task-actions"><button type="button" data-action="create" class="agent-task-primary">准备新任务</button><button type="button" data-next="send">继续当前任务 →</button></div>
      </section>
      <section class="agent-task-stage" data-step="send" id="agent-stage-send" role="tabpanel" aria-labelledby="agent-tab-send" hidden>
        <h3>复制后，发到你常用的 Agent</h3><p>打开外部 Agent 聊天窗口，粘贴任务并发送。指令已包含原文、分析要求和结果格式。</p>
        <div data-role="part-selector"><label class="agent-task-step">材料较长时，可分批发送</label><select class="agent-task-parts" aria-label="材料分包"></select><p>选择完整材料一次发送，或逐包发送并将各包结果依次导入。</p></div>
        <div class="agent-task-actions"><button type="button" data-action="copy" class="agent-task-primary">复制任务与材料</button><button type="button" data-action="download">下载为文件</button></div>
        <details><summary>查看将发送的内容</summary><textarea class="agent-task-prompt" readonly aria-label="任务指令"></textarea></details>
        <div class="agent-task-actions"><button type="button" data-next="receive">Agent 已回答，带回结果 →</button></div>
      </section>
      <section class="agent-task-stage" data-step="receive" id="agent-stage-receive" role="tabpanel" aria-labelledby="agent-tab-receive" hidden>
        <h3>查看或导入 Agent 的回答</h3><div data-role="results"></div>
        <details class="agent-task-importer" open><summary>导入 Agent 的回答</summary>
        <div class="agent-task-drop"><b>将结果文件拖到这里</b><p>支持 JSON、TXT、Markdown；也可以粘贴 Agent 的完整回答。</p><button type="button" data-action="file">选择结果文件</button><input class="agent-task-file" type="file" accept=".json,.txt,.md" hidden></div>
        <textarea class="agent-task-result" aria-label="Agent 返回结果" placeholder="粘贴 Agent 的完整回答…"></textarea>
        <div class="agent-task-actions"><button type="button" data-action="import" class="agent-task-primary">导入并查看结果</button></div>
        <details class="agent-task-recovery" hidden><summary>回答格式需要修正</summary><p>复制修正请求发给同一个 Agent，再带回它的新回答。</p><div class="agent-task-actions"><button type="button" data-action="repair">复制修正请求</button><button type="button" data-action="raw">保存原始回答</button></div></details>
        </details>
      </section>
      <details class="agent-task-tools"><summary>任务管理与备份</summary><div class="agent-task-actions"><button data-action="bundle-export">备份全部任务</button><button data-action="bundle-import">恢复任务备份</button><button data-action="remove">删除当前任务</button><input class="agent-bundle-file" type="file" accept=".json" hidden></div></details>
    </section>`;
    document.body.appendChild(overlay);
    var dialog = overlay.querySelector('section'), select = dialog.querySelector('#agent-task-select'), textarea = dialog.querySelector('.agent-task-result');
    var status = dialog.querySelector('.agent-task-status'), input = dialog.querySelector('.agent-task-file');
    var busy = false, currentId = options.taskId || '', lastError = '';
    var extra = document.createElement('div');
    extra.innerHTML = '<details class="agent-task-history"><summary>查看结果与原文证据</summary><label class="agent-task-step">结果版本</label><select class="agent-task-revisions" aria-label="结果版本"></select><pre class="agent-task-report" style="white-space:pre-wrap;max-height:300px;overflow:auto"></pre><div class="agent-task-evidence"></div><textarea class="agent-task-edit" aria-label="编辑结果 JSON"></textarea><div class="agent-task-actions"><button data-action="revise">保存修订版本</button><button data-action="accept">确认采用此版本</button><button data-action="rebind">绑定当前画布（迁移后）</button></div><div class="agent-task-acceptance"></div></details>';
    dialog.querySelector('[data-role="results"]').appendChild(extra);
    var parts = dialog.querySelector('.agent-task-parts'), revisions = extra.querySelector('.agent-task-revisions'), edit = extra.querySelector('.agent-task-edit');
    var advanced = document.createElement('details'), advancedTitle = document.createElement('summary'); advancedTitle.textContent = '修订结构化结果（高级）'; advanced.appendChild(advancedTitle);
    edit.parentNode.insertBefore(advanced, edit); advanced.append(edit, extra.querySelector('[data-action="revise"]'));
    extra.querySelector('[data-action="accept"]').className = 'agent-task-primary';
    var backup = document.createElement('details'); backup.innerHTML = '<summary>采用前的原分析备份</summary><select class="agent-task-backups" aria-label="原分析备份"></select><pre style="white-space:pre-wrap;max-height:200px;overflow:auto"></pre><button data-action="backup">下载选中备份</button>'; extra.appendChild(backup);
    function showBackup() { var task = current(), item = task && (task.previousAnalyses || [])[Number(backup.querySelector('select').value)]; backup.querySelector('pre').textContent = item ? item.report : ''; }
    backup.querySelector('select').addEventListener('change', showBackup);
    function prompt(task) { return root.AgentHandoffProtocol.prompt(task, parts.value); }
    dialog.querySelector('h2').textContent = options.title;
    dialog.querySelector('.agent-task-description').textContent = options.description;
    if (options.configure) options.configure(dialog);
    var refreshAttachment = root.ReaderAgentHandoff ? root.ReaderAgentHandoff.attachmentDock(dialog) : null;
    var stage = '';
    function setStage(value) {
      stage = value;
      if (value === 'receive' && !(current() && (current().revisions || []).length)) dialog.querySelector('.agent-task-importer').open = true;
      dialog.querySelectorAll('[data-step]').forEach(function (section) { section.hidden = section.dataset.step !== value; });
      dialog.querySelectorAll('[data-stage]').forEach(function (button) { var active = button.dataset.stage === value; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
      dialog.scrollTop = 0;
    }
    dialog.querySelectorAll('[data-stage],[data-next]').forEach(function (button) { button.addEventListener('click', function () { setStage(button.dataset.stage || button.dataset.next); }); });
    dialog.querySelector('.agent-task-nav').addEventListener('keydown', function (event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      var tabs = Array.from(this.querySelectorAll('button')), index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setStage(tabs[index].dataset.stage); tabs[index].focus();
    });
    function message(text, error) { status.textContent = text; status.className = 'agent-task-status ' + (error ? 'error' : 'success'); dialog.querySelector('.agent-task-recovery').hidden = !error; if (error && stage === 'receive') dialog.querySelector('.agent-task-importer').open = true; dialog.scrollTop = 0; }
    function rows() { return options.store.list().filter(function (task) { return !options.taskType || task.taskType === options.taskType; }); }
    function current() { return rows().find(function (task) { return task.taskId === select.value; }); }
    function readable(task, revision) {
      if (root.ReaderAgentHandoff && task.taskType.startsWith('document-')) return root.ReaderAgentHandoff.resultText(task, revision.payload);
      var p = revision.payload, lines = [p.report || p.summary || ''];
      if (Array.isArray(p.items)) p.items.forEach(function (item) { var source = (task.input.patents || []).find(function (patent) { return patent.id === item.patentId; }); lines.push('\n' + (source ? source.patentNumber : item.patentId) + '\n' + item.content); });
      if (Array.isArray(p.claims)) p.claims.forEach(function (claim) { if (!claim.result) return; lines.push('\n权利要求 ' + claim.number + '\n' + (claim.result.summaryZh || claim.result.summary || '')); (claim.result.features || []).forEach(function (feature, i) { lines.push((i + 1) + '. ' + (feature.claimTextZh || feature.claimText) + ' · ' + ({ strong: '明确对应', partial: '部分对应', missing: '待核查' }[feature.status] || '待核查')); (feature.evidence || []).forEach(function (e) { lines.push('[' + e.paragraph + '] ' + (e.quoteZh || e.quote)); }); }); });
      if (Array.isArray(p.changes)) lines.push(p.changes.join('\n'));
      return lines.filter(Boolean).join('\n') || revision.outcome || '';
    }
    function showRevision() {
      var task = current(), revision = task && (task.revisions || []).find(function (row) { return row.hash === revisions.value; });
      edit.value = revision ? JSON.stringify(revision.payload, null, 2) : '';
      extra.querySelector('.agent-task-report').textContent = revision ? readable(task, revision) : '尚无完整回流版本';
      extra.querySelector('.agent-task-acceptance').textContent = revision ? (revision.acceptance || []).map(function (entry) { return new Date(entry.at).toLocaleString() + ' · ' + entry.note; }).join('\n') : '';
      var evidence = extra.querySelector('.agent-task-evidence'); evidence.replaceChildren();
      if (revision && root.AgentSourceReferences) (revision.payload.evidence || []).forEach(function (item) {
        var source = (task.input.sources || []).find(function (s) { return s.id === item.sourceId; }); if (!source) return;
        var button = document.createElement('button'); button.textContent = source.id + ' · ' + item.quote.slice(0, 50); button.onclick = function () { root.AgentSourceReferences.view(source, item.quote); }; evidence.appendChild(button);
      });
    }
    function refresh(id) {
      var tasks = rows(); select.replaceChildren();
      if (!tasks.length) { var empty = document.createElement('option'); empty.textContent = '还没有任务，从「准备材料」开始'; empty.value = ''; select.appendChild(empty); }
      tasks.forEach(function (task) { var option = document.createElement('option'); option.value = task.taskId; option.textContent = (task.status === 'accepted' ? '已采用 · ' : task.status === 'returned' ? '已返回 · ' : '待回答 · ') + task.label + ' · ' + new Date(task.createdAt).toLocaleString(); select.appendChild(option); });
      if (id && tasks.some(function (t) { return t.taskId === id; })) select.value = id;
      currentId = select.value;
      var task = current(), previousPart = parts.value, previousRevision = revisions.value; parts.replaceChildren();
      [{ id: '', label: '完整材料（单次返回）' }].concat(task && task.parts && task.parts.length > 1 && options.merge ? task.parts : []).forEach(function (part) { var option = document.createElement('option'); option.value = part.id; option.textContent = part.label || (part.id + ' · ' + part.sourceIds.length + ' 段原文' + (task.partialResults && task.partialResults[part.id] ? ' · 已返回' : '')); parts.appendChild(option); });
      if (Array.from(parts.options).some(function (o) { return o.value === previousPart; })) parts.value = previousPart;
      revisions.replaceChildren();
      (task && task.revisions || []).forEach(function (revision, i) { var option = document.createElement('option'); option.value = revision.hash; option.textContent = '版本 ' + (i + 1) + ' · ' + new Date(revision.createdAt).toLocaleString() + ((revision.acceptance || []).length ? ' · 已采用' : ' · 待审核'); revisions.appendChild(option); });
      revisions.value = (task && task.revisions || []).some(function (r) { return r.hash === previousRevision; }) ? previousRevision : ((task && task.revisions || []).slice(-1)[0] || {}).hash || '';
      showRevision();
      var context = dialog.querySelector('.agent-task-context');
      context.querySelector('strong').textContent = task ? task.label : '还没有交接任务';
      context.querySelector('p').textContent = !task ? '先准备材料，再复制给外部 Agent；回答后回到这里导入。' :
        (task.status === 'accepted' ? '已采用 · 可查看报告、证据和历史版本' : task.status === 'returned' ? '结果已带回 · 打开「带回结果」查看' : '材料已准备 · 复制给外部 Agent，等待回答') +
        (task.parts && task.parts.length > 1 && options.merge ? ' · 分包已返回 ' + Object.keys(task.partialResults || {}).length + ' / ' + task.parts.length : '');
      dialog.querySelector('[data-role="part-selector"]').hidden = parts.options.length <= 1;
      extra.querySelector('.agent-task-history').hidden = !(task && task.revisions && task.revisions.length);
      if (!stage) {
        extra.querySelector('.agent-task-history').open = !!(task && task.revisions && task.revisions.length);
        dialog.querySelector('.agent-task-importer').open = !(task && task.revisions && task.revisions.length);
      }
      extra.querySelector('[data-action="accept"]').hidden = !options.accept;
      dialog.querySelectorAll('[data-action="copy"],[data-action="download"],[data-action="import"],[data-next]').forEach(function (button) { button.disabled = !task; });
      backup.hidden = !(task && task.previousAnalyses && task.previousAnalyses.length); backup.querySelector('select').replaceChildren();
      (task && task.previousAnalyses || []).forEach(function (item, i) { var option = document.createElement('option'); option.value = i; option.textContent = new Date(item.savedAt).toLocaleString(); backup.querySelector('select').appendChild(option); }); showBackup();
      dialog.querySelector('.agent-task-prompt').value = task ? prompt(task) : '请先新建交接任务。';
      dialog.querySelector('[data-action="create"]').disabled = !options.createTask;
      extra.querySelector('[data-action="rebind"]').hidden = !options.rebind;
      if (!stage) setStage(options.stage || (options.initialRaw || options.initialError ? 'receive' : !task ? 'prepare' : task.status === 'pending' ? 'send' : 'receive'));
      if (refreshAttachment) refreshAttachment(task);
    }
    function close() { if (busy) return; overlay.remove(); document.removeEventListener('keydown', keydown, true); if (previous && previous.isConnected) previous.focus(); }
    function keydown(e) {
      if (document.querySelector('.agent-source-overlay')) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
      if (e.key === 'Tab') {
        var controls = Array.from(dialog.querySelectorAll('button:not(:disabled),select,textarea,summary')).filter(function (el) { return el.getClientRects().length; });
        var first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    async function run(action) {
      if (busy) return;
      busy = true; dialog.querySelectorAll('button').forEach(function (b) { b.disabled = true; }); select.disabled = true;
      try { await action(); if (root.AgentTaskWorkspace && options.store === root.AgentTaskWorkspace.getStore()) await root.AgentTaskWorkspace.flush(); }
      catch (error) { lastError = error.message; message(lastError, true); }
      finally {
        busy = false; dialog.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); select.disabled = false;
        try { refresh(currentId); } catch (error) { message(error.message, true); }
      }
    }
    async function receive(raw) {
      textarea.value = raw;
      var received = await options.store.receive(raw, async function (task, payload, resultHash) {
        if (options.taskType && task.taskType !== options.taskType) throw new Error('该结果属于其他功能，请到对应工作台导入');
        return options.apply(task, payload, resultHash);
      }, currentId, options.merge);
      currentId = received.task.taskId; lastError = ''; revisions.value = ''; setStage('receive');
      message(received.outcome || '结果已导入，可关闭面板查看。');
      if (!(received.task.revisions || []).length) return;
      dialog.querySelector('.agent-task-importer').open = false;
      var view = document.createElement('button'); view.type = 'button'; view.textContent = options.reviewFirst ? '查看结果并采用' : '查看生成结果'; view.style.marginLeft = '12px';
      view.addEventListener('click', function () { if (options.reviewFirst) { extra.querySelector('.agent-task-history').open = true; extra.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else close(); }); status.appendChild(view);
      if (options.reviewFirst) extra.querySelector('.agent-task-history').open = true;
    }
    async function file(file) {
      if (!file) return;
      if (file.size > root.AgentHandoffProtocol.MAX_TEXT) throw new Error('结果文件超过 4 MB，请分批返回');
      await receive(await file.text());
    }
    dialog.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]'); if (!button) return;
      var action = button.dataset.action;
      if (action === 'file') { input.click(); return; }
      if (action === 'bundle-import') { dialog.querySelector('.agent-bundle-file').click(); return; }
      void run(async function () {
        var task = current();
        if (action === 'create') { task = await options.createTask(); options.store.put(task); currentId = task.taskId; textarea.value = ''; setStage('send'); message('材料已准备好。点击「复制任务与材料」，粘贴到外部 Agent。'); }
        else if (action === 'bundle-export') { if (!root.AgentTaskWorkspace) throw new Error('请在主工作台导出任务包'); download(root.AgentTaskWorkspace.exportBundle(), 'patentlens-agent-workspace.json'); }
        else if (action === 'import') await receive(textarea.value);
        else if (action === 'raw') { if (!textarea.value.trim()) throw new Error('还没有原始回答'); download(textarea.value, 'patentlens-agent-answer.txt'); }
        else {
          if (!task) throw new Error('请先新建或选择交接任务');
          if (action === 'copy') { await copy(prompt(task)); message('已复制选定范围的任务，请粘贴到外部 Agent。'); }
          if (action === 'download') download(prompt(task), task.taskId + '-' + (parts.value || 'full') + '-task.txt');
          if (action === 'repair') { await copy('请修正上一份结果并返回完整结果信封，保留正确内容。软件提示：' + (lastError || task.lastAttempt && task.lastAttempt.error || '请依据原文复核结构与证据') + '\n\n' + prompt(task)); message('已复制修正请求。'); }
          if (action === 'revise') { await receive(JSON.stringify({ kind: 'patentlens-agent-result', schemaVersion: 1, taskId: task.taskId, taskType: task.taskType, sourceHash: task.sourceHash, payload: JSON.parse(edit.value) })); revisions.value = ''; }
          if (action === 'rebind') { if (!options.rebind) throw new Error('请到生图工作台绑定'); message(await options.rebind(task)); }
          if (action === 'backup') { var previous = (task.previousAnalyses || [])[Number(backup.querySelector('select').value)]; if (!previous) throw new Error('没有选中备份'); download(previous.report, task.taskId + '-previous-analysis.md'); }
          if (action === 'accept') {
            if (!options.accept) throw new Error('生成版本已保存在原工作台，请在那里切换版本');
            var revision = (task.revisions || []).find(function (row) { return row.hash === revisions.value; }); if (!revision) throw new Error('请先选择完整结果版本');
            var outcome = await options.accept(task, revision.payload, revision.hash); options.store.recordAcceptance(task.taskId, revision.hash, outcome); message(outcome || '已采用选中版本');
          }
          if (action === 'remove') { options.store.remove(task.taskId); currentId = ''; textarea.value = ''; stage = ''; message('已删除交接记录，已生成的图和比对历史仍可查看。'); }
        }
      });
    });
    select.addEventListener('change', function () { currentId = select.value; var task = current(); textarea.value = task && task.lastAttempt ? task.lastAttempt.raw : ''; lastError = task && task.lastAttempt ? task.lastAttempt.error : ''; stage = ''; refresh(currentId); message(lastError || '', !!lastError); });
    parts.addEventListener('change', function () { var task = current(); if (task) dialog.querySelector('.agent-task-prompt').value = prompt(task); });
    revisions.addEventListener('change', showRevision);
    dialog.querySelector('.agent-bundle-file').addEventListener('change', function (event) { var file = event.target.files[0]; event.target.value = ''; void run(async function () { if (!file || file.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的任务包'); if (!root.AgentTaskWorkspace) throw new Error('请在主工作台导入任务包'); var count = await root.AgentTaskWorkspace.importBundle(await file.text()); stage = ''; message('已导入 ' + count + ' 个任务；在对应工作台选择原文后采用。'); }); });
    input.addEventListener('change', function () { var selected = input.files[0]; input.value = ''; void run(function () { return file(selected); }); });
    var drop = dialog.querySelector('.agent-task-drop');
    // Prevent Electron navigation even when a file misses the dashed target.
    overlay.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragging'); });
    overlay.addEventListener('dragleave', function () { drop.classList.remove('dragging'); });
    overlay.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('dragging'); setStage('receive'); void run(async function () { if (e.dataTransfer.files.length !== 1) throw new Error('请每次拖入一个结果文件'); await file(e.dataTransfer.files[0]); }); });
    dialog.querySelector('.agent-task-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', keydown, true);
    try {
      refresh(currentId);
      var savedTask = current();
      if (savedTask && savedTask.lastAttempt && !options.initialRaw) {
        textarea.value = savedTask.lastAttempt.raw; lastError = savedTask.lastAttempt.error || '';
        if (lastError) message(lastError, true);
      }
    } catch (error) { message(error.message, true); }
    overlay.focus();
    if (options.initialError) message(options.initialError, true);
    if (options.initialRaw) void run(function () { return receive(options.initialRaw); });
    return { close: close };
  }
  root.AgentHandoffPanel = { open: open, download: download };
})(typeof globalThis !== 'undefined' ? globalThis : this);
