/*!
 * PatentLens - 权利要求变动定位（纯本地算法）
 *
 * 用于同一专利公开版与授权版的权利要求比对：先按文本相似性对齐权项，
 * 再定位权项、从属关系及技术特征的变化。该模块不调用 AI。
 */
var ComparisonClaimDiff = (function () {
  var _state = {
    baseNum: '',
    compareNum: '',
    baseTitle: '',
    compareTitle: '',
    result: null,
    isLoading: false,
    error: '',
    filter: 'changed'
  };

  var MATCH_THRESHOLD = 0.34;

  function esc(value) { return ComparisonUtils.escapeHtml(value || ''); }
  function normalizeNum(value) { return ComparisonUtils.normalizePatentNumber(value); }

  function normalizeText(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u3000]/g, ' ')
      .replace(/[，、]/g, ',')
      .replace(/[；]/g, ';')
      .replace(/[：]/g, ':')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function claimKey(claim) {
    return normalizeText(claim.text).replace(/[\s,;:.\-()[\]{}"'“”‘’]/g, '');
  }

  function splitFeatures(text) {
    var normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    var parts = normalized.split(/(?<=[;；])\s*|\n+/).map(function (part) {
      return part.trim();
    }).filter(Boolean);
    return parts.length ? parts : [normalized];
  }

  function featureKey(text) {
    return normalizeText(text).replace(/[\s,;:.\-()[\]{}"'“”‘’]/g, '');
  }

  function diceSimilarity(a, b) {
    var x = featureKey(a), y = featureKey(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length < 3 || y.length < 3) return 0;
    var gramsA = {}, gramsB = {}, totalA = 0, totalB = 0, i, gram;
    for (i = 0; i < x.length - 1; i++) { gram = x.substr(i, 2); gramsA[gram] = (gramsA[gram] || 0) + 1; totalA++; }
    for (i = 0; i < y.length - 1; i++) { gram = y.substr(i, 2); gramsB[gram] = (gramsB[gram] || 0) + 1; totalB++; }
    var common = 0;
    Object.keys(gramsA).forEach(function (key) {
      if (gramsB[key]) common += Math.min(gramsA[key], gramsB[key]);
    });
    return (2 * common) / (totalA + totalB);
  }

  function lcsOps(a, b) {
    var n = a.length, m = b.length, width = m + 1;
    var dirs = new Uint8Array((n + 1) * width);
    var lengths = new Uint16Array((n + 1) * width);
    var i, j;
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) {
          lengths[i * width + j] = lengths[(i + 1) * width + (j + 1)] + 1;
        } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
          lengths[i * width + j] = lengths[(i + 1) * width + j];
          dirs[i * width + j] = 1;
        } else {
          lengths[i * width + j] = lengths[i * width + (j + 1)];
          dirs[i * width + j] = 2;
        }
      }
    }
    var ops = [], x = 0, y = 0;
    while (x < n && y < m) {
      var direction = dirs[x * width + y];
      if (a[x] === b[y]) { ops.push({ type: 'equal', a: x, b: y }); x++; y++; }
      else if (direction === 1) { ops.push({ type: 'delete', a: x }); x++; }
      else { ops.push({ type: 'insert', b: y }); y++; }
    }
    while (x < n) { ops.push({ type: 'delete', a: x }); x++; }
    while (y < m) { ops.push({ type: 'insert', b: y }); y++; }
    return ops;
  }

  function mergeOps(ops) {
    var result = [], i = 0;
    while (i < ops.length) {
      if (ops[i].type === 'equal') { result.push(ops[i]); i++; continue; }
      var deleted = [], inserted = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'delete') deleted.push(ops[i].a);
        else inserted.push(ops[i].b);
        i++;
      }
      result.push({ type: deleted.length && inserted.length ? 'replace' : (deleted.length ? 'delete' : 'insert'), deleted: deleted, inserted: inserted });
    }
    return result;
  }

  function charDiff(a, b) {
    var start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    var end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return { prefix: a.slice(0, start), deleted: a.slice(start, a.length - end), inserted: b.slice(start, b.length - end), suffix: a.slice(a.length - end) };
  }

  function buildFeatureDiff(baseText, compareText) {
    var base = splitFeatures(baseText), compare = splitFeatures(compareText);
    var ops = mergeOps(lcsOps(base.map(featureKey), compare.map(featureKey)));
    var rows = [], counts = { added: 0, deleted: 0, modified: 0 };
    ops.forEach(function (op) {
      if (op.type === 'equal') {
        rows.push({ type: 'equal', base: base[op.a], compare: compare[op.b] });
      } else if (op.type === 'delete') {
        op.deleted.forEach(function (idx) { rows.push({ type: 'delete', base: base[idx], compare: '' }); counts.deleted++; });
      } else if (op.type === 'insert') {
        op.inserted.forEach(function (idx) { rows.push({ type: 'insert', base: '', compare: compare[idx] }); counts.added++; });
      } else {
        var baseJoined = op.deleted.map(function (idx) { return base[idx]; }).join(' ');
        var compareJoined = op.inserted.map(function (idx) { return compare[idx]; }).join(' ');
        rows.push({ type: 'replace', base: baseJoined, compare: compareJoined, diff: charDiff(baseJoined, compareJoined) });
        counts.modified++;
      }
    });
    return { rows: rows, counts: counts };
  }

  function extractDependencies(text) {
    var source = String(text || '');
    var result = [];
    var cn = source.match(/(?:根据|根據|如|按照|依据|依據)\s*(?:权利要求|權利要求|权项|權項)\s*([0-9０-９、,，\-－至和及或\s]+)/i);
    var en = source.match(/\bclaims?\s+([0-9]+(?:\s*(?:,|and|or|to|through|-)\s*[0-9]+)*)/i);
    var matched = cn ? cn[1] : (en ? en[1] : '');
    if (!matched) return result;
    matched.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .match(/\d+/g)?.forEach(function (value) {
        if (result.indexOf(value) === -1) result.push(value);
      });
    return result;
  }

  function classifyType(raw, text) {
    if (raw === 'independent' || raw === 'dependent') return raw;
    return extractDependencies(text).length ? 'dependent' : 'independent';
  }

  function alignmentText(text) {
    return String(text || '')
      .replace(/^(?:根据|根據|如|按照|依据|依據)\s*(?:权利要求|權利要求|权项|權項)\s*[0-9０-９、,，\-－至和及或\s]+(?:所述的|所述)?/i, '')
      .replace(/^the\s+.+?\s+of\s+claims?\s+[0-9,\s\-andorto]+,?\s*/i, '')
      .trim();
  }

  function prepareClaims(claims) {
    return (claims || []).map(function (claim, index) {
      var text = String(claim.text || '').trim();
      return {
        num: String(claim.num || (index + 1)),
        text: text,
        type: classifyType(claim.type, text),
        dependencies: extractDependencies(text),
        index: index,
        key: claimKey({ text: text }),
        alignment: alignmentText(text)
      };
    }).filter(function (claim) { return claim.text; });
  }

  function candidateScore(base, compare, baseTotal, compareTotal) {
    var text = diceSimilarity(base.alignment, compare.alignment);
    var feature = diceSimilarity(splitFeatures(base.alignment).join(' '), splitFeatures(compare.alignment).join(' '));
    var type = base.type === compare.type ? 0.08 : 0;
    var number = base.num === compare.num ? 0.06 : 0;
    var position = 0.04 * (1 - Math.min(1, Math.abs((base.index / Math.max(1, baseTotal - 1)) - (compare.index / Math.max(1, compareTotal - 1)))));
    return { score: text * 0.74 + feature * 0.08 + type + number + position, text: text };
  }

  function alignClaims(baseClaims, compareClaims) {
    var bases = prepareClaims(baseClaims), compares = prepareClaims(compareClaims);
    var pairs = [], usedBase = {}, usedCompare = {};

    // 完全相同的文本先全局匹配，避免权项编号变化被误报为删除和新增。
    bases.forEach(function (base) {
      compares.some(function (compare) {
        if (usedCompare[compare.index] || base.key !== compare.key) return false;
        pairs.push({ base: base, compare: compare, score: 1, exact: true });
        usedBase[base.index] = true;
        usedCompare[compare.index] = true;
        return true;
      });
    });

    var candidates = [];
    bases.forEach(function (base) {
      if (usedBase[base.index]) return;
      compares.forEach(function (compare) {
        if (usedCompare[compare.index]) return;
        var candidate = candidateScore(base, compare, bases.length, compares.length);
        if (candidate.score >= MATCH_THRESHOLD && candidate.text >= 0.22) {
          candidates.push({ base: base, compare: compare, score: candidate.score });
        }
      });
    });
    candidates.sort(function (a, b) {
      return (b.score - a.score) || (Math.abs(a.base.index - a.compare.index) - Math.abs(b.base.index - b.compare.index));
    });
    candidates.forEach(function (candidate) {
      if (usedBase[candidate.base.index] || usedCompare[candidate.compare.index]) return;
      pairs.push(candidate);
      usedBase[candidate.base.index] = true;
      usedCompare[candidate.compare.index] = true;
    });

    return { pairs: pairs, deleted: bases.filter(function (claim) { return !usedBase[claim.index]; }), added: compares.filter(function (claim) { return !usedCompare[claim.index]; }) };
  }

  function classifyPair(pair) {
    var base = pair.base, compare = pair.compare;
    var featureDiff = buildFeatureDiff(base.text, compare.text);
    var reasons = [];
    if (base.num !== compare.num) reasons.push('权项编号变化');
    if (base.type !== compare.type) reasons.push(base.type === 'dependent' ? '从属权利要求提升为独立权利要求' : '独立权利要求调整为从属权利要求');
    if (base.dependencies.join(',') !== compare.dependencies.join(',')) reasons.push('从属关系变化');
    if (featureDiff.counts.added || featureDiff.counts.deleted || featureDiff.counts.modified) reasons.push('技术特征变化');
    var status = 'same';
    if (base.type === 'dependent' && compare.type === 'independent') status = 'promoted';
    else if (base.type === 'independent' && compare.type === 'dependent') status = 'demoted';
    else if (reasons.length) status = 'modified';
    return { base: base, compare: compare, status: status, reasons: reasons, score: pair.score, featureDiff: featureDiff };
  }

  function computeDiff(baseClaims, compareClaims) {
    var aligned = alignClaims(baseClaims, compareClaims);
    var items = aligned.pairs.map(classifyPair);
    aligned.deleted.forEach(function (claim) {
      items.push({ base: claim, compare: null, status: 'deleted', reasons: ['整条权利要求删除'], score: 0, featureDiff: buildFeatureDiff(claim.text, '') });
    });
    aligned.added.forEach(function (claim) {
      items.push({ base: null, compare: claim, status: 'added', reasons: ['新增权利要求'], score: 0, featureDiff: buildFeatureDiff('', claim.text) });
    });
    items.sort(function (a, b) {
      var aIndex = a.base ? a.base.index : (a.compare ? a.compare.index + 0.5 : 0);
      var bIndex = b.base ? b.base.index : (b.compare ? b.compare.index + 0.5 : 0);
      return aIndex - bIndex;
    });
    var stats = { baseTotal: prepareClaims(baseClaims).length, compareTotal: prepareClaims(compareClaims).length, same: 0, changed: 0, added: 0, deleted: 0, promoted: 0, demoted: 0 };
    items.forEach(function (item) {
      if (item.status === 'same') stats.same++;
      else { stats.changed++; if (stats[item.status] !== undefined) stats[item.status]++; }
    });
    return { items: items, stats: stats };
  }

  function renderHighlighted(text, diff, side) {
    if (!diff || !diff.deleted && !diff.inserted) return esc(text);
    var changed = side === 'base' ? diff.deleted : diff.inserted;
    var css = side === 'base' ? 'cd-del' : 'cd-ins';
    return esc(diff.prefix) + (changed ? '<mark class="' + css + '">' + esc(changed) + '</mark>' : '') + esc(diff.suffix);
  }

  function renderFeatureRows(featureDiff) {
    var html = '<div class="claimdiff-feature-table">';
    featureDiff.rows.forEach(function (row) {
      var rowClass = row.type === 'equal' ? ' unchanged' : ' ' + row.type;
      html += '<div class="claimdiff-feature-row' + rowClass + '">';
      html += '<div class="claimdiff-feature-kind">' + ({ equal: '保留', delete: '删除', insert: '新增', replace: '修改' }[row.type] || '') + '</div>';
      html += '<div class="claimdiff-feature-cell base">' + (row.type === 'insert' ? '<span class="cd-empty">-</span>' : (row.type === 'replace' ? renderHighlighted(row.base, row.diff, 'base') : esc(row.base))) + '</div>';
      html += '<div class="claimdiff-feature-cell compare">' + (row.type === 'delete' ? '<span class="cd-empty">-</span>' : (row.type === 'replace' ? renderHighlighted(row.compare, row.diff, 'compare') : esc(row.compare))) + '</div>';
      html += '</div>';
    });
    return html + '</div>';
  }

  function statusLabel(status) {
    return { same: '未变化', modified: '内容修改', promoted: '从属转独立', demoted: '独立转从属', added: '新增权项', deleted: '删除权项' }[status] || status;
  }

  function claimLabel(claim) {
    if (!claim) return '—';
    return '权利要求 ' + esc(claim.num) + '<span class="claimdiff-type ' + claim.type + '">' + (claim.type === 'independent' ? '独立' : '从属') + '</span>';
  }

  function renderItem(item) {
    var base = item.base, compare = item.compare;
    var isChanged = item.status !== 'same';
    var html = '<details class="claimdiff-item ' + item.status + '"' + (isChanged ? ' open' : '') + '>';
    html += '<summary><div class="claimdiff-map-columns">';
    html += '<span class="claimdiff-map-claim">' + claimLabel(base) + '</span>';
    html += '<span class="claimdiff-map-arrow">→</span>';
    html += '<span class="claimdiff-map-claim">' + claimLabel(compare) + '</span>';
    html += '<span class="claimdiff-status ' + item.status + '">' + statusLabel(item.status) + '</span>';
    html += '<span class="claimdiff-summary">' + (item.reasons.join(' · ') || '文本和权项关系一致') + '</span>';
    html += '</div></summary>';
    html += '<div class="claimdiff-item-body">';
    if (base && compare) {
      var relation = '权项关系：' + (base.type === 'independent' ? '独立权利要求' : '从属权利要求' + (base.dependencies.length ? '（引用权' + base.dependencies.join('、') + '）' : '')) + ' → ' + (compare.type === 'independent' ? '独立权利要求' : '从属权利要求' + (compare.dependencies.length ? '（引用权' + compare.dependencies.join('、') + '）' : ''));
      html += '<div class="claimdiff-relation">' + esc(relation) + '</div>';
    }
    html += '<div class="claimdiff-detail-head"><span>基准版本</span><span>授权版本</span></div>';
    html += renderFeatureRows(item.featureDiff);
    html += '</div></details>';
    return html;
  }

  function renderResultHtml() {
    var result = _state.result;
    if (!result) return '';
    var stats = result.stats;
    var filter = _state.filter;
    var visible = result.items.filter(function (item) {
      if (filter === 'all') return true;
      if (filter === 'independent') return (item.base && item.base.type === 'independent') || (item.compare && item.compare.type === 'independent');
      if (filter === 'structure') return item.status === 'promoted' || item.status === 'demoted' || item.status === 'added' || item.status === 'deleted' || item.reasons.indexOf('从属关系变化') !== -1;
      return item.status !== 'same';
    });
    var html = '<div class="claimdiff-stats">';
    html += '<span><b>' + stats.baseTotal + '</b> 项公开版权利要求</span><span><b>' + stats.compareTotal + '</b> 项授权版权利要求</span>';
    html += '<span class="same"><b>' + stats.same + '</b> 项未变化</span><span class="changed"><b>' + stats.changed + '</b> 项发生变化</span>';
    html += '<span class="added"><b>' + stats.added + '</b> 项新增</span><span class="deleted"><b>' + stats.deleted + '</b> 项删除</span>';
    html += '</div>';
    html += '<div class="claimdiff-filterbar"><span>查看：</span>';
    [{ id: 'changed', label: '仅变化项' }, { id: 'independent', label: '独立权利要求' }, { id: 'structure', label: '结构变化' }, { id: 'all', label: '全部权项' }].forEach(function (option) {
      html += '<button class="claimdiff-filter' + (_state.filter === option.id ? ' active' : '') + '" data-filter="' + option.id + '">' + option.label + '</button>';
    });
    html += '</div>';
    html += '<div class="claimdiff-map-head"><span>公开版（基准）</span><span></span><span>授权版（对比）</span><span>结论</span><span>变化说明</span></div>';
    html += '<div class="claimdiff-list">' + (visible.length ? visible.map(renderItem).join('') : '<div class="claimdiff-empty">当前筛选条件下没有对应的权利要求变化。</div>') + '</div>';
    return html;
  }

  async function fetchPatentData(num) {
    var normalized = normalizeNum(num);
    var memory = typeof _pdPatentCache !== 'undefined' ? _pdPatentCache : window._pdPatentCache;
    if (memory && memory[normalized] && memory[normalized].claims && memory[normalized].claims.length) return memory[normalized];
    if (typeof GPCache !== 'undefined') {
      var cached = GPCache.get(normalized);
      if (cached && cached.claims && cached.claims.length) return cached;
    }
    if (typeof fetchPatentWithRetry !== 'function') throw new Error('专利查询功能不可用');
    var response = await fetchPatentWithRetry(normalized, 3);
    if (!response || !response.success || !response.data) throw new Error(response && response.error ? response.error : '查询失败');
    var data = response.data;
    if (memory) memory[normalized] = data;
    if (typeof GPCache !== 'undefined') GPCache.set(normalized, data);
    return data;
  }

  function renderInputArea(container) {
    if (!container) return;
    var html = '<div class="claimdiff-panel">';
    html += '<div class="claimdiff-intro"><div><strong>权利要求变动定位</strong><span>本地算法</span></div><p>先自动对齐最相似的权利要求，再定位新增、删除、独立/从属变化及技术特征修改。</p></div>';
    html += '<div class="claimdiff-input-row">';
    html += '<div class="claimdiff-input-card base"><label>公开版本（基准）</label><input id="claimdiff-base-num" type="text" placeholder="如 CN110000000A" value="' + esc(_state.baseNum) + '"></div>';
    html += '<button class="claimdiff-swap" id="claimdiff-swap" title="交换公开版本和授权版本"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h11l-3-3M17 17H6l3 3M18 7l-3 3M6 17l3-3"/></svg></button>';
    html += '<div class="claimdiff-input-card compare"><label>授权版本（对比）</label><input id="claimdiff-compare-num" type="text" placeholder="如 CN110000000B1" value="' + esc(_state.compareNum) + '"></div>';
    html += '<button class="btn-primary claimdiff-run" id="claimdiff-run"' + (_state.isLoading ? ' disabled' : '') + '>' + (_state.isLoading ? '正在定位…' : '开始定位变动') + '</button>';
    html += '</div>';
    if (_state.baseTitle || _state.compareTitle) html += '<div class="claimdiff-titles"><span>基准：' + esc(_state.baseTitle) + '</span><span>对比：' + esc(_state.compareTitle) + '</span></div>';
    html += '<div id="claimdiff-status" class="claimdiff-status">' + (_state.error ? '<span class="claimdiff-error">' + esc(_state.error) + '</span>' : '') + '</div>';
    html += '<div id="claimdiff-result">' + renderResultHtml() + '</div></div>';
    container.innerHTML = html;
    container.querySelector('#claimdiff-base-num').addEventListener('input', function () { _state.baseNum = this.value; });
    container.querySelector('#claimdiff-compare-num').addEventListener('input', function () { _state.compareNum = this.value; });
    container.querySelector('#claimdiff-run').addEventListener('click', run);
    container.querySelector('#claimdiff-swap').addEventListener('click', function () { var value = _state.baseNum; _state.baseNum = _state.compareNum; _state.compareNum = value; rerender(); });
    container.querySelectorAll('.claimdiff-filter').forEach(function (button) { button.addEventListener('click', function () { _state.filter = this.dataset.filter; rerender(); }); });
  }

  function setStatus(message, error) {
    var element = document.getElementById('claimdiff-status');
    if (element) element.innerHTML = message ? '<span class="' + (error ? 'claimdiff-error' : 'claimdiff-progress') + '">' + esc(message) + '</span>' : '';
  }

  async function run() {
    _state.baseNum = normalizeNum(_state.baseNum);
    _state.compareNum = normalizeNum(_state.compareNum);
    if (!_state.baseNum || !_state.compareNum) { _state.error = '请输入公开版本和授权版本的公开号'; rerender(); return; }
    if (_state.baseNum === _state.compareNum) { _state.error = '两个公开号相同，无需比对'; rerender(); return; }
    _state.isLoading = true; _state.error = ''; _state.result = null; rerender();
    try {
      setStatus('正在读取公开版权利要求…');
      var base = await fetchPatentData(_state.baseNum);
      setStatus('正在读取授权版权利要求…');
      var compare = await fetchPatentData(_state.compareNum);
      if (!base.claims || !base.claims.length || !compare.claims || !compare.claims.length) throw new Error('至少其中一篇专利缺少权利要求数据，无法定位变动');
      _state.baseTitle = base.title || '';
      _state.compareTitle = compare.title || '';
      setStatus('正在对齐最相似的权利要求并定位变动…');
      await new Promise(function (resolve) { setTimeout(resolve, 30); });
      _state.result = computeDiff(base.claims, compare.claims);
      _state.isLoading = false;
      rerender();
    } catch (error) {
      _state.isLoading = false;
      _state.error = error && error.message ? error.message : String(error);
      rerender();
    }
  }

  function rerender() {
    var container = document.getElementById('comparison-input-area');
    if (container) renderInputArea(container);
  }

  function inferPublicationFirst(first, second) {
    var a = normalizeNum(first), b = normalizeNum(second);
    var aGrant = /B\d*$/.test(a), bPublication = /A\d*$/.test(b);
    if (aGrant && bPublication) return { base: b, compare: a };
    return { base: a, compare: b };
  }

  function enterWithPatents(first, second) {
    var pair = inferPublicationFirst(first, second);
    _state.baseNum = pair.base; _state.compareNum = pair.compare; _state.result = null; _state.error = '';
    if (typeof ComparisonCore !== 'undefined') { ComparisonCore.setInputMode('claimdiff'); ComparisonCore.setActiveTab('prepare'); }
    if (typeof ComparisonUI !== 'undefined') ComparisonUI.render();
    run();
  }

  return { computeDiff: computeDiff, alignClaims: alignClaims, buildFeatureDiff: buildFeatureDiff, extractDependencies: extractDependencies, renderInputArea: renderInputArea, enterWithPatents: enterWithPatents, getState: function () { return JSON.parse(JSON.stringify(_state)); } };
})();
