(function () {
  'use strict';
  var api = window.Patent2PicWorkbench, scheduled = false;
  function node(tag, className, text) { var el = document.createElement(tag); el.className = className || ''; if (text) el.textContent = text; return el; }
  function report(error) { window.alert(error.message || '成图记录操作失败'); }
  function open(row) { api.openRecord(row).catch(report); }
  function rows() { return api.getRecords(); }
  function formatBytes(size) { return size < 1024 ? size + ' B' : size < 1048576 ? (size / 1024).toFixed(1) + ' KB' : (size / 1048576).toFixed(1) + ' MB'; }
  function recordCard(row, deletable) {
    var card = node('div', 'p2p-record-card'), link = node('button', 'p2p-record-open'); link.type = 'button';
    link.append(node('strong', '', (row.publicationNumber || row.fileName) + (row.claimNumber ? ' · 权项 ' + row.claimNumber : '')),
      node('span', '', row.title), node('small', '', row.projectName + ' · ' + row.versions + ' 个版本 · ' + new Date(row.updatedAt).toLocaleString('zh-CN')));
    link.addEventListener('click', function () { open(row); }); card.appendChild(link);
    if (deletable) {
      var remove = node('button', 'p2p-record-delete', '删除'); remove.type = 'button';
      remove.addEventListener('click', async function () {
        if (!confirm('删除这条成图任务及其全部版本？此操作不能撤销，请先导出需要保留的 .p2p 项目。')) return;
        remove.disabled = true;
        try { await api.clearCache(row); } catch (error) { report(error); } finally { remove.disabled = false; }
      }); card.appendChild(remove);
    }
    return card;
  }
  function renderHistory() {
    var container = document.getElementById('p2p-history-list'); if (!container) return;
    var input = document.getElementById('history-search-input'), query = input.value.trim().toLowerCase();
    var list = rows().filter(function (r) { return [r.publicationNumber, r.claimNumber, r.title, r.projectName].join(' ').toLowerCase().includes(query); });
    container.replaceChildren();
    if (!list.length) container.appendChild(node('p', 'p2p-empty', query ? '没有匹配的生图记录' : '暂无生图记录，生成后会自动出现在这里'));
    list.forEach(function (row) { container.appendChild(recordCard(row, false)); });
    var button = document.querySelector('[data-p2p-history="graphs"]');
    if (button) button.textContent = '生图记录 (' + rows().length + ')';
  }
  function renderCache() {
    var container = document.getElementById('p2p-cache-list'); if (!container) return;
    document.getElementById('p2p-cache-summary').textContent = rows().length + ' 条成图任务 · 工作区 ' + formatBytes(api.getCacheBytes()) + ' · 含手动编辑和全部版本';
    container.replaceChildren(); rows().forEach(function (row) { container.appendChild(recordCard(row, true)); });
    if (!rows().length) container.appendChild(node('p', 'p2p-empty', '暂无已生成任务；空白项目、提示词等也计入工作区占用。'));
  }
  function enhanceClaims() {
    [['#patent-detail-content', window._currentPatentData], ['#patent-popup-viewer', window._patentPopupData]].forEach(function (entry) {
      var root = document.querySelector(entry[0]), data = entry[1]; if (!root || !data) return;
      root.querySelectorAll('.pd-claim-item').forEach(function (item) {
        var claim = (data.claims || [])[Number(item.dataset.claimIndex)]; if (!claim) return;
        var found = window.Patent2PicRecords.forClaim(rows(), data, Object.assign({ num: String(Number(item.dataset.claimIndex) + 1) }, claim));
        var old = item.querySelector('.p2p-claim-record'), signature = found.map(function (r) { return r.projectId + '/' + r.fileId + '/' + r.versionId; }).join('|');
        if (old && old.dataset.signature === signature) return;
        if (old) old.remove(); if (!found.length) return;
        var button = node('button', 'p2p-claim-record', '查看成图' + (found.length > 1 ? ' (' + found.length + ')' : ''));
        button.type = 'button'; button.dataset.signature = signature; button.title = '查看权项 ' + claim.num + ' 的已保存图分析';
        button.addEventListener('click', function (event) { event.stopPropagation(); open(found[0]); });
        (item.querySelector('.pd-claim-main') || item).appendChild(button);
      });
    });
  }
  function scheduleClaims() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; enhanceClaims(); }); }
  function init() {
    var sidebar = document.getElementById('history-sidebar'), list = document.getElementById('history-list');
    var tabs = node('div', 'p2p-history-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '历史记录分类');
    [['search', '检索记录'], ['graphs', '生图记录']].forEach(function (entry) {
      var button = node('button', '', entry[1]); button.type = 'button'; button.dataset.p2pHistory = entry[0]; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(entry[0] === 'search'));
      button.addEventListener('click', function () {
        sidebar.classList.remove('fav-view'); sidebar.classList.toggle('p2p-history-view', entry[0] === 'graphs');
        tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b === button)); });
        renderHistory();
      }); tabs.appendChild(button);
    });
    sidebar.querySelector('.history-sidebar-title').after(tabs);
    var history = node('div', 'p2p-history-list'); history.id = 'p2p-history-list'; list.after(history);
    document.getElementById('history-search-input').addEventListener('input', renderHistory);
    document.addEventListener('click', function (event) { if (event.target.closest('#fav-view-toggle')) { sidebar.classList.remove('p2p-history-view'); tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', 'false'); }); } });
    var cache = node('div', 'form-group p2p-cache-group'); cache.id = 'p2p-cache-group';
    cache.appendChild(node('label', '', '成图工作台缓存'));
    var summary = node('p'); summary.id = 'p2p-cache-summary'; cache.appendChild(summary);
    var cacheList = node('div'); cacheList.id = 'p2p-cache-list'; cache.appendChild(cacheList);
    var clear = node('button', 'btn-danger btn-small', '清除全部成图缓存'); clear.id = 'p2p-cache-clear'; clear.type = 'button';
    clear.addEventListener('click', async function () {
      if (!confirm('清除成图工作区的全部项目、版本、提示词和回收站？请先导出需要保留的 .p2p 项目。')) return;
      clear.disabled = true; try { await api.clearCache(); } catch (error) { report(error); } finally { clear.disabled = false; }
    }); cache.appendChild(clear);
    document.querySelector('#settings-tab-cache .form-actions').before(cache);
    // Capture and replace the old synchronous clear flow so all stores finish before UI refresh.
    document.addEventListener('click', async function (event) {
      if (!event.target.closest('#cache-clear-btn')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('确定清除全部缓存和历史记录，包括成图项目、手动编辑和版本？请先导出需要保留的 .p2p 项目。')) return;
      var button = document.getElementById('cache-clear-btn'); button.disabled = true;
      try {
        await api.clearCache(); PatentCache.clearAll(); PatentCache.clearAllHistory();
        if (typeof ImageAnnotations !== 'undefined') ImageAnnotations.clearAllAnnotations();
        window.refreshHistoryList();
      } catch (error) { report(error); } finally { button.disabled = false; }
    }, true);
    document.addEventListener('click', function (event) { if (event.target.closest('[data-settings-tab="cache"], #ai-settings-btn')) api.refreshRecords().catch(report); });
    window.addEventListener('patent2pic-records-changed', function () { renderHistory(); renderCache(); scheduleClaims(); });
    ['patent-detail-content', 'patent-popup-viewer'].forEach(function (id) { var root = document.getElementById(id); if (root) new MutationObserver(scheduleClaims).observe(root, { childList: true, subtree: true }); });
    renderHistory(); renderCache(); scheduleClaims();
    // Equal-height two-row search: modes/tools above, patent input and query below.
    var box = document.querySelector('.search-box'), toolbar = node('div', 'p2p-search-toolbar'), tools = node('div', 'p2p-search-tools');
    toolbar.appendChild(box.querySelector('.search-mode-switch'));
    ['share-workspace-entry', 'theme-toggle-btn', 'ai-settings-btn'].forEach(function (id) { tools.appendChild(document.getElementById(id)); });
    toolbar.appendChild(tools); box.before(toolbar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
