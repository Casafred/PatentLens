/*!
 * PatentLens - 权利要求演变树（权利要求变动定位 · 树状视图）
 *
 * 左右两棵依赖树分别呈现公开版与授权版权利要求的独从权结构，
 * 用 SVG 连线表达每个公开权项如何演变为授权权项：整项增删、
 * 限定并入、独从转换、引用关系调整等宏观变化在树与连线上直接可见；
 * 词句级修改通过点击节点在详情面板中查看。该模块不调用 AI。
 */
var ClaimDiffTree = (function () {
  var STATUS_COLORS = {
    same: '#94a3b8',
    modified: '#d97706',
    promoted: '#d97706',
    demoted: '#d97706',
    dependency_migrated: '#d97706',
    renumbered: '#0284c7',
    reference_only: '#0284c7',
    merged_into: '#ea580c',
    added: '#2563eb',
    deleted: '#dc2626'
  };

  var LEGEND = [
    { status: 'same', label: '未变化' },
    { status: 'modified', label: '内容修改 / 独从转换' },
    { status: 'renumbered', label: '编号或引用调整' },
    { status: 'merged_into', label: '限定并入' },
    { status: 'added', label: '授权新增' },
    { status: 'deleted', label: '整项删除' }
  ];

  var _current = { container: null, links: [], itemByKey: {}, compareKeyByNum: {}, resizeHandler: null };

  function canon(value) {
    var text = String(value == null ? '' : value).trim();
    return /^0*\d+$/.test(text) ? String(parseInt(text, 10)) : text;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function label(status) {
    if (typeof ComparisonClaimDiff !== 'undefined' && ComparisonClaimDiff.statusLabel) return ComparisonClaimDiff.statusLabel(status);
    return status;
  }

  function visiblePublicItems(result, filter) {
    if (typeof ComparisonClaimDiff !== 'undefined' && ComparisonClaimDiff.filterPublicItems) return ComparisonClaimDiff.filterPublicItems(result, filter);
    return result.publicItems || [];
  }

  // 构建单个版本的权利要求依赖树：独立权项为根，从权挂在第一个
  // 存在于本文献的父项下；引用缺失或成环时兜底为根并标记 orphan。
  function buildClaimTree(claims) {
    var list = (claims || []).map(function (claim, index) {
      return {
        num: canon(claim.num),
        type: claim.type === 'dependent' ? 'dependent' : 'independent',
        dependencies: (claim.dependencies || []).map(canon),
        index: index,
        parent: null,
        children: [],
        orphan: false
      };
    });
    var byNum = {};
    list.forEach(function (node) { if (!(node.num in byNum)) byNum[node.num] = node; });
    list.forEach(function (node) {
      for (var i = 0; i < node.dependencies.length; i++) {
        var dep = node.dependencies[i];
        if (dep !== node.num && byNum[dep]) { node.parent = byNum[dep]; break; }
      }
      if (!node.parent && node.dependencies.length) node.orphan = true;
    });
    // 循环引用兜底：闭合环路的节点降级为根，避免树构建死循环。
    list.forEach(function (node) {
      var seen = {}, cur = node.parent, steps = 0;
      while (cur && steps++ <= list.length) {
        if (seen[cur.num]) { node.parent = null; node.orphan = true; break; }
        seen[cur.num] = true;
        cur = cur.parent;
      }
    });
    var roots = [];
    list.forEach(function (node) { if (node.parent) node.parent.children.push(node); else roots.push(node); });
    (function sortLevel(nodes) {
      nodes.sort(function (a, b) { return a.index - b.index; });
      nodes.forEach(function (node) { sortLevel(node.children); });
    })(roots);
    return { roots: roots, nodes: list };
  }

  // 由变动定位结果生成演变连线：pair=配对演变，merge=限定并入，
  // deleted=整项删除（无授权去向），added=授权新增（无公开来源）。
  function buildTreeLinks(result) {
    var links = [];
    (result.publicItems || []).forEach(function (item) {
      var key = 'pub:' + canon(item.base.num);
      if (item.compare) links.push({ kind: 'pair', status: item.status, fromNum: canon(item.base.num), toNum: canon(item.compare.num), key: key });
      else if (item.mergedInto) links.push({ kind: 'merge', status: 'merged_into', fromNum: canon(item.base.num), toNum: canon(item.mergedInto.num), key: key });
      else links.push({ kind: 'deleted', status: 'deleted', fromNum: canon(item.base.num), toNum: null, key: key });
    });
    (result.grantedOnly || []).forEach(function (item) {
      links.push({ kind: 'added', status: 'added', fromNum: null, toNum: canon(item.compare.num), key: 'granted:' + canon(item.compare.num) });
    });
    return links;
  }

  function teardown() {
    if (_current.resizeHandler) {
      window.removeEventListener('resize', _current.resizeHandler);
      _current.resizeHandler = null;
    }
    _current = { container: null, links: [], itemByKey: {}, compareKeyByNum: {}, resizeHandler: null };
  }

  function renderLevel(nodes, side, infoMap, depth) {
    if (!nodes || !nodes.length) return '';
    var listClass = depth === 0 ? 'claimtree-roots' : 'claimtree-children';
    return '<ul class="' + listClass + '">' + nodes.map(function (node) {
      var info = infoMap[node.num] || {};
      var classes = 'claimtree-node-card' + (info.status ? ' ' + info.status : '') + (info.dim ? ' dim' : '') + (node.orphan ? ' orphan' : '');
      var card = '<div class="' + classes + '" data-side="' + side + '" data-num="' + esc(node.num) + '" data-key="' + esc(info.key || '') + '">';
      card += '<span class="claimtree-num">' + esc(node.num) + '</span>';
      card += '<span class="claimtree-kind ' + node.type + '">' + (node.type === 'independent' ? '独立' : '从属') + '</span>';
      if (node.type === 'dependent' && node.dependencies.length) card += '<span class="claimtree-deps">引' + node.dependencies.map(esc).join('、') + '</span>';
      if (info.status) card += '<span class="claimdiff-status ' + info.status + '">' + esc(label(info.status)) + '</span>';
      if (info.mergeCount) card += '<span class="claimtree-merge-chip">并入×' + info.mergeCount + '</span>';
      card += '</div>';
      return '<li class="claimtree-branch">' + card + renderLevel(node.children, side, infoMap, depth + 1) + '</li>';
    }).join('') + '</ul>';
  }

  function curvePath(x1, y1, x2, y2) {
    var dx = Math.max(24, Math.abs(x2 - x1) * 0.45);
    return 'M' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  function drawLinks() {
    var container = _current.container;
    if (!container || !container.isConnected) return;
    var wrap = container.querySelector('.claimdiff-tree-wrap');
    var svg = wrap && wrap.querySelector('svg.claimtree-links');
    if (!wrap || !svg) return;
    svg.innerHTML = '';
    var wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.height || !wrapRect.width) return;
    svg.setAttribute('viewBox', '0 0 ' + wrapRect.width + ' ' + wrapRect.height);
    var cards = {};
    wrap.querySelectorAll('.claimtree-node-card').forEach(function (card) {
      cards[card.dataset.side + ':' + card.dataset.num] = card;
    });
    var leftCol = wrap.querySelector('.claimtree-side.base').getBoundingClientRect();
    var rightCol = wrap.querySelector('.claimtree-side.compare').getBoundingClientRect();
    var midX = (leftCol.right + rightCol.left) / 2 - wrapRect.left;
    var ns = 'http://www.w3.org/2000/svg';
    _current.links.forEach(function (link) {
      var fromCard = link.fromNum ? cards['base:' + link.fromNum] : null;
      var toCard = link.toNum ? cards['compare:' + link.toNum] : null;
      if (!fromCard && !toCard) return;
      var x1, y1, x2, y2;
      if (fromCard && toCard) {
        var r1 = fromCard.getBoundingClientRect(), r2 = toCard.getBoundingClientRect();
        x1 = r1.right - wrapRect.left; y1 = r1.top + r1.height / 2 - wrapRect.top;
        x2 = r2.left - wrapRect.left; y2 = r2.top + r2.height / 2 - wrapRect.top;
      } else if (fromCard) {
        var rd = fromCard.getBoundingClientRect();
        x1 = rd.right - wrapRect.left; y1 = rd.top + rd.height / 2 - wrapRect.top;
        x2 = midX - 10; y2 = y1;
      } else {
        var ra = toCard.getBoundingClientRect();
        x1 = midX + 10; y1 = ra.top + ra.height / 2 - wrapRect.top;
        x2 = ra.left - wrapRect.left; y2 = y1;
      }
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', curvePath(x1, y1, x2, y2));
      path.setAttribute('class', 'claimtree-link ' + link.status + (link.dim ? ' dim' : ''));
      path.dataset.from = link.fromNum || '';
      path.dataset.to = link.toNum || '';
      path.dataset.key = link.key || '';
      svg.appendChild(path);
      [[x1, y1], [x2, y2]].forEach(function (point) {
        var dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', point[0]);
        dot.setAttribute('cy', point[1]);
        dot.setAttribute('r', 3);
        dot.setAttribute('class', 'claimtree-dot ' + link.status);
        svg.appendChild(dot);
      });
      if (fromCard && !toCard) {
        var mark = document.createElementNS(ns, 'text');
        mark.setAttribute('x', x2 + 3);
        mark.setAttribute('y', y2 + 4);
        mark.setAttribute('class', 'claimtree-endmark');
        mark.textContent = '✕';
        svg.appendChild(mark);
      }
    });
  }

  function setHighlight(side, num) {
    var container = _current.container;
    if (!container) return;
    var svg = container.querySelector('svg.claimtree-links');
    var baseNum = null, compareNums = {};
    if (side === 'base') {
      baseNum = num;
      _current.links.forEach(function (link) { if (link.fromNum === num && link.toNum) compareNums[link.toNum] = true; });
    } else if (side === 'compare') {
      compareNums[num] = true;
      _current.links.forEach(function (link) { if (link.toNum === num && link.fromNum) baseNum = link.fromNum; });
    }
    container.querySelectorAll('.claimtree-node-card').forEach(function (card) {
      var hl = false;
      if (side) {
        if (card.dataset.side === 'base' && baseNum && card.dataset.num === baseNum) hl = true;
        if (card.dataset.side === 'compare' && compareNums[card.dataset.num]) hl = true;
      }
      card.classList.toggle('hl', hl);
    });
    if (svg) svg.querySelectorAll('path.claimtree-link').forEach(function (path) {
      var active = side ? (side === 'base' ? path.dataset.from === num : path.dataset.to === num) : false;
      path.classList.toggle('active', active);
    });
  }

  function detailTitle(item) {
    if (item.base) {
      var target = item.compare || item.mergedInto;
      var targetText = target ? (item.mergedInto && !item.compare ? ' → 并入授权权 ' + target.num : ' → 授权权 ' + target.num) : ' → 授权版无对应权项';
      return '公开权 ' + item.base.num + targetText + ' · ' + label(item.status);
    }
    return '授权权 ' + item.compare.num + ' · 授权新增';
  }

  function detailBody(item) {
    if (typeof ComparisonClaimDiff !== 'undefined') {
      if (item.base && ComparisonClaimDiff.renderItemBody) return ComparisonClaimDiff.renderItemBody(item);
      if (!item.base && ComparisonClaimDiff.renderGrantedOnly) return ComparisonClaimDiff.renderGrantedOnly(item);
    }
    return '<pre class="claimtree-raw">' + esc(item.base ? item.base.text : item.compare.text) + '</pre>';
  }

  function openDetail(side, num, cardEl) {
    var container = _current.container;
    if (!container) return;
    var key = side === 'base' ? 'pub:' + num : (_current.compareKeyByNum[num] || '');
    var item = key ? _current.itemByKey[key] : null;
    if (!item) return;
    var detail = container.querySelector('.claimtree-detail');
    if (!detail) return;
    detail.innerHTML = '<header><span>' + esc(detailTitle(item)) + '</span><button class="claimtree-detail-close" type="button" aria-label="关闭详情">✕</button></header>'
      + '<div class="claimtree-detail-body">' + detailBody(item) + '</div>';
    detail.hidden = false;
    detail.querySelector('.claimtree-detail-close').addEventListener('click', function () {
      detail.hidden = true;
      container.querySelectorAll('.claimtree-node-card.selected').forEach(function (card) { card.classList.remove('selected'); });
    });
    container.querySelectorAll('.claimtree-node-card.selected').forEach(function (card) { card.classList.remove('selected'); });
    if (cardEl) cardEl.classList.add('selected');
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function wireLinkEvents() {
    var container = _current.container;
    if (!container) return;
    var svg = container.querySelector('svg.claimtree-links');
    if (!svg) return;
    svg.querySelectorAll('path.claimtree-link').forEach(function (path) {
      path.addEventListener('mouseenter', function () {
        setHighlight(path.dataset.from ? 'base' : 'compare', path.dataset.from || path.dataset.to);
      });
      path.addEventListener('mouseleave', function () { setHighlight(null, null); });
      path.addEventListener('click', function () {
        var side = path.dataset.from ? 'base' : 'compare';
        var num = path.dataset.from || path.dataset.to;
        var card = container.querySelector('.claimtree-node-card[data-side="' + side + '"][data-num="' + num + '"]');
        openDetail(side, num, card);
      });
    });
  }

  function render(container, options) {
    if (!container) return;
    teardown();
    var result = options && options.result;
    if (!result) { container.innerHTML = ''; return; }
    var filter = (options && options.filter) || 'all';
    var stats = result.stats || {};
    var visibleKeys = {};
    visiblePublicItems(result, filter).forEach(function (item) { visibleKeys['pub:' + canon(item.base.num)] = true; });

    var itemByKey = {};
    result.publicItems.forEach(function (item) { itemByKey['pub:' + canon(item.base.num)] = item; });
    (result.grantedOnly || []).forEach(function (item) { itemByKey['granted:' + canon(item.compare.num)] = item; });

    // 左侧（公开版）节点信息
    var baseClaims = result.publicItems.map(function (item) { return item.base; });
    var baseInfo = {};
    result.publicItems.forEach(function (item) {
      var num = canon(item.base.num);
      baseInfo[num] = { key: 'pub:' + num, status: item.status, dim: !visibleKeys['pub:' + num] };
    });

    // 右侧（授权版）节点信息：配对优先，其次并入目标，最后授权新增。
    var compareClaims = [], compareInfo = {}, compareKeyByNum = {};
    function ensureCompare(claim) {
      var num = canon(claim.num);
      if (!compareInfo[num]) {
        compareClaims.push(claim);
        compareInfo[num] = { key: '', status: '', dim: false, mergeCount: 0 };
      }
      return compareInfo[num];
    }
    result.publicItems.forEach(function (item) {
      if (item.compare) {
        var info = ensureCompare(item.compare);
        info.key = 'pub:' + canon(item.base.num);
        info.status = item.status;
        info.dim = !visibleKeys[info.key];
      } else if (item.mergedInto) {
        var target = ensureCompare(item.mergedInto);
        target.mergeCount++;
        if (!target.key) { target.key = 'pub:' + canon(item.base.num); target.status = 'merged_into'; }
      }
    });
    (result.grantedOnly || []).forEach(function (item) {
      var info = ensureCompare(item.compare);
      info.key = 'granted:' + canon(item.compare.num);
      info.status = 'added';
    });
    Object.keys(compareInfo).forEach(function (num) { compareKeyByNum[num] = compareInfo[num].key; });

    var links = buildTreeLinks(result).map(function (link) {
      link.dim = link.kind !== 'added' && !visibleKeys[link.key];
      return link;
    });

    var baseTree = buildClaimTree(baseClaims);
    var compareTree = buildClaimTree(compareClaims);

    var html = '<div class="claimtree-legend">' + LEGEND.map(function (entry) {
      return '<span class="claimtree-legend-item"><span class="claimtree-legend-swatch" style="border-color:' + STATUS_COLORS[entry.status] + '"></span>' + esc(entry.label) + '</span>';
    }).join('') + '</div>';
    html += '<div class="claimdiff-tree-wrap"><svg class="claimtree-links" aria-hidden="true"></svg>';
    html += '<div class="claimtree-side base"><header>公开版 · ' + (stats.baseTotal || baseClaims.length) + ' 项</header>' + (renderLevel(baseTree.roots, 'base', baseInfo, 0) || '<div class="claimtree-none">无权利要求数据</div>') + '</div>';
    html += '<div class="claimtree-mid"></div>';
    html += '<div class="claimtree-side compare"><header>授权版 · ' + (stats.compareTotal || compareClaims.length) + ' 项</header>' + (renderLevel(compareTree.roots, 'compare', compareInfo, 0) || '<div class="claimtree-none">无权利要求数据</div>') + '</div>';
    html += '</div>';
    html += '<p class="claimtree-hint">左侧为公开版独从权结构，右侧为授权版结构；实线表示权项演变去向，虚线表示整项删除 / 授权新增。悬停高亮对应关系，点击节点查看该权项的词句级变化详情。</p>';
    html += '<div class="claimtree-detail" hidden></div>';
    container.innerHTML = html;

    _current.container = container;
    _current.links = links;
    _current.itemByKey = itemByKey;
    _current.compareKeyByNum = compareKeyByNum;

    container.querySelectorAll('.claimtree-node-card').forEach(function (card) {
      card.addEventListener('mouseenter', function () { setHighlight(card.dataset.side, card.dataset.num); });
      card.addEventListener('mouseleave', function () { setHighlight(null, null); });
      card.addEventListener('click', function () { openDetail(card.dataset.side, card.dataset.num, card); });
    });

    _current.resizeHandler = function () { drawLinks(); wireLinkEvents(); };
    window.addEventListener('resize', _current.resizeHandler);
    requestAnimationFrame(function () {
      if (_current.container !== container || !container.isConnected) return;
      drawLinks();
      wireLinkEvents();
    });
  }

  return {
    buildClaimTree: buildClaimTree,
    buildTreeLinks: buildTreeLinks,
    render: render,
    _teardown: teardown
  };
})();
