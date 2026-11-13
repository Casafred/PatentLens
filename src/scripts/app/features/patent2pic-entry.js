(function () {
  'use strict';
  function dataFor(scope) { return scope === 'popup' ? window._patentPopupData : window._currentPatentData; }
  function report(error) { window.alert(error.message || '成图工作台打开失败'); }
  function isDependent(claim, index) {
    if (!claim) return false;
    if (claim.type === 'dependent') return true;
    if (claim.type === 'independent') return false;
    if (claim.dependent_on !== undefined && claim.dependent_on !== null && claim.dependent_on !== '') return true;
    if (typeof window.isIndependentClaim === 'function') return !window.isIndependentClaim(claim, index);
    return index > 0 && /^(根据|如|按照|依据).{0,20}(权利要求|权项)/.test(String(claim.text || '').trim());
  }
  function claimRow(claim, index) {
    var row = document.createElement('label'), input = document.createElement('input'), content = document.createElement('span');
    input.type = 'checkbox'; input.value = String(index);
    content.textContent = '权利要求 ' + (claim.num || index + 1) + (isDependent(claim, index) ? '（从属）' : '') + '　' + String(claim.text || '').slice(0, 180);
    row.append(input, content);
    return row;
  }
  function choose(scope, preselected) {
    var data = dataFor(scope);
    if (!data || !data.claims || !data.claims.length) { report(new Error('当前专利没有可用权利要求')); return; }
    // Freeze the source while the user selects; switching patents cannot change it.
    data = JSON.parse(JSON.stringify(data));
    var dialog = document.createElement('dialog'); dialog.className = 'p2p-claim-dialog';
    var heading = document.createElement('h2'); heading.textContent = '选择要成图的权利要求';
    var description = document.createElement('p'); description.textContent = (data.patent_number || data.publication_number || '') + ' · ' + (data.title || '');
    var note = document.createElement('p'); note.className = 'p2p-selection-note'; note.textContent = '默认只勾选独立权利要求；从属权利要求已折叠，展开后可手动勾选。原文将直接带入编辑器，点击生成后才调用 AI。多选将逐项成图；从属权利要求不会自动合并其引用权项，请按需要补充完整技术内容。';
    var list = document.createElement('div'); list.className = 'p2p-claim-list';
    var independentRows = [], dependentRows = [], dependentIndexes = [];
    data.claims.forEach(function (claim, index) {
      var row = claimRow(claim, index);
      if (isDependent(claim, index)) { dependentRows.push(row); dependentIndexes.push(index); }
      else independentRows.push(row);
    });
    independentRows.forEach(function (row) { list.appendChild(row); });

    var dependents = null;
    if (dependentRows.length) {
      dependents = document.createElement('details'); dependents.className = 'p2p-claim-dependents';
      var summary = document.createElement('summary');
      summary.textContent = '从属权利要求（' + dependentRows.length + ' 项，展开后勾选）';
      dependents.appendChild(summary);
      dependentRows.forEach(function (row) { dependents.appendChild(row); });
      list.appendChild(dependents);
    }

    // 默认勾选全部独立权利要求；显式传入 preselected 时只勾选该项。
    var selected = preselected != null ? [preselected] : data.claims.map(function (_, index) { return index; })
      .filter(function (index) { return !isDependent(data.claims[index], index); });
    list.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
      input.checked = selected.indexOf(Number(input.value)) >= 0;
    });
    if (dependents && selected.some(function (index) { return dependentIndexes.indexOf(index) >= 0; })) {
      dependents.open = true;
    }

    var footer = document.createElement('div'); footer.className = 'p2p-dialog-actions';
    var cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.addEventListener('click', function () { dialog.close(); });
    var launch = document.createElement('button'); launch.textContent = '打开成图工作台'; launch.className = 'p2p-primary';
    function refreshLaunch() {
      launch.disabled = !list.querySelector('input[type="checkbox"]:checked');
    }
    list.addEventListener('change', refreshLaunch);
    refreshLaunch();
    launch.addEventListener('click', async function () {
      try {
        var indexes = Array.from(list.querySelectorAll('input:checked')).map(function (input) { return Number(input.value); });
        var request = window.Patent2PicSource.snapshot(data, indexes);
        launch.disabled = true;
        await window.Patent2PicWorkbench.open(request); dialog.close();
      } catch (error) { report(error); } finally { launch.disabled = false; }
    });
    footer.append(cancel, launch); dialog.append(heading, description, note, list, footer);
    dialog.addEventListener('close', function () { dialog.remove(); });
    document.body.appendChild(dialog); dialog.showModal();
  }
  function enhance() {
    [['detail', '#patent-detail-content'], ['popup', '#patent-popup-viewer']].forEach(function (item) {
      var root = document.querySelector(item[1]);
      if (!root && item[0] === 'popup') root = document.getElementById('patent-popup');
      var actions = root && root.querySelector('.pd-tab-panel[data-panel="claims"] .pd-panel-actions');
      if (!actions || actions.querySelector('.p2p-open-button')) return;
      var button = document.createElement('button'); button.type = 'button'; button.className = 'pd-compare-btn p2p-open-button'; button.textContent = '权利要求成图';
      button.addEventListener('click', function () { choose(item[0]); }); actions.prepend(button);
    });
  }
  function init() {
    var settings = document.getElementById('ai-settings-btn');
    if (settings && !document.getElementById('patent2pic-entry')) {
      var entry = document.createElement('button'); entry.id = 'patent2pic-entry'; entry.className = 'btn-secondary'; entry.textContent = '成图工作台';
      entry.title = 'Patent2Pic · 权利要求成图工作台'; entry.setAttribute('aria-label', entry.title);
      var logo = document.createElement('img'); logo.src = 'styles/patent2pic-logo.png'; logo.alt = 'Patent2Pic'; entry.replaceChildren(logo);
      entry.addEventListener('click', function () { window.Patent2PicWorkbench.open().catch(report); }); document.body.appendChild(entry);
    }
    new MutationObserver(enhance).observe(document.body, { subtree: true, childList: true }); enhance();
  }
  window.Patent2PicEntry = { choose: choose };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
