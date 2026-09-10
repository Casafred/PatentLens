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
    filter: 'all',
    referenceOnlyExpanded: false
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
    var parts = normalized.split(/(?<=[;；。])\s*|\n+|(?=[，,]\s*(?:其中|所述|并且|且|以及|wherein|and wherein))/i).map(function (part) {
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

  // 保留原文顺序的 token：中文按字，英文按词，数字整体，标点独立。
  function tokenize(text) {
    var source = String(text || ''), tokens = [], re = /[A-Za-z]+(?:['-][A-Za-z]+)*|\d+(?:\.\d+)?|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\sA-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|\s+/g, match;
    while ((match = re.exec(source))) {
      if (/^\s+$/.test(match[0])) {
        if (tokens.length && tokens[tokens.length - 1].text.slice(-1) !== ' ') tokens.push({ text: ' ', key: ' ' });
      } else tokens.push({ text: match[0], key: normalizeText(match[0]) });
    }
    return tokens;
  }

  function tokenDiff(a, b) {
    var left = tokenize(a), right = tokenize(b);
    var ops = mergeOps(lcsOps(left.map(function (t) { return t.key; }), right.map(function (t) { return t.key; })));
    return { left: left, right: right, ops: ops };
  }

  function pairFeatureOps(base, compare) {
    var n = base.length, m = compare.length, width = m + 1;
    var values = new Float64Array((n + 1) * width), dirs = new Uint8Array((n + 1) * width), i, j;
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
      var similarity = diceSimilarity(base[i - 1], compare[j - 1]);
      var paired = similarity >= 0.2 ? values[(i - 1) * width + j - 1] + similarity : -1000;
      var deleted = values[(i - 1) * width + j], inserted = values[i * width + j - 1];
      if (paired >= deleted && paired >= inserted) { values[i * width + j] = paired; dirs[i * width + j] = 3; }
      else if (deleted >= inserted) { values[i * width + j] = deleted; dirs[i * width + j] = 1; }
      else { values[i * width + j] = inserted; dirs[i * width + j] = 2; }
    }
    var result = []; i = n; j = m;
    while (i || j) {
      if (i && j && dirs[i * width + j] === 3) {
        result.unshift(featureKey(base[i - 1]) === featureKey(compare[j - 1]) ? { type: 'equal', a: i - 1, b: j - 1 } : { type: 'replace', deleted: [i - 1], inserted: [j - 1] }); i--; j--;
      } else if (i && (!j || dirs[i * width + j] === 1)) { result.unshift({ type: 'delete', deleted: [i - 1] }); i--; }
      else { result.unshift({ type: 'insert', inserted: [j - 1] }); j--; }
    }
    return result;
  }

  function buildFeatureDiff(baseText, compareText) {
    var base = splitFeatures(baseText), compare = splitFeatures(compareText);
    var ops = pairFeatureOps(base, compare), rows = [], counts = { added: 0, deleted: 0, modified: 0 };
    ops.forEach(function (op) {
      if (op.type === 'equal') rows.push({ type: 'equal', base: base[op.a], compare: compare[op.b] });
      else if (op.type === 'delete') op.deleted.forEach(function (idx) { rows.push({ type: 'delete', base: base[idx], compare: '' }); counts.deleted++; });
      else if (op.type === 'insert') op.inserted.forEach(function (idx) { rows.push({ type: 'insert', base: '', compare: compare[idx] }); counts.added++; });
      else {
        var left = base[op.deleted[0]], right = compare[op.inserted[0]];
        rows.push({ type: 'replace', base: left, compare: right, diff: tokenDiff(left, right) }); counts.modified++;
      }
    });
    return { rows: rows, counts: counts, inline: tokenDiff(baseText, compareText) };
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
    var value = String(text || '')
      .replace(/^\s*\d+[.、]\s*/, '')
      .replace(/^(?:根据|根據|如|按照|依据|依據)\s*(?:权利要求|權利要求|权项|權項)\s*[0-9０-９、,，\-－至和及或\s]+(?:所述的|所述)?/i, '')
      .replace(/^the\s+.+?\s+of\s+claims?\s+[0-9,\s\-andorto]+,?\s*/i, '')
      .trim();
    var cnWherein = value.search(/[，,]\s*(?:其中|其特征在于|其特徵在於)/);
    var enWherein = value.search(/,\s*(?:wherein|in which)\b/i);
    var start = cnWherein >= 0 ? cnWherein + 1 : (enWherein >= 0 ? enWherein + 1 : -1);
    return start >= 0 ? value.slice(start).trim() : value;
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
        alignment: alignmentText(text),
        ownKey: featureKey(alignmentText(text))
      };
    }).filter(function (claim) { return claim.text; });
  }

  function gramOverlap(a, b) {
    var x = featureKey(a), y = featureKey(b);
    if (!x || !y) return 0;
    if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return Math.min(x.length, y.length) / Math.max(x.length, y.length) * 0.35 + 0.65;
    var shortText = x.length <= y.length ? x : y, longText = x.length <= y.length ? y : x;
    if (shortText.length < 2) return 0;
    var grams = {}, common = 0, i;
    for (i = 0; i < longText.length - 1; i++) grams[longText.substr(i, 2)] = true;
    for (i = 0; i < shortText.length - 1; i++) if (grams[shortText.substr(i, 2)]) common++;
    return common / (shortText.length - 1);
  }

  function dependencyScore(base, compare, parentMap) {
    if (base.type !== 'dependent' || compare.type !== 'dependent') return 0;
    var mapped = base.dependencies.map(function (num) { return parentMap[num]; }).filter(Boolean);
    if (!mapped.length) return 0;
    var hits = mapped.filter(function (num) { return compare.dependencies.indexOf(num) !== -1; }).length;
    return hits ? 0.18 * hits / mapped.length : -0.1;
  }

  function candidateScore(base, compare, baseTotal, compareTotal, parentMap) {
    var full = diceSimilarity(base.text, compare.text);
    var own = diceSimilarity(base.alignment, compare.alignment);
    var contained = gramOverlap(base.alignment, compare.text);
    var content = Math.max(own, contained * 0.86);
    var type = base.type === compare.type ? 0.08 : -0.02;
    var number = base.num === compare.num ? 0.035 : 0;
    var position = 0.035 * (1 - Math.min(1, Math.abs((base.index / Math.max(1, baseTotal - 1)) - (compare.index / Math.max(1, compareTotal - 1)))));
    var relation = dependencyScore(base, compare, parentMap || {});
    return { score: full * 0.32 + content * 0.5 + type + number + position + relation, text: Math.max(full, content), full: full, own: own };
  }

  // 权利要求通常保持大体顺序；序列动态规划可避免局部高分抢走后续正确匹配。
  function sequenceMatch(bases, compares, scorer, threshold) {
    var n = bases.length, m = compares.length, width = m + 1;
    var values = new Float64Array((n + 1) * width), dirs = new Uint8Array((n + 1) * width), i, j;
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var candidate = scorer(bases[i - 1], compares[j - 1]);
        var match = values[(i - 1) * width + j - 1] + (candidate.score >= threshold && candidate.text >= 0.22 ? candidate.score - threshold + 0.01 : -1000);
        var skipBase = values[(i - 1) * width + j], skipCompare = values[i * width + j - 1];
        if (match >= skipBase && match >= skipCompare) { values[i * width + j] = match; dirs[i * width + j] = 3; }
        else if (skipBase >= skipCompare) { values[i * width + j] = skipBase; dirs[i * width + j] = 1; }
        else { values[i * width + j] = skipCompare; dirs[i * width + j] = 2; }
      }
    }
    var pairs = []; i = n; j = m;
    while (i && j) {
      if (dirs[i * width + j] === 3) { var score = scorer(bases[i - 1], compares[j - 1]); pairs.unshift({ base: bases[i - 1], compare: compares[j - 1], score: score.score }); i--; j--; }
      else if (dirs[i * width + j] === 1) i--;
      else j--;
    }
    return pairs;
  }

  function alignClaims(baseClaims, compareClaims) {
    var bases = prepareClaims(baseClaims), compares = prepareClaims(compareClaims), pairs = [], usedBase = {}, usedCompare = {}, parentMap = {};
    function accept(next) {
      next.forEach(function (pair) { pairs.push(pair); usedBase[pair.base.index] = true; usedCompare[pair.compare.index] = true; parentMap[pair.base.num] = pair.compare.num; });
    }
    var independentBases = bases.filter(function (claim) { return claim.type === 'independent'; });
    var independentCompares = compares.filter(function (claim) { return claim.type === 'independent'; });
    accept(sequenceMatch(independentBases, independentCompares, function (base, compare) {
      return candidateScore(base, compare, bases.length, compares.length, parentMap);
    }, 0.35));
    var remainingBases = bases.filter(function (claim) { return !usedBase[claim.index]; });
    var remainingCompares = compares.filter(function (claim) { return !usedCompare[claim.index]; });
    accept(sequenceMatch(remainingBases, remainingCompares, function (base, compare) {
      return candidateScore(base, compare, bases.length, compares.length, parentMap);
    }, MATCH_THRESHOLD));
    pairs.sort(function (a, b) { return a.base.index - b.base.index; });
    return { bases: bases, compares: compares, pairs: pairs, deleted: bases.filter(function (claim) { return !usedBase[claim.index]; }), added: compares.filter(function (claim) { return !usedCompare[claim.index]; }), parentMap: parentMap };
  }

  function parentMigration(base, compare, parentMap) {
    if (base.type !== 'dependent' || compare.type !== 'dependent') return null;
    var mapped = base.dependencies.map(function (num) { return parentMap[num] || num; });
    var changed = base.dependencies.join(',') !== compare.dependencies.join(',');
    return changed ? { from: base.dependencies, mapped: mapped, to: compare.dependencies, coherent: mapped.join(',') === compare.dependencies.join(',') } : null;
  }

  function classifyPair(pair, parentMap) {
    var base = pair.base, compare = pair.compare, featureDiff = buildFeatureDiff(base.text, compare.text), reasons = [];
    var migration = parentMigration(base, compare, parentMap);
    var referenceOnly = !!(migration && migration.coherent && base.ownKey === compare.ownKey);
    if (referenceOnly) featureDiff.counts = { added: 0, deleted: 0, modified: 0 };
    if (base.num !== compare.num) reasons.push('权项编号变化');
    if (base.type !== compare.type) reasons.push(base.type === 'dependent' ? '从属权利要求提升为独立权利要求' : '独立权利要求调整为从属权利要求');
    if (migration) reasons.push(referenceOnly ? '仅因父项映射更新引用序号' : (migration.coherent ? '随父项迁移' : '从属关系调整'));
    if (base.key !== compare.key && !referenceOnly) reasons.push('文字或技术特征变化');
    var status = 'same';
    if (base.type === 'dependent' && compare.type === 'independent') status = 'promoted';
    else if (base.type === 'independent' && compare.type === 'dependent') status = 'demoted';
    else if (referenceOnly) status = 'reference_only';
    else if (migration) status = 'dependency_migrated';
    else if (base.key === compare.key && base.num !== compare.num) status = 'renumbered';
    else if (base.key !== compare.key) status = 'modified';
    return { base: base, compare: compare, primaryGranted: compare, status: status, lineageType: status, reasons: reasons, score: pair.score, featureDiff: featureDiff, parentMigration: migration, mergedInto: null };
  }

  function findMergedTarget(base, compares, parentMap) {
    if (base.type !== 'dependent' || base.ownKey.length < 4) return null;
    var preferred = base.dependencies.map(function (num) { return parentMap[num]; }).filter(Boolean), best = null;
    var core = base.alignment.replace(/其中|其特征在于|其特徵在於|所述|上述|该|該|还|還|包括|包含|wherein|said|the/gi, '');
    compares.forEach(function (compare) {
      var containment = Math.max(gramOverlap(base.alignment, compare.text), gramOverlap(core, compare.text));
      var similarity = Math.max(diceSimilarity(base.alignment, compare.text), diceSimilarity(core, compare.text));
      var parentBonus = preferred.indexOf(compare.num) !== -1 ? 0.14 : 0;
      var score = containment * 0.72 + similarity * 0.28 + parentBonus;
      if (containment >= 0.58 && (!best || score > best.score)) best = { claim: compare, score: score, containment: containment };
    });
    return best;
  }

  function computeDiff(baseClaims, compareClaims) {
    var aligned = alignClaims(baseClaims, compareClaims), pairByBase = {};
    aligned.pairs.forEach(function (pair) { pairByBase[pair.base.index] = pair; });
    var publicItems = aligned.bases.map(function (base) {
      if (pairByBase[base.index]) return classifyPair(pairByBase[base.index], aligned.parentMap);
      var merged = findMergedTarget(base, aligned.compares, aligned.parentMap);
      if (merged) return { base: base, compare: null, primaryGranted: null, status: 'merged_into', lineageType: 'merged_into', reasons: ['附加限定并入授权权利要求 ' + merged.claim.num], score: merged.score, featureDiff: buildFeatureDiff(base.text, merged.claim.text), parentMigration: null, mergedInto: merged.claim };
      return { base: base, compare: null, primaryGranted: null, status: 'deleted', lineageType: 'deleted', reasons: ['整条权利要求删除'], score: 0, featureDiff: buildFeatureDiff(base.text, ''), parentMigration: null, mergedInto: null };
    });
    var grantedOnly = aligned.added.map(function (claim) { return { base: null, compare: claim, primaryGranted: claim, status: 'added', lineageType: 'added', reasons: ['授权版新增权利要求'], score: 0, featureDiff: buildFeatureDiff('', claim.text) }; });
    var stats = { baseTotal: aligned.bases.length, compareTotal: aligned.compares.length, same: 0, changed: 0, added: grantedOnly.length, deleted: 0, promoted: 0, demoted: 0, merged: 0, migrated: 0, referenceOnly: 0 };
    publicItems.forEach(function (item) {
      if (item.status === 'same') stats.same++; else stats.changed++;
      if (item.status === 'deleted') stats.deleted++;
      if (item.status === 'promoted') stats.promoted++;
      if (item.status === 'demoted') stats.demoted++;
      if (item.status === 'merged_into') stats.merged++;
      if (item.status === 'dependency_migrated') stats.migrated++;
      if (item.status === 'reference_only') stats.referenceOnly++;
    });
    return { publicItems: publicItems, grantedOnly: grantedOnly, items: publicItems.concat(grantedOnly), stats: stats };
  }

  function renderHighlighted(text, diff, side) {
    if (!diff || !diff.ops) return esc(text);
    var tokens = side === 'base' ? diff.left : diff.right, html = '';
    diff.ops.forEach(function (op) {
      if (op.type === 'equal') html += esc(tokens[side === 'base' ? op.a : op.b].text);
      else {
        var indexes = side === 'base' ? op.deleted : op.inserted;
        if (!indexes || !indexes.length) return;
        var changed = indexes.map(function (idx) { return tokens[idx].text; }).join('');
        html += '<mark class="' + (side === 'base' ? 'cd-del' : 'cd-ins') + '">' + esc(changed) + '</mark>';
      }
    });
    return html;
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
    return { same: '未变化', modified: '内容修改', renumbered: '仅编号变化', promoted: '从属转独立', demoted: '独立转从属', dependency_migrated: '随父项迁移', reference_only: '仅引用序号变化', merged_into: '限定并入', added: '授权新增', deleted: '整项删除' }[status] || status;
  }

  function claimLabel(claim) {
    if (!claim) return '—';
    return '权利要求 ' + esc(claim.num) + '<span class="claimdiff-type ' + claim.type + '">' + (claim.type === 'independent' ? '独立' : '从属') + '</span>';
  }

  function relationText(claim) {
    if (!claim) return '无对应权项';
    return claim.type === 'independent' ? '独立权利要求' : '从属权利要求' + (claim.dependencies.length ? '，引用权' + claim.dependencies.join('、') : '');
  }

  function renderFullText(item) {
    var base = item.base, target = item.compare || item.mergedInto;
    var diff = target ? item.featureDiff.inline : null;
    var html = '<div class="claimdiff-full-grid">';
    html += '<section class="claimdiff-full-text base"><header>公开权利要求 ' + esc(base.num) + '</header><p>' + (target ? renderHighlighted(base.text, diff, 'base') : '<mark class="cd-del">' + esc(base.text) + '</mark>') + '</p></section>';
    html += '<section class="claimdiff-full-text compare"><header>' + (target ? (item.mergedInto ? '并入授权权利要求 ' : '授权权利要求 ') + esc(target.num) : '授权版') + '</header><p>' + (target ? renderHighlighted(target.text, diff, 'compare') : '<span class="cd-empty">该公开权项未形成对应授权权项</span>') + '</p></section>';
    return html + '</div>';
  }

  function renderItem(item) {
    var base = item.base, compare = item.compare || item.mergedInto;
    var open = item.status !== 'reference_only' || _state.referenceOnlyExpanded;
    var html = '<details class="claimdiff-item ' + item.status + '"' + (open ? ' open' : '') + '>';
    html += '<summary><div class="claimdiff-map-columns">';
    html += '<span class="claimdiff-map-claim">' + claimLabel(base) + '</span>';
    html += '<span class="claimdiff-map-arrow">→</span>';
    html += '<span class="claimdiff-map-claim">' + claimLabel(compare) + '</span>';
    html += '<span class="claimdiff-status ' + item.status + '">' + statusLabel(item.status) + '</span>';
    html += '<span class="claimdiff-summary">' + (item.reasons.join(' · ') || '文本和权项关系一致') + '</span>';
    html += '</div></summary>';
    html += '<div class="claimdiff-item-body">';
    html += '<div class="claimdiff-relation"><b>谱系判断</b><span>' + esc(relationText(base) + ' → ' + relationText(compare)) + '</span>';
    if (item.parentMigration) html += '<span>父项路径：公开权' + esc(item.parentMigration.from.join('、')) + ' → 授权权' + esc(item.parentMigration.to.join('、')) + '</span>';
    html += '</div>';
    html += renderFullText(item);
    if (compare) html += '<details class="claimdiff-features"><summary>查看技术特征拆分</summary><div class="claimdiff-detail-head"><span>公开版本</span><span>授权版本</span></div>' + renderFeatureRows(item.featureDiff) + '</details>';
    html += '</div></details>';
    return html;
  }

  function renderGrantedOnly(item) {
    return '<article class="claimdiff-granted-only"><header>' + claimLabel(item.compare) + '<span class="claimdiff-status added">授权新增</span></header><p><mark class="cd-ins">' + esc(item.compare.text) + '</mark></p></article>';
  }

  function renderResultHtml() {
    var result = _state.result;
    if (!result) return '';
    var stats = result.stats;
    var filter = _state.filter;
    var visible = result.publicItems.filter(function (item) {
      if (filter === 'all') return true;
      if (filter === 'independent') return item.base.type === 'independent' || (item.compare && item.compare.type === 'independent');
      if (filter === 'structure') return item.status === 'promoted' || item.status === 'demoted' || item.status === 'deleted' || item.status === 'merged_into' || item.status === 'dependency_migrated' || item.status === 'reference_only';
      return item.status !== 'same';
    });
    var html = '<div class="claimdiff-stats">';
    html += '<span><b>' + stats.baseTotal + '</b> 项公开版权利要求</span><span><b>' + stats.compareTotal + '</b> 项授权版权利要求</span>';
    html += '<span class="same"><b>' + stats.same + '</b> 项未变化</span><span class="changed"><b>' + stats.changed + '</b> 项发生变化</span>';
    html += '<span class="added"><b>' + stats.added + '</b> 项新增</span><span class="deleted"><b>' + stats.deleted + '</b> 项删除</span>';
    html += '</div>';
    html += '<div class="claimdiff-filterbar"><span>查看：</span>';
    [{ id: 'all', label: '全部公开权项' }, { id: 'changed', label: '仅变化项' }, { id: 'independent', label: '独立权利要求' }, { id: 'structure', label: '谱系变化' }].forEach(function (option) {
      html += '<button class="claimdiff-filter' + (_state.filter === option.id ? ' active' : '') + '" data-filter="' + option.id + '">' + option.label + '</button>';
    });
    if (stats.referenceOnly) html += '<button class="claimdiff-reference-toggle" id="claimdiff-toggle-reference" type="button">' + (_state.referenceOnlyExpanded ? '折叠' : '展开') + '仅引用序号变化项（' + stats.referenceOnly + '）</button>';
    html += '</div>';
    html += '<div class="claimdiff-section-title"><strong>公开版权利要求演变</strong><span>以公开版原始顺序完整展示</span></div>';
    html += '<div class="claimdiff-map-head"><span>公开版（主轴）</span><span></span><span>授权版去向</span><span>结论</span><span>变化说明</span></div>';
    html += '<div class="claimdiff-list">' + (visible.length ? visible.map(renderItem).join('') : '<div class="claimdiff-empty">当前筛选条件下没有对应的权利要求变化。</div>') + '</div>';
    if (result.grantedOnly.length) html += '<section class="claimdiff-granted-section"><div class="claimdiff-section-title"><strong>授权版新增权利要求</strong><span>未由某一公开权项直接演变而来</span></div>' + result.grantedOnly.map(renderGrantedOnly).join('') + '</section>';
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
    var referenceToggle = container.querySelector('#claimdiff-toggle-reference');
    if (referenceToggle) referenceToggle.addEventListener('click', function () { _state.referenceOnlyExpanded = !_state.referenceOnlyExpanded; rerender(); });
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
    _state.isLoading = true; _state.error = ''; _state.result = null; _state.referenceOnlyExpanded = false; rerender();
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
    _state.baseNum = pair.base; _state.compareNum = pair.compare; _state.result = null; _state.error = ''; _state.referenceOnlyExpanded = false;
    if (typeof ComparisonCore !== 'undefined') { ComparisonCore.setInputMode('claimdiff'); ComparisonCore.setActiveTab('prepare'); }
    if (typeof ComparisonUI !== 'undefined') ComparisonUI.render();
    run();
  }

  return { computeDiff: computeDiff, alignClaims: alignClaims, buildFeatureDiff: buildFeatureDiff, tokenDiff: tokenDiff, extractDependencies: extractDependencies, renderInputArea: renderInputArea, enterWithPatents: enterWithPatents, getState: function () { return JSON.parse(JSON.stringify(_state)); } };
})();
