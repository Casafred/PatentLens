/* PatentLens: reading aids for deterministic publication / grant comparison. */
var ClaimDiffReader = (function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function technical(item) { return !['same', 'renumbered', 'reference_only'].includes(item.status); }
  function annotateInheritance(publicItems, grantedOnly) {
    var before = new Map(), after = new Map(), all = publicItems.concat(grantedOnly || []), original = new Map();
    function number(n) { return String(n).replace(/^0+(?=\d)/, ''); }
    all.forEach(function (item) {
      original.set(item, item.status);
      if (item.base) before.set(number(item.base.num), item);
      if (item.compare) after.set(number(item.compare.num), item);
    });
    publicItems.forEach(function (item) {
      if (!item.compare || item.base.type !== 'dependent' || item.compare.type !== 'dependent') return;
      var affected = new Set();
      function walk(claim, map, side, visited) {
        (claim.dependencies || []).forEach(function (n) {
          var parent = map.get(number(n));
          if (!parent || parent === item || visited.has(parent)) return;
          visited.add(parent);
          if (!['same', 'renumbered', 'reference_only'].includes(original.get(parent))) affected.add(parent);
          var next = parent[side]; if (next) walk(next, map, side, visited);
        });
      }
      walk(item.base, before, 'base', new Set()); walk(item.compare, after, 'compare', new Set());
      if (!affected.size) return;
      item.inheritedFrom = Array.from(affected).map(function (parent) { return { baseNum: parent.base ? parent.base.num : null, compareNum: parent.compare ? parent.compare.num : null, status: original.get(parent) }; });
      if (['same', 'reference_only', 'renumbered'].includes(item.status)) {
        item.ownStatus = item.status; item.status = 'inherited_changed'; item.lineageType = item.status;
        item.reasons.push('自身技术内容未变，引用路径包含已变化权项');
      }
    });
  }
  function overview(result) {
    var content = result.publicItems.filter(technical), numbering = result.publicItems.filter(function (i) { return ['renumbered', 'reference_only'].includes(i.status); });
    var independent = content.filter(function (i) { return i.base.type === 'independent' || (i.compare && i.compare.type === 'independent'); });
    var html = '<section class="claimreader-overview"><div><small>先看变化，再核对原文</small><h3>' + (content.length || result.grantedOnly.length ? independent.length + ' 项独权涉及内容或结构变化' : '未发现内容或结构变化') + '</h3><p>编号与引用调整单列，点击卡片筛选；树中点击节点查看变化片段及完整原文。</p></div><div class="claimreader-cards">';
    [[content.length, '内容 / 结构变化', 'technical'], [numbering.length, '编号 / 引用调整', 'numbering'], [result.grantedOnly.length, '对比版本新增', 'added'], [result.stats.same, '保持一致', 'same']].forEach(function (card) {
      html += '<button type="button" class="claimdiff-filter claimreader-card" data-filter="' + card[2] + '"><b>' + card[0] + '</b><span>' + card[1] + '</span></button>';
    });
    return html + '</div><p class="claimreader-note">本地结果表示文本与引用关系的变化；自动对齐、限定并入属于候选对应关系，保护范围影响需结合完整权项判断。</p></section>';
  }
  function changeSummary(item) {
    if (item.status === 'same') return '<p class="claimreader-note">文本和引用关系一致。</p>';
    if (['reference_only', 'renumbered'].includes(item.status)) return '<p class="claimreader-note">仅编号或引用序号调整，自身技术内容未变化。引用路径仍应结合父项核对。</p>';
    var rows = ((item.featureDiff || {}).rows || []).filter(function (r) { return r.type !== 'equal'; });
    var html = '<section class="claimreader-changes"><h4>变化片段</h4>';
    if (item.inheritedFrom && item.inheritedFrom.length) html += '<p class="claimreader-review">引用路径影响：' + item.inheritedFrom.map(function (p) { return (p.baseNum ? '基准权' + esc(p.baseNum) : '无基准项') + ' → ' + (p.compareNum ? '对比权' + esc(p.compareNum) : '无对应项'); }).join('；') + '。请核对这些权项中的限定；择一引用需分别阅读各分支。</p>';
    if (item.status === 'inherited_changed') return html + '<p>本项自身技术内容未变，变化来自引用路径。下方保留本项完整原文。</p></section>';
    if ((item.compare || item.mergedInto) && (item.score < 0.6 || item.status === 'merged_into')) html += '<p class="claimreader-review">候选对应：' + (item.status === 'merged_into' ? '可能存在限定并入，需核对目标权项全部限定。' : '文本匹配较弱，请先核对这两个权项是否对应。') + '</p>';
    if (!rows.length) html += '<p>变化集中在权项结构或引用路径，见下方谱系与完整文本。</p>';
    else html += '<ol>' + rows.map(function (r) { return '<li><b>' + ({ insert: '新增', delete: '删除', replace: '改写' }[r.type] || '变化') + '</b>' + (r.base ? '<span class="claimreader-before">' + esc(r.base) + '</span>' : '') + (r.compare ? '<span class="claimreader-after">' + esc(r.compare) + '</span>' : '') + '</li>'; }).join('') + '</ol>';
    return html + '</section>';
  }
  function matches(item, filter) {
    if (filter === 'technical') return technical(item);
    if (filter === 'numbering') return ['reference_only', 'renumbered'].includes(item.status);
    if (filter === 'same') return item.status === 'same';
    if (filter === 'added') return false;
    return null;
  }
  return { overview: overview, changeSummary: changeSummary, matches: matches, technical: technical, annotateInheritance: annotateInheritance };
})();
