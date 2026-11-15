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
    var previous = document.activeElement;
    var overlay = document.createElement('div'); overlay.className = 'agent-task-overlay'; overlay.tabIndex = -1;
    overlay.innerHTML = '<section class="agent-task-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-task-title"><header class="agent-task-header"><h2 id="agent-task-title"></h2><button type="button" class="agent-task-close" aria-label="关闭">×</button></header><p class="agent-task-description"></p><b class="agent-task-step">① 准备任务</b><div class="agent-task-actions"><button type="button" data-action="create" class="agent-task-primary">新建交接任务</button><button type="button" data-action="copy">复制任务指令</button><button type="button" data-action="download">下载任务材料</button></div><label class="agent-task-step" for="agent-task-select">② 在外部 Agent 完成分析</label><select id="agent-task-select" aria-label="交接任务"></select><details><summary>查看任务指令</summary><textarea class="agent-task-prompt" readonly aria-label="任务指令"></textarea></details><div class="agent-task-drop"><b>③ 将结果文件拖到这里</b><p>也可以选择文件，或在下方粘贴完整回答。正常结果将直接生成新版本。</p><button type="button" data-action="file">选择结果文件</button><input class="agent-task-file" type="file" accept=".json,.txt,.md" hidden></div><textarea class="agent-task-result" aria-label="Agent 返回结果" placeholder="在这里粘贴外部 Agent 返回的完整回答或 JSON…"></textarea><div class="agent-task-actions"><button type="button" data-action="import" class="agent-task-primary">解析并导入结果</button><button type="button" data-action="repair">复制修正请求</button><button type="button" data-action="raw">下载原始回答</button><button type="button" data-action="remove">删除选中任务</button></div><div role="status" aria-live="polite" class="agent-task-status"></div></section>';
    document.body.appendChild(overlay);
    var dialog = overlay.querySelector('section'), select = dialog.querySelector('select'), textarea = dialog.querySelector('.agent-task-result');
    var status = dialog.querySelector('.agent-task-status'), input = dialog.querySelector('.agent-task-file');
    var busy = false, currentId = '', lastError = '';
    dialog.insertBefore(status, dialog.querySelector('.agent-task-description'));
    dialog.querySelector('h2').textContent = options.title;
    dialog.querySelector('.agent-task-description').textContent = options.description;
    function message(text, error) { status.textContent = text; status.className = 'agent-task-status ' + (error ? 'error' : 'success'); dialog.scrollTop = 0; }
    function rows() { return options.store.list().filter(function (task) { return task.taskType === options.taskType; }); }
    function current() { return rows().find(function (task) { return task.taskId === select.value; }); }
    function refresh(id) {
      var tasks = rows(); select.replaceChildren();
      tasks.forEach(function (task) { var option = document.createElement('option'); option.value = task.taskId; option.textContent = (task.status === 'returned' ? '已回流 · ' : '待回流 · ') + task.label + ' · ' + new Date(task.createdAt).toLocaleString(); select.appendChild(option); });
      if (id && tasks.some(function (t) { return t.taskId === id; })) select.value = id;
      currentId = select.value;
      var task = current(); dialog.querySelector('.agent-task-prompt').value = task ? root.AgentHandoffProtocol.prompt(task) : '请先新建交接任务。';
      dialog.querySelector('[data-action="create"]').disabled = !options.createTask;
    }
    function close() { if (busy) return; overlay.remove(); document.removeEventListener('keydown', keydown, true); if (previous && previous.isConnected) previous.focus(); }
    function keydown(e) {
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
      try { await action(); }
      catch (error) { lastError = error.message; message(lastError, true); }
      finally {
        busy = false; dialog.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); select.disabled = false;
        try { refresh(currentId); } catch (error) { message(error.message, true); }
      }
    }
    async function receive(raw) {
      textarea.value = raw;
      var received = await options.store.receive(raw, async function (task, payload, resultHash) {
        if (task.taskType !== options.taskType) throw new Error('该结果属于其他功能，请到对应工作台导入');
        return options.apply(task, payload, resultHash);
      }, currentId);
      currentId = received.task.taskId; lastError = '';
      message(received.outcome || '结果已导入，可关闭面板查看。');
      var view = document.createElement('button'); view.type = 'button'; view.textContent = '查看生成结果'; view.style.marginLeft = '12px';
      view.addEventListener('click', close); status.appendChild(view);
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
      void run(async function () {
        var task = current();
        if (action === 'create') { task = await options.createTask(); options.store.put(task); currentId = task.taskId; textarea.value = ''; message('任务已准备好。复制指令或下载材料，发送到外部 Agent。'); }
        else if (action === 'import') await receive(textarea.value);
        else if (action === 'raw') { if (!textarea.value.trim()) throw new Error('还没有原始回答'); download(textarea.value, 'patentlens-agent-answer.txt'); }
        else {
          if (!task) throw new Error('请先新建或选择交接任务');
          if (action === 'copy') { await copy(root.AgentHandoffProtocol.prompt(task)); message('已复制完整任务，请粘贴到外部 Agent。'); }
          if (action === 'download') download(root.AgentHandoffProtocol.prompt(task), task.taskId + '-task.txt');
          if (action === 'repair') { await copy('请修正上一份结果并返回完整结果信封，保留正确内容。软件提示：' + (lastError || task.lastAttempt && task.lastAttempt.error || '请依据原文复核结构与证据') + '\n\n' + root.AgentHandoffProtocol.prompt(task)); message('已复制修正请求。'); }
          if (action === 'remove') { options.store.remove(task.taskId); currentId = ''; textarea.value = ''; message('已删除交接记录，已生成的图和比对历史仍可查看。'); }
        }
      });
    });
    select.addEventListener('change', function () { currentId = select.value; var task = current(); textarea.value = task && task.lastAttempt ? task.lastAttempt.raw : ''; lastError = task && task.lastAttempt ? task.lastAttempt.error : ''; refresh(currentId); message(lastError || '', !!lastError); });
    input.addEventListener('change', function () { var selected = input.files[0]; input.value = ''; void run(function () { return file(selected); }); });
    var drop = dialog.querySelector('.agent-task-drop');
    // Prevent Electron navigation even when a file misses the dashed target.
    overlay.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragging'); });
    overlay.addEventListener('dragleave', function () { drop.classList.remove('dragging'); });
    overlay.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('dragging'); void run(async function () { if (e.dataTransfer.files.length !== 1) throw new Error('请每次拖入一个结果文件'); await file(e.dataTransfer.files[0]); }); });
    dialog.querySelector('.agent-task-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', keydown, true);
    try {
      refresh();
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
