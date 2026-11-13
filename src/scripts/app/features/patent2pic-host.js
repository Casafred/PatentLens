/* Same-origin editor integration; the only configuration authority is window.AI. */
(function () {
  'use strict';
  var controller, loading, overlay, frame, status, closing = false, maintenance = false, cacheMutation = false;
  var cachedValues = {}, records = [];
  function updateRecords(values) {
    cachedValues = values;
    records = window.Patent2PicRecords.index(values);
    window.dispatchEvent(new CustomEvent('patent2pic-records-changed'));
  }
  async function refreshRecords() { var result = await bridge().loadPatent2Pic(); updateRecords(result.values); return records; }
  function bridge() {
    if (!window.electronAPI || !window.electronAPI.loadPatent2Pic) throw new Error('请使用 PatentLens 桌面版打开成图工作台');
    return window.electronAPI;
  }
  function config() { return window.AI.loadAIConfig(); }
  function getAIConfig() {
    var settings = config(), current = window.AI.getCurrentProvider(settings);
    return {
      currentProvider: current && current.type || settings.currentProvider || 'zhipu',
      profiles: window.AI.getAvailableProviders().map(function (item) {
        var provider = settings[item.value] || {};
        return { type: item.value, name: item.label, model: provider.model || '', configured: !!provider.apiKey,
          models: window.AI.getAvailableModels(item.value).map(function (model) { return model.value; }) };
      }),
    };
  }
  function showStatus(message, error) {
    if (status) { status.textContent = message; status.classList.toggle('p2p-error', !!error); }
  }
  function openAISettings() {
    var button = document.getElementById('ai-settings-btn');
    if (button) button.click();
    else throw new Error('请回到 PatentLens 主窗口打开 AI 设置');
  }
  async function close() {
    if (closing) return;
    closing = true;
    try {
      if (controller) await controller.save();
      if (overlay) overlay.hidden = true;
    } catch (error) { showStatus(error.message || '保存失败，请重试后关闭，或导出 .p2p 备份', true); }
    finally { closing = false; }
  }
  function ensure() {
    if (overlay) { overlay.hidden = false; return; }
    overlay = document.createElement('section'); overlay.id = 'patent2pic-workbench'; overlay.setAttribute('aria-label', '权利要求成图工作台');
    var toolbar = document.createElement('div'); toolbar.className = 'p2p-host-toolbar';
    var title = document.createElement('strong'); title.textContent = '权利要求成图'; toolbar.appendChild(title);
    status = document.createElement('span'); status.className = 'p2p-host-status'; status.textContent = '正在加载编辑器…'; toolbar.appendChild(status);
    [['保存项目', function () { if (controller) controller.save().then(function () { showStatus('已保存到本机'); }).catch(function (error) { showStatus(error.message, true); }); }],
     ['AI 供应商设置', openAISettings], ['返回专利', close]].forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = item[0]; button.addEventListener('click', item[1]); toolbar.appendChild(button);
    });
    frame = document.createElement('iframe'); frame.title = 'Patent2Pic 权利要求成图编辑器'; frame.src = '/features/patent2pic/index.html';
    frame.addEventListener('load', function () {
      if (!controller) showStatus('编辑器启动中；若加载失败，请重新构建或更新 PatentLens', false);
    });
    overlay.append(toolbar, frame); document.body.appendChild(overlay);
  }
  async function open(request) {
    if (cacheMutation) throw new Error('正在清理成图缓存，请稍后重试');
    bridge();
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var timeout = setTimeout(function () { reject(new Error('编辑器加载超时，请检查安装包是否完整')); }, 45000);
        window.Patent2PicHost.ready = function (api) { clearTimeout(timeout); controller = api; resolve(api); showStatus('项目自动保存到本机'); };
      });
      loading.catch(function (error) { showStatus(error.message, true); loading = null; });
    }
    ensure();
    var editor = controller || await loading;
    if (request) await editor.launch(request);
    showStatus('项目自动保存到本机');
  }
  async function openRecord(target) {
    await open(); await controller.openRecord(target);
    document.getElementById('ai-settings-modal').classList.add('hidden');
  }
  async function clearCache(target) {
    if (cacheMutation) throw new Error('正在清理，请稍后重试');
    if (controller && controller.isBusy()) throw new Error('请先终止或等待当前生成任务完成，再清理成图缓存');
    cacheMutation = true;
    try {
      if (controller) await controller.save();
      if (target) await refreshRecords();
      maintenance = true;
      // Dispose all in-memory state/timers before deletion, preventing autosave resurrection.
      if (overlay) overlay.remove();
      controller = loading = overlay = frame = status = null;
      if (target) {
        var values = window.Patent2PicRecords.removeFile(cachedValues, target);
        await bridge().savePatent2Pic(values);
        // Rewrite once so the recovery backup also excludes the removed graph.
        await bridge().savePatent2Pic(values);
      } else await bridge().clearPatent2Pic();
      await refreshRecords();
    } finally { maintenance = cacheMutation = false; }
  }
  window.Patent2PicHost = {
    getAIConfig: getAIConfig,
    streamChat: function (provider, params, signal) {
      // Snapshot credentials and custom protocol settings at request start.
      var snapshot = JSON.parse(JSON.stringify(config()));
      return window.Patent2PicAI.streamChat(snapshot, provider, params, signal);
    },
    openAISettings: openAISettings,
    loadStorage: async function () { var result = await bridge().loadPatent2Pic(); updateRecords(result.values); return result; },
    saveStorage: async function (values) { if (maintenance) throw new Error('正在清理成图缓存'); var result = await bridge().savePatent2Pic(values); updateRecords(values); return result; },
    ready: function () {},
  };
  window.Patent2PicWorkbench = { open: open, close: close, openRecord: openRecord, clearCache: clearCache,
    getRecords: function () { return records.slice(); }, refreshRecords: refreshRecords,
    getCacheBytes: function () { return new TextEncoder().encode(JSON.stringify(cachedValues)).length; },
    isOpen: function () { return !!overlay && !overlay.hidden; } };
  if (window.electronAPI && window.electronAPI.loadPatent2Pic) refreshRecords().catch(function (error) { console.warn('成图记录读取失败', error.message); });
  // Save to the main process before normal application close. The existing
  // Electron close flow awaits this hook (also covers dirty canvas snapshots).
  window.savePatent2PicBeforeClose = async function () { if (controller) await controller.save(); };
  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('#ai-save-btn')) setTimeout(function () {
      if (frame && frame.contentWindow) frame.contentWindow.dispatchEvent(new Event('patent2pic-ai-config-changed'));
    }, 0);
  });
})();
