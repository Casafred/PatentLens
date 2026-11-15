/* PatentLens: unified feature tree with claim adoption and inspectable evidence. */
var FamilyScopeView = (function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function cellFor(claim, id) { return claim.cells.find(function (c) { return c.featureId === id; }); }
  function resolved(result) {
    if (!result) return { model: null, issues: [] };
    // Rebuild from saved raw output so old sessions and exports use the same evidence checks.
    return FamilyScope.analyze(result.markdownContent, result.items || [], result.scopeSources || result.items || [], result.anchor && result.anchor.id);
  }
  function rows(model, mode, query, collapsed) {
    var features = model.features, keep = new Set(), lower = String(query || '').trim().toLowerCase();
    features.forEach(function (f) {
      var matches = !lower || [f.id, f.label, f.definition].concat(f.aliases).concat(model.claims.map(function (c) { return cellFor(c, f.id).note; })).join(' ').toLowerCase().includes(lower);
      var selected = mode === 'all' || (mode === 'differences' ? FamilyScope.isDifference(f.id, model.claims) : model.claims.some(function (c) { return cellFor(c, f.id).status === 'uncertain'; }));
      if (matches && selected) {
        keep.add(f.id);
        var parent = f.parentId;
        while (parent) { keep.add(parent); parent = features.find(function (p) { return p.id === parent; }).parentId; }
      }
    });
    var result = [];
    function visit(parent, depth) {
      features.filter(function (f) { return f.parentId === parent; }).forEach(function (f) {
        if (!keep.has(f.id)) return;
        result.push({ feature: f, depth: depth, children: features.some(function (c) { return c.parentId === f.id && keep.has(c.id); }) });
        if (!collapsed.has(f.id) || lower) visit(f.id, depth + 1);
      });
    }
    visit(null, 0);
    return result;
  }
  function matrix(model, options) {
    options = options || {};
    var visible = rows(model, options.mode || 'all', options.query, options.collapsed || new Set());
    var html = '<div class="family-scope-table-wrap" tabindex="0" aria-label="统一特征与各权项采用情况，可横向滚动"><table class="family-scope-table"><caption>特征树 × 权项采用情况</caption><thead><tr><th scope="col">统一技术要素</th>';
    model.claims.forEach(function (c) {
      html += '<th scope="col"' + (c.itemId === model.anchorId ? ' class="family-scope-anchor"' : '') + '><strong>' + esc(c.label) + '</strong><small>' + (c.itemId === model.anchorId ? '锚点 · ' : '') + esc(c.category || '类别待核对') + '</small></th>';
    });
    html += '</tr></thead><tbody>';
    visible.forEach(function (entry) {
      var f = entry.feature;
      html += '<tr><th scope="row"><div class="family-scope-feature" style="padding-left:' + (entry.depth * 18) + 'px">';
      if (entry.children && !options.static) html += '<button type="button" class="family-scope-fold" data-fold="' + esc(f.id) + '" aria-expanded="' + (!options.collapsed.has(f.id)) + '" aria-label="折叠或展开' + esc(f.label) + '">' + (options.collapsed.has(f.id) ? '▸' : '▾') + '</button>';
      else if (!options.static) html += '<span class="family-scope-fold-placeholder" aria-hidden="true"></span>';
      html += '<span><small>' + esc(f.id) + '</small><strong>' + esc(f.label) + '</strong>' + (f.definition ? '<small>' + esc(f.definition) + '</small>' : '') + (f.aliases.length ? '<small class="family-scope-alias">' + f.aliases.map(esc).join(' / ') + '</small>' : '') + '</span></div></th>';
      model.claims.forEach(function (c, index) {
        var cell = cellFor(c, f.id), status = FamilyScope.statuses[cell.status];
        var label = '<span class="family-scope-symbol">' + status[1] + '</span><b>' + status[0] + '</b>';
        var body = '<span class="family-scope-cell-note">' + esc(cell.note || (cell.status === 'uncertain' ? '映射待核对' : '')) + '</span>';
        if (options.static) html += '<td><div class="family-scope-cell ' + cell.status + '">' + label + body + evidence(cell) + '</div></td>';
        else html += '<td><button type="button" class="family-scope-cell ' + cell.status + '" data-feature="' + esc(f.id) + '" data-claim="' + index + '" aria-label="' + esc(c.label + '，' + f.label + '，' + status[0] + '，查看证据') + '">' + label + body + (cell.evidence.some(function (e) { return e.inherited; }) ? '<small>含引用继承 ↗</small>' : '') + '</button></td>';
      });
      html += '</tr>';
    });
    if (!visible.length) html += '<tr><td colspan="' + (model.claims.length + 1) + '">没有符合条件的要素。</td></tr>';
    return html + '</tbody></table></div>';
  }
  function evidence(cell) {
    if (!cell.evidence.length) return '<p>无可核对的连续原文证据。未见记载不等于排除该特征。</p>';
    return cell.evidence.map(function (e) {
      return '<blockquote><small>' + esc(e.label) + (e.inherited ? ' · 引用继承' : ' · 本项原文') + '</small><p>' + esc(e.quote) + '</p>' + (e.translation ? '<p class="family-scope-translation">AI 译文：' + esc(e.translation) + '</p>' : '') + '</blockquote>';
    }).join('');
  }
  function combinations(model) {
    return '<details class="family-scope-combinations"><summary>各权项的特征组合与范围判断</summary><div class="family-scope-combination-grid">' + model.claims.map(function (c) {
      var verified = c.cells.filter(function (cell) { return !['uncertain', 'not_stated'].includes(cell.status); });
      return '<article><h4>' + esc(c.label) + '</h4><small>有证据的映射要素：' + (verified.map(function (cell) { return esc(cell.featureId); }).join(' · ') || '暂无') + '</small>' +
        '<p><b>AI 组合解读：</b>' + esc(c.combination || '待生成；不能将要素列表直接视为合取关系。') + '</p>' +
        '<p>' + esc(c.dependencyNote) + '</p><p><b>' + (c.itemId === model.anchorId ? '锚点' : 'AI 范围判断：' + FamilyScope.relations[c.scopeRelation]) + '</b> ' + esc(c.scopeReason) + '</p>' +
        (c.cells.some(function (cell) { return cell.status === 'uncertain'; }) ? '<small>含待核对映射，组合与范围判断需结合证据阅读。</small>' : '') + '</article>';
    }).join('') + '</div></details>';
  }
  function heading(model) {
    var count = new Set(model.claims.map(function (c) { return c.patentNumber; }).filter(Boolean)).size;
    return '<header class="family-scope-header"><div><small>AI 语义归一 · 原文可追溯</small><h3>同族保护特征树</h3><p>' + model.features.length + ' 个统一要素 · ' + model.claims.length + ' 个已选权项' + (count ? ' · ' + count + ' 个成员' : '') + '</p></div></header>' +
      '<p class="family-scope-guide">沿树阅读总要素，横向查看各权项采用情况，点击单元格核对原文。树层级表示要素分组；权项的 AND / OR、引用路径与参数见组合解读。</p>' +
      '<p class="family-scope-coverage">覆盖范围为本次已选权项；未选权项及未加载成员未纳入。AI 归一和范围判断需结合原文核对，特征数量与相似度不代表保护范围大小。</p>';
  }
  function mount(container, result) {
    if (!container || !result) return;
    var parsed = resolved(result), model = parsed.model;
    if (!model) { container.innerHTML = '<div class="family-scope-empty">' + esc(parsed.issues[0]) + '</div>'; return; }
    var state = { mode: 'all', query: '', collapsed: new Set() };
    container.innerHTML = '<section class="family-scope">' + heading(model) + '<div class="family-scope-controls"><label>显示 <select aria-label="特征筛选"><option value="all">全部要素</option><option value="differences">差异与待核对</option><option value="uncertain">仅待核对</option></select></label><label>搜索 <input type="search" placeholder="要素、术语或限定" aria-label="搜索特征"></label><button type="button" class="btn-secondary btn-small" data-expand>展开全部</button></div>' +
      '<div class="family-scope-matrix"></div><div class="family-scope-legend">● 采用　≈ 译法不同　↓ 更具体　↑ 更概括　≠ 限定不同　— 未见记载　? 待核对</div>' +
      '<div class="family-scope-detail" tabindex="-1" aria-live="polite" hidden></div>' + combinations(model) +
      (parsed.issues.length ? '<details class="family-scope-issues"><summary>' + parsed.issues.length + ' 项映射检查提示</summary><ul>' + parsed.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></details>' : '') + '</section>';
    var target = container.querySelector('.family-scope-matrix');
    function redraw() { var old = target.querySelector('.family-scope-table-wrap'), x = old ? old.scrollLeft : 0; target.innerHTML = matrix(model, state); target.querySelector('.family-scope-table-wrap').scrollLeft = x; }
    container.querySelector('select').onchange = function () { state.mode = this.value; redraw(); };
    container.querySelector('input').oninput = function () { state.query = this.value; redraw(); };
    container.querySelector('[data-expand]').onclick = function () { state.collapsed.clear(); redraw(); };
    container.onclick = function (event) {
      var fold = event.target.closest('[data-fold]');
      if (fold) { var id = fold.dataset.fold; if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id); redraw(); return; }
      var button = event.target.closest('[data-feature]');
      if (!button) return;
      var feature = model.features.find(function (f) { return f.id === button.dataset.feature; }), claim = model.claims[Number(button.dataset.claim)], cell = cellFor(claim, feature.id);
      target.querySelectorAll('.is-selected').forEach(function (el) { el.classList.remove('is-selected'); }); button.classList.add('is-selected');
      var detail = container.querySelector('.family-scope-detail');
      detail.innerHTML = '<button type="button" class="family-scope-close" aria-label="关闭证据详情">×</button><h4>' + esc(feature.id + ' ' + feature.label + ' · ' + claim.label) + '</h4><p><b>' + FamilyScope.statuses[cell.status][0] + '</b> ' + esc(cell.note) + '</p>' +
        '<small>' + (cell.confidence === null ? '映射置信度未提供' : 'AI 映射置信度 ' + Math.round(cell.confidence * 100) + '%') + ' · 引文已对照本次输入校验，语义对应关系仍需核对</small>' + evidence(cell);
      var sourceIds = new Set([claim.itemId].concat(cell.evidence.map(function (e) { return e.sourceId; })));
      var sourceTexts = (result.scopeSources || result.items || []).filter(function (s) { return sourceIds.has(s.id); });
      detail.innerHTML += '<details><summary>查看本权项及引用来源的完整原文</summary>' + sourceTexts.map(function (s) { return '<blockquote><small>' + esc(s.label) + '</small><p>' + esc(s.originalText) + '</p></blockquote>'; }).join('') + '</details>';
      detail.hidden = false; detail.querySelector('button').onclick = function () { detail.hidden = true; button.focus(); }; detail.focus({ preventScroll: true }); detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    redraw();
  }
  function exportSection(result) {
    var parsed = resolved(result);
    return parsed.model ? '<section class="family-scope">' + heading(parsed.model) + matrix(parsed.model, { static: true }) + combinations(parsed.model).replace('<details class=', '<details open class=') + '</section>' : '';
  }
  return { mount: mount, rows: rows, matrix: matrix, resolved: resolved, exportSection: exportSection };
})();
