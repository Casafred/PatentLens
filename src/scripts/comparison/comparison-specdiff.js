/*!
 * PatentLens - 智能比对模块 - 说明书变动点一键定位（特殊模式）
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260822
 *
 * 功能：输入两个公开号，以一个为锚点，采用"文本最大公约"算法
 * （段落级最长公共子序列 LCS）检查说明书是否有实质性文本变化：
 * 保留相同部分（折叠展示），高亮提取发生明显变化的地方。
 *
 * 算法分层：
 *   1. 段落级 LCS —— 说明书按段落号 [0001] 切分后求最长公共子序列，
 *      得到 相同(equal) / 锚点删除(delete) / 对比新增(insert) / 替换(replace) 块
 *   2. replace 块内部做句子级 LCS + 字符级前后缀收缩，精确定位变化字词
 *   3. 相似度 < 0.55 判定"明显变化"，0.55~0.9 为"细微调整"
 */

var ComparisonSpecDiff = (function () {
  var _state = {
    anchorNum: '',
    compareNum: '',
    anchorTitle: '',
    compareTitle: '',
    result: null,      // { ops, stats, anchorParas, compareParas }
    isLoading: false,
    error: ''
  };

  // ── 段落切分 ──────────────────────────────────────────────

  function normalizeParaMarkers(text) {
    if (!text) return '';
    return text.replace(/【([０-９0-9]{3,5})】/g, function (m, digits) {
      var half = digits.replace(/[０-９]/g, function (d) {
        return String.fromCharCode(d.charCodeAt(0) - 0xFEE0);
      });
      var n = parseInt(half, 10);
      return '[' + String(n).padStart(4, '0') + ']';
    });
  }

  function splitParagraphs(rawText) {
    if (!rawText) return [];
    var text = normalizeParaMarkers(String(rawText)).replace(/\r\n/g, '\n');
    var paras = [];

    if (/\[\d{3,5}\]/.test(text)) {
      var re = /\[(\d{3,5})\]/g;
      var match, lastIndex = -1, lastNum = null;
      while ((match = re.exec(text)) !== null) {
        if (lastIndex >= 0) {
          var body = text.substring(lastIndex, match.index).trim();
          if (body) paras.push({ num: '[' + lastNum + ']', text: body });
        } else {
          var head = text.substring(0, match.index).trim();
          if (head) paras.push({ num: '', text: head });
        }
        lastIndex = match.index;
        lastNum = match[1];
      }
      if (lastIndex >= 0) {
        var tail = text.substring(lastIndex).trim();
        if (tail) paras.push({ num: '[' + lastNum + ']', text: tail });
      }
    } else {
      text.split(/\n\s*\n/).forEach(function (block) {
        var t = block.trim();
        if (t) paras.push({ num: '', text: t });
      });
    }
    return paras;
  }

  // 段落比对键：去掉段落号与所有空白后的小写文本
  function paraKey(p) {
    return p.text.replace(/\[\d{3,5}\]/g, '').replace(/\s+/g, '').toLowerCase();
  }

  // ── 通用 LCS（段落级 / 句子级共用） ──────────────────────

  function lcsOps(aKeys, bKeys) {
    var n = aKeys.length, m = bKeys.length;
    var W = m + 1;
    var dirs = new Uint8Array((n + 1) * W);
    var len = new Uint32Array((n + 1) * W);

    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        if (aKeys[i] === bKeys[j]) {
          len[i * W + j] = len[(i + 1) * W + (j + 1)] + 1;
          dirs[i * W + j] = 0; // ↖ 相等
        } else {
          var down = len[(i + 1) * W + j];
          var right = len[i * W + (j + 1)];
          if (down >= right) { len[i * W + j] = down; dirs[i * W + j] = 1; } // ↑ 删除 a
          else { len[i * W + j] = right; dirs[i * W + j] = 2; }              // ← 插入 b
        }
      }
    }

    var ops = [];
    var x = 0, y = 0;
    while (x < n && y < m) {
      var d = dirs[x * W + y];
      if (d === 0) { ops.push({ type: 'equal', aIdx: x, bIdx: y }); x++; y++; }
      else if (d === 1) { ops.push({ type: 'delete', aIdx: x }); x++; }
      else { ops.push({ type: 'insert', bIdx: y }); y++; }
    }
    while (x < n) { ops.push({ type: 'delete', aIdx: x }); x++; }
    while (y < m) { ops.push({ type: 'insert', bIdx: y }); y++; }
    return ops;
  }

  // 连续 delete/insert 合并为块：纯删除 / 纯新增 / 替换
  function mergeBlocks(ops) {
    var merged = [];
    var i = 0;
    while (i < ops.length) {
      if (ops[i].type === 'equal') { merged.push(ops[i]); i++; continue; }
      var dels = [], ins = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'delete') dels.push(ops[i].aIdx);
        else ins.push(ops[i].bIdx);
        i++;
      }
      if (dels.length === 0) merged.push({ type: 'insert', bIdxs: ins });
      else if (ins.length === 0) merged.push({ type: 'delete', aIdxs: dels });
      else merged.push({ type: 'replace', aIdxs: dels, bIdxs: ins });
    }
    return merged;
  }

  // ── 句子级 / 字符级 inline diff ───────────────────────────

  function splitSentences(text) {
    if (!text) return [];
    var out = [];
    var re = /[^。！？；!?;.\n]*[。！？；!?;.]+|[^。！？；!?;.\n]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].trim()) out.push(m[0].trim());
    }
    return out;
  }

  function sentKey(s) { return s.replace(/\s+/g, '').toLowerCase(); }

  // 字符级前后缀收缩：找出 del/ins 文本真正变化的中段
  function charTrimDiff(delText, insText) {
    var s = 0;
    while (s < delText.length && s < insText.length && delText[s] === insText[s]) s++;
    var e = 0;
    while (e < delText.length - s && e < insText.length - s &&
           delText[delText.length - 1 - e] === insText[insText.length - 1 - e]) e++;
    return {
      prefix: delText.substring(0, s),
      del: delText.substring(s, delText.length - e),
      ins: insText.substring(s, insText.length - e),
      suffix: delText.substring(delText.length - e)
    };
  }

  // 对一组锚点段落 vs 对比段落做句子级 diff，返回可渲染片段
  // [{type:'eq'|'del'|'ins', text}]
  function inlineSegments(aTexts, bTexts) {
    var aSents = [], bSents = [];
    aTexts.forEach(function (t) { aSents = aSents.concat(splitSentences(t)); });
    bTexts.forEach(function (t) { bSents = bSents.concat(splitSentences(t)); });

    var ops = lcsOps(aSents.map(sentKey), bSents.map(sentKey));
    var blocks = mergeBlocks(ops);
    var segs = [];

    blocks.forEach(function (b) {
      if (b.type === 'equal') {
        segs.push({ type: 'eq', text: aSents[b.aIdx] });
      } else if (b.type === 'delete') {
        b.aIdxs.forEach(function (idx) { segs.push({ type: 'del', text: aSents[idx] }); });
      } else if (b.type === 'insert') {
        b.bIdxs.forEach(function (idx) { segs.push({ type: 'ins', text: bSents[idx] }); });
      } else {
        // replace：锚点句子 vs 对比句子，逐对做字符级收缩
        var aJoined = b.aIdxs.map(function (i) { return aSents[i]; }).join('');
        var bJoined = b.bIdxs.map(function (i) { return bSents[i]; }).join('');
        var t = charTrimDiff(aJoined, bJoined);
        if (t.prefix) segs.push({ type: 'eq', text: t.prefix });
        if (t.del) segs.push({ type: 'del', text: t.del });
        if (t.ins) segs.push({ type: 'ins', text: t.ins });
        if (t.suffix) segs.push({ type: 'eq', text: t.suffix });
      }
    });
    return segs;
  }

  // ── 相似度与变化分级 ─────────────────────────────────────

  // 自带字符 2-gram Dice 相似度（中英文通用，结果确定性高）
  function similarity(aText, bText) {
    if (!aText || !bText) return 0;
    var t1 = String(aText).replace(/\s+/g, '');
    var t2 = String(bText).replace(/\s+/g, '');
    if (t1 === t2) return 1;
    if (t1.length < 8 || t2.length < 8) return 0;
    var ga = {}, gb = {};
    var la = 0, lb = 0, k;
    for (var i = 0; i < t1.length - 1; i++) {
      k = t1.substr(i, 2);
      ga[k] = (ga[k] || 0) + 1;
      la++;
    }
    for (var j = 0; j < t2.length - 1; j++) {
      k = t2.substr(j, 2);
      gb[k] = (gb[k] || 0) + 1;
      lb++;
    }
    var inter = 0;
    for (k in ga) {
      if (ga.hasOwnProperty(k) && gb[k]) inter += Math.min(ga[k], gb[k]);
    }
    return (2 * inter) / (la + lb);
  }

  function classifyChange(sim) {
    return sim < 0.55 ? 'major' : 'minor';
  }

  // replace 块内部模糊配对：把粗合并的块拆分为细粒度
  // delete / insert / replace（单段对单段）变化，
  // 避免相邻的删除+修改+新增被误并成一张大变化卡。
  var PAIR_THRESHOLD = 0.4;

  function splitReplaceBlock(aIdxs, bIdxs, anchorParas, compareParas) {
    var pairs = [];
    for (var i = 0; i < aIdxs.length; i++) {
      for (var j = 0; j < bIdxs.length; j++) {
        var sim = similarity(anchorParas[aIdxs[i]].text, compareParas[bIdxs[j]].text);
        if (sim >= PAIR_THRESHOLD) pairs.push({ i: i, j: j, sim: sim });
      }
    }
    pairs.sort(function (x, y) {
      return (y.sim - x.sim) || (Math.abs(x.i - x.j) - Math.abs(y.i - y.j));
    });

    var aMatched = {}, bMatched = {};
    pairs.forEach(function (p) {
      if (aMatched[p.i] || bMatched[p.j]) return;
      aMatched[p.i] = p;
      bMatched[p.j] = p;
    });

    // 按文档顺序输出子变化
    var out = [];
    var i2 = 0, j2 = 0;
    while (i2 < aIdxs.length || j2 < bIdxs.length) {
      if (i2 < aIdxs.length && aMatched[i2]) {
        var p = aMatched[i2];
        while (j2 < p.j) {
          if (!bMatched[j2]) out.push({ type: 'insert', bIdx: bIdxs[j2] });
          j2++;
        }
        j2 = Math.max(j2, p.j + 1);
        out.push({ type: 'replace', aIdx: aIdxs[i2], bIdx: bIdxs[p.j], sim: p.sim });
        i2++;
      } else if (i2 < aIdxs.length) {
        out.push({ type: 'delete', aIdx: aIdxs[i2] });
        i2++;
      } else {
        if (!bMatched[j2]) out.push({ type: 'insert', bIdx: bIdxs[j2] });
        j2++;
      }
    }
    return out;
  }

  // ── 专利数据获取（复用全局缓存与 GP 查询） ────────────────

  function normalizeNum(input) {
    return ComparisonUtils.normalizePatentNumber(input);
  }

  async function fetchPatentData(num) {
    var normalized = normalizeNum(num);

    // 详情页内存缓存（web-app.js 中的全局 const _pdPatentCache）
    var mem = (typeof _pdPatentCache !== 'undefined') ? _pdPatentCache
            : (window._pdPatentCache || null);
    if (mem && mem[normalized] && mem[normalized].description) {
      return mem[normalized];
    }
    // localStorage 持久缓存
    if (typeof GPCache !== 'undefined') {
      var cached = GPCache.get(normalized);
      if (cached && cached.description) return cached;
    }

    if (typeof fetchPatentWithRetry !== 'function') {
      throw new Error('专利查询功能不可用');
    }
    var json = await fetchPatentWithRetry(normalized, 3);
    if (json && json.success && json.data) {
      var data = json.data;
      if (data.description) {
        if (typeof GPCache !== 'undefined') GPCache.set(normalized, data);
        if (mem) mem[normalized] = data;
      }
      return data;
    }
    throw new Error((json && json.error) ? json.error : '查询失败');
  }

  // ── 核心：计算变动点 ─────────────────────────────────────

  var MAX_PARAS = 2500; // LCS O(n·m) 保护上限

  function computeDiff(anchorDesc, compareDesc) {
    var anchorParas = splitParagraphs(anchorDesc);
    var compareParas = splitParagraphs(compareDesc);
    if (anchorParas.length > MAX_PARAS) anchorParas = anchorParas.slice(0, MAX_PARAS);
    if (compareParas.length > MAX_PARAS) compareParas = compareParas.slice(0, MAX_PARAS);

    var ops = mergeBlocks(lcsOps(anchorParas.map(paraKey), compareParas.map(paraKey)));

    var changes = [];   // 变化点（按文档顺序）
    var sames = [];     // 相同段落
    var stats = { anchorTotal: anchorParas.length, compareTotal: compareParas.length,
                  same: 0, major: 0, minor: 0, deleted: 0, inserted: 0 };

    ops.forEach(function (op) {
      if (op.type === 'equal') {
        stats.same++;
        sames.push({ aIdx: op.aIdx, bIdx: op.bIdx, para: anchorParas[op.aIdx] });
        return;
      }
      if (op.type === 'delete') {
        stats.deleted += op.aIdxs.length;
        changes.push({
          kind: 'delete',
          label: '锚点删除',
          aIdxs: op.aIdxs, bIdxs: [],
          aParas: op.aIdxs.map(function (i) { return anchorParas[i]; }),
          bParas: [],
          segs: inlineSegments(op.aIdxs.map(function (i) { return anchorParas[i].text; }), []),
          sim: 0
        });
        return;
      }
      if (op.type === 'insert') {
        stats.inserted += op.bIdxs.length;
        changes.push({
          kind: 'insert',
          label: '对比新增',
          aIdxs: [], bIdxs: op.bIdxs,
          aParas: [],
          bParas: op.bIdxs.map(function (i) { return compareParas[i]; }),
          segs: inlineSegments([], op.bIdxs.map(function (i) { return compareParas[i].text; })),
          sim: 0
        });
        return;
      }
      // replace：块内多段时先做模糊配对拆分为细粒度变化
      var subChanges;
      if (op.aIdxs.length > 1 || op.bIdxs.length > 1) {
        subChanges = splitReplaceBlock(op.aIdxs, op.bIdxs, anchorParas, compareParas);
      } else {
        subChanges = [{ type: 'replace', aIdx: op.aIdxs[0], bIdx: op.bIdxs[0] }];
      }

      subChanges.forEach(function (sub) {
        if (sub.type === 'delete') {
          stats.deleted++;
          changes.push({
            kind: 'delete',
            label: '锚点删除',
            aIdxs: [sub.aIdx], bIdxs: [],
            aParas: [anchorParas[sub.aIdx]],
            bParas: [],
            segs: inlineSegments([anchorParas[sub.aIdx].text], []),
            sim: 0
          });
          return;
        }
        if (sub.type === 'insert') {
          stats.inserted++;
          changes.push({
            kind: 'insert',
            label: '对比新增',
            aIdxs: [], bIdxs: [sub.bIdx],
            aParas: [],
            bParas: [compareParas[sub.bIdx]],
            segs: inlineSegments([], [compareParas[sub.bIdx].text]),
            sim: 0
          });
          return;
        }
        var aText = anchorParas[sub.aIdx].text;
        var bText = compareParas[sub.bIdx].text;
        var sim = sub.sim != null ? sub.sim : similarity(aText, bText);
        var grade = classifyChange(sim);
        stats[grade]++;
        changes.push({
          kind: grade,
          label: grade === 'major' ? '明显变化' : '细微调整',
          aIdxs: [sub.aIdx], bIdxs: [sub.bIdx],
          aParas: [anchorParas[sub.aIdx]],
          bParas: [compareParas[sub.bIdx]],
          segs: inlineSegments([aText], [bText]),
          sim: sim
        });
      });
    });

    return { changes: changes, sames: sames, stats: stats,
             anchorParas: anchorParas, compareParas: compareParas };
  }

  // ── UI 渲染 ──────────────────────────────────────────────

  function esc(str) { return ComparisonUtils.escapeHtml(str); }

  function renderSegs(segs) {
    var html = '';
    segs.forEach(function (s) {
      if (!s.text) return;
      if (s.type === 'eq') html += esc(s.text);
      else if (s.type === 'del') html += '<span class="sd-delim">' + esc(s.text) + '</span>';
      else html += '<span class="sd-ins">' + esc(s.text) + '</span>';
    });
    return html || '<span class="sd-empty">（无内容）</span>';
  }

  function paraRange(paras) {
    if (!paras.length) return '';
    var first = paras[0].num, last = paras[paras.length - 1].num;
    if (!first) return '段落';
    return first === last ? first : first + ' ~ ' + last;
  }

  function renderChangeCard(change, idx) {
    var cardCls = 'specdiff-change-card ' + change.kind;
    var html = '<div class="' + cardCls + '">';
    html += '  <div class="specdiff-change-head">';
    html += '    <span class="specdiff-change-tag ' + change.kind + '">' + change.label + '</span>';
    if (change.kind === 'major' || change.kind === 'minor') {
      html += '    <span class="specdiff-change-sim">相似度 ' + Math.round(change.sim * 100) + '%</span>';
    }
    html += '    <span class="specdiff-change-no">变动点 ' + (idx + 1) + '</span>';
    html += '  </div>';
    html += '  <div class="specdiff-change-grid">';
    // 锚点侧
    html += '    <div class="specdiff-col sd-anchor-col">';
    html += '      <div class="specdiff-col-head">锚点 ' + esc(_state.anchorNum) +
            (change.aParas.length ? ' · ' + paraRange(change.aParas) : '') + '</div>';
    html += '      <div class="specdiff-col-body">' + renderSegs(change.segs.filter(function (s) {
              return s.type !== 'ins';
            }).map(function (s) {
              return s.type === 'eq' ? s : { type: 'del', text: s.text };
            })) + '</div>';
    html += '    </div>';
    // 对比侧
    html += '    <div class="specdiff-col sd-compare-col">';
    html += '      <div class="specdiff-col-head">对比 ' + esc(_state.compareNum) +
            (change.bParas.length ? ' · ' + paraRange(change.bParas) : '') + '</div>';
    html += '      <div class="specdiff-col-body">' + renderSegs(change.segs.filter(function (s) {
              return s.type !== 'del';
            }).map(function (s) {
              return s.type === 'eq' ? s : { type: 'ins', text: s.text };
            })) + '</div>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderResultHtml() {
    var r = _state.result;
    if (!r) return '';
    var s = r.stats;
    var html = '';

    // 统计条
    html += '<div class="specdiff-stats">';
    html += '  <span class="sd-stat"><b>' + s.anchorTotal + '</b> 段锚点说明书</span>';
    html += '  <span class="sd-stat"><b>' + s.compareTotal + '</b> 段对比说明书</span>';
    html += '  <span class="sd-stat ok"><b>' + s.same + '</b> 段相同</span>';
    html += '  <span class="sd-stat warn"><b>' + (s.major + s.minor) + '</b> 处变化（明显 ' + s.major + ' · 细微 ' + s.minor + '）</span>';
    html += '  <span class="sd-stat del"><b>' + s.deleted + '</b> 段删除</span>';
    html += '  <span class="sd-stat ins"><b>' + s.inserted + '</b> 段新增</span>';
    html += '</div>';

    // 变化点列表（明显变化在前高亮提取）
    if (r.changes.length > 0) {
      html += '<div class="specdiff-changes-title">变动点定位（' + r.changes.length + ' 处）</div>';
      r.changes.forEach(function (c, i) { html += renderChangeCard(c, i); });
    } else {
      html += '<div class="specdiff-nochange">两篇说明书的文本内容完全一致，未检测到实质性变化。</div>';
    }

    // 保留相同部分（折叠）
    if (r.sames.length > 0) {
      html += '<details class="specdiff-same"><summary>保留相同部分（' + r.sames.length + ' 段）</summary><div class="specdiff-same-list">';
      r.sames.forEach(function (item) {
        html += '<div class="specdiff-same-item">' +
          (item.para.num ? '<span class="sd-para-num">' + esc(item.para.num) + '</span>' : '') +
          '<span class="sd-same-text">' + esc(ComparisonUtils.truncateText(item.para.text, 120)) + '</span></div>';
      });
      html += '</div></details>';
    }
    return html;
  }

  function renderInputArea(container) {
    if (!container) return;
    var html = '<div class="comparison-input-panel specdiff-input-panel">';
    html += '  <div class="specdiff-intro">';
    html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    html += '    <div><strong>说明书变动点一键定位</strong>（文本最大公约算法）<br>';
    html += '    以<strong>锚点公开号</strong>的说明书为基准，检查对比公开号说明书的实质性文本变化：保留相同部分，高亮提取发生明显变化的地方。</div>';
    html += '  </div>';
    html += '  <div class="specdiff-input-row">';
    html += '    <div class="specdiff-input-item">';
    html += '      <label>锚点公开号（基准）</label>';
    html += '      <input type="text" id="specdiff-anchor-num" placeholder="如 CN110000000A" value="' + esc(_state.anchorNum) + '">';
    html += '    </div>';
    html += '    <div class="specdiff-input-item">';
    html += '      <label>对比公开号</label>';
    html += '      <input type="text" id="specdiff-compare-num" placeholder="如 CN110000001A" value="' + esc(_state.compareNum) + '">';
    html += '    </div>';
    html += '    <button class="btn-primary specdiff-run-btn" id="specdiff-run-btn"' + (_state.isLoading ? ' disabled' : '') + '>' + (_state.isLoading ? '正在定位…' : '开始定位变动点') + '</button>';
    html += '  </div>';
    if (_state.anchorTitle || _state.compareTitle) {
      html += '  <div class="specdiff-titles">' +
        (_state.anchorTitle ? '<span>锚点：' + esc(_state.anchorTitle) + '</span>' : '') +
        (_state.compareTitle ? '<span>对比：' + esc(_state.compareTitle) + '</span>' : '') + '</div>';
    }
    html += '  <div class="specdiff-status" id="specdiff-status"></div>';
    html += '  <div class="specdiff-result" id="specdiff-result">' + renderResultHtml() + '</div>';
    html += '</div>';
    container.innerHTML = html;

    var anchorInput = container.querySelector('#specdiff-anchor-num');
    var compareInput = container.querySelector('#specdiff-compare-num');
    var runBtn = container.querySelector('#specdiff-run-btn');
    if (anchorInput) anchorInput.addEventListener('input', function () { _state.anchorNum = this.value; });
    if (compareInput) compareInput.addEventListener('input', function () { _state.compareNum = this.value; });
    if (runBtn) runBtn.addEventListener('click', run);
    if (anchorInput && compareInput) {
      [anchorInput, compareInput].forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') run();
        });
      });
    }

    if (_state.error) {
      var status = container.querySelector('#specdiff-status');
      if (status) status.innerHTML = '<span class="specdiff-error">' + esc(_state.error) + '</span>';
    }
  }

  function _setStatus(msg, isError) {
    var el = document.getElementById('specdiff-status');
    if (!el) return;
    el.innerHTML = msg ? '<span class="' + (isError ? 'specdiff-error' : 'specdiff-progress') + '">' + esc(msg) + '</span>' : '';
  }

  // ── 运行 ─────────────────────────────────────────────────

  async function run() {
    var anchorNum = normalizeNum(_state.anchorNum);
    var compareNum = normalizeNum(_state.compareNum);
    _state.anchorNum = anchorNum;
    _state.compareNum = compareNum;

    if (!anchorNum || !compareNum) {
      _state.error = '请输入锚点公开号与对比公开号';
      _rerender();
      return;
    }
    if (anchorNum === compareNum) {
      _state.error = '两个公开号相同，无需对比';
      _rerender();
      return;
    }

    _state.isLoading = true;
    _state.error = '';
    _state.result = null;
    _rerender();
    _setStatus('正在查询两篇专利的说明书…');

    try {
      var anchorData = await fetchPatentData(anchorNum);
      _setStatus('已获取锚点专利，正在查询对比专利…');
      var compareData = await fetchPatentData(compareNum);

      if (!anchorData.description || !compareData.description) {
        throw new Error('至少其中一篇专利缺少说明书数据（' +
          (anchorData.description ? compareNum : anchorNum) + '），无法定位变动点');
      }

      _state.anchorTitle = anchorData.title || '';
      _state.compareTitle = compareData.title || '';

      _setStatus('正在计算文本最大公约（段落级比对）…');
      await new Promise(function (r) { setTimeout(r, 30); }); // 让状态先渲染

      _state.result = computeDiff(anchorData.description, compareData.description);
      _state.isLoading = false;
      _rerender();
    } catch (err) {
      _state.isLoading = false;
      _state.error = err && err.message ? err.message : String(err);
      _rerender();
    }
  }

  function _rerender() {
    var container = document.getElementById('comparison-input-area');
    if (container) renderInputArea(container);
  }

  // 供同族专利栏跳转调用：填入两个公开号并自动运行
  function enterWithPatents(anchorNum, compareNum) {
    _state.anchorNum = normalizeNum(anchorNum);
    _state.compareNum = normalizeNum(compareNum);
    _state.result = null;
    _state.error = '';
    if (typeof ComparisonCore !== 'undefined') {
      ComparisonCore.setInputMode('specdiff');
      ComparisonCore.setActiveTab('prepare');
    }
    if (typeof ComparisonUI !== 'undefined') {
      ComparisonUI.render();
    }
    run();
  }

  function getState() {
    return JSON.parse(JSON.stringify(_state));
  }

  return {
    splitParagraphs: splitParagraphs,
    computeDiff: computeDiff,
    inlineSegments: inlineSegments,
    renderInputArea: renderInputArea,
    enterWithPatents: enterWithPatents,
    getState: getState
  };
})();
