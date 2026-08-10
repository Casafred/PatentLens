(function () {
  "use strict";

  // ── 时间轴关键节点扩展 ──
  // 在 legacy renderTimeline（web-app.js）基础上，将「授权通知」(allowance)
  // 纳入重要节点显示，使其与审查意见 / 申请人答复 / 专利文件采用同样的
  // 关键节点渲染逻辑（带卡片、大圆点、图标，而非折叠的小圆点）。
  //
  // web-app.js 已冻结（禁止新增行），此处采用与 timeline-popup-stability.js
  // 一致的运行时覆盖模式：复制原 renderTimeline / _tlSelectKey 实现，仅修改
  // keyTypes 集合。legacy 实现保持不动，由本模块在加载后覆盖全局函数。
  //
  // keyTypes 同时被「全选关键文档」按钮（_tlSelectKey）使用，两处必须一致，
  // 否则时间轴显示的关键节点与按钮勾选范围会不一致。

  var KEY_TYPES = new Set(["response", "office_action", "patent_doc", "allowance"]);

  window._tlSelectKey = function () {
    if (!_tlSelectMode) return;
    _tlSelected.clear();
    (kanbanState.documents || []).forEach(function (it) {
      if (KEY_TYPES.has(it.type)) _tlSelected.add(it.idx);
    });
    _applyTimelineSelection();
    _updateTimelineSelectSummary();
    _syncFabState();
  };

  window.renderTimeline = function (data) {
    var board = document.getElementById("tl-board") || document.getElementById("timeline-board");
    var statusEl = document.getElementById("tl-status") || document.getElementById("timeline-status");
    if (!board) return;

    var items = kanbanState.documents;
    if (!items || items.length === 0) {
      board.innerHTML = '<p class="placeholder">请先查询专利，审查文档加载后可生成时间轴。</p>';
      if (statusEl) statusEl.textContent = "";
      return;
    }

    // 显示全部文档，与概要/审查文档列表/审查分栏看板保持数量一致
    // ── 时间倒序：最新文档在前 ──
    var sorted = items.slice().sort(function (a, b) {
      var da = parseDate(a.date);
      var db = parseDate(b.date);
      return db - da;
    });

    if (sorted.length === 0) {
      board.innerHTML = '<p class="placeholder">未找到审查节点</p>';
      return;
    }

    var keyTypes = KEY_TYPES;

    var dotClassMap = {
      office_action: "tl-dot-oa",
      response: "tl-dot-response",
      applicant_request: "tl-dot-applicant-request",
      allowance: "tl-dot-allowance",
      notification: "tl-dot-notification",
      citation: "tl-dot-citation",
      patent_doc: "tl-dot-patentdoc",
      misc: "tl-dot-misc",
    };

    var typeLabelMap = {
      office_action: "审查意见",
      response: "申请人答复",
      applicant_request: "申请人其他请求",
      allowance: "授权通知",
      notification: "通知",
      citation: "审查员引用",
      patent_doc: "专利文件",
      misc: "其他",
    };

    var typeIconMap = {
      office_action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      response: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
      applicant_request: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      allowance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      notification: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
      citation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      patent_doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      misc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };

    // ── 按日期分组 ──
    var groups = [];
    sorted.forEach(function (item) {
      var last = groups[groups.length - 1];
      if (last && last.date === item.date) {
        last.items.push(item);
      } else {
        groups.push({ date: item.date, items: [item] });
      }
    });

    groups.forEach(function (g) {
      var ts = parseDate(g.date);
      g.year = ts ? new Date(ts).getFullYear() : null;
      g.timestamp = ts;
      g.keyItems = g.items.filter(function (it) { return keyTypes.has(it.type); });
      g.otherItems = g.items.filter(function (it) { return !keyTypes.has(it.type); });
      g.hasKey = g.keyItems.length > 0;
      g.primaryItem = g.hasKey ? g.keyItems[0] : g.items[0];
      g.extraKeyItems = g.hasKey ? g.keyItems.slice(1) : [];
    });

    // ── 稳定S轴布局参数（倒序：第一行从左到右是最新→较旧，蛇形向下） ──
    var COL_WIDTH = 200;
    var ROW_HEIGHT = 320; // 增大行距：上下两排相向的卡片间留出明显空隙，避免贴合误认
    var EDGE_PAD = 80;
    var CURVE_R = 22;
    var TOP_PAD = 150;
    var BOTTOM_PAD = 150;

    var boardWidth = Math.max(board.clientWidth || 960, 640);
    var usableWidth = boardWidth - 48;
    var colsPerRow = Math.max(3, Math.floor((usableWidth - EDGE_PAD * 2) / COL_WIDTH) + 1);
    colsPerRow = Math.min(5, colsPerRow);

    // 按蛇形排列分组 - 预计算每个节点精确位置
    var nodePositions = [];
    var totalNodes = groups.length;
    var totalRows = Math.ceil(totalNodes / colsPerRow);
    var totalWidth = EDGE_PAD * 2 + (colsPerRow - 1) * COL_WIDTH;
    var totalHeight = TOP_PAD + BOTTOM_PAD + (totalRows - 1) * ROW_HEIGHT;

    // 预计算每个节点的位置（蛇形路径，时间倒序：idx=0是最新）
    groups.forEach(function (g, idx) {
      var rowIdx = Math.floor(idx / colsPerRow);
      var colInRow = idx % colsPerRow;
      var isEvenRow = (rowIdx % 2 === 0);
      var colPos = isEvenRow ? colInRow : (colsPerRow - 1 - colInRow);

      nodePositions.push({
        group: g,
        x: EDGE_PAD + colPos * COL_WIDTH,
        y: TOP_PAD + rowIdx * ROW_HEIGHT,
        rowIdx: rowIdx,
        colPos: colPos,
        isEvenRow: isEvenRow,
        cardsAbove: isEvenRow
      });
    });

    // ── 构建精确稳定的S路径：逐个节点连接 ──
    function buildStableSPath() {
      var r = CURVE_R;
      var d = '';

      for (var i = 0; i < nodePositions.length; i++) {
        var np = nodePositions[i];
        var nextNp = nodePositions[i + 1];

        if (i === 0) {
          d += "M " + np.x + " " + np.y;
        }

        if (!nextNp) break;

        var sameRow = (np.rowIdx === nextNp.rowIdx);

        if (sameRow) {
          d += " L " + nextNp.x + " " + nextNp.y;
        } else {
          var y = np.y;
          var nextY = nextNp.y;
          var endX = np.x;
          var nextStartX = nextNp.x;
          var goingRight = np.isEvenRow;

          if (goingRight) {
            d += " A " + r + " " + r + " 0 0 1 " + (endX + r) + " " + (y + r);
            d += " L " + (nextStartX + r) + " " + (nextY - r);
            d += " A " + r + " " + r + " 0 0 1 " + nextStartX + " " + nextY;
          } else {
            d += " A " + r + " " + r + " 0 0 0 " + (endX - r) + " " + (y + r);
            d += " L " + (nextStartX - r) + " " + (nextY - r);
            d += " A " + r + " " + r + " 0 0 0 " + nextStartX + " " + nextY;
          }
        }
      }
      return d;
    }

    var stablePath = buildStableSPath();

    // ── Helpers ──
    function extractCnTitle(it) {
      var enName = it.name || '';
      var cnDesc = it.desc || it.docDesc || it.documentDescription || it.description || '';
      var hasCn = /[\u4e00-\u9fff]/.test(cnDesc);
      var displayCn = hasCn ? cnDesc.replace(/[（(].*?[）)]\s*$/, '').trim() : '';
      return { enName: enName, displayCn: displayCn };
    }

    function buildCardHtml(it) {
      var dotClass = dotClassMap[it.type] || "tl-dot-misc";
      var typeLabel = typeLabelMap[it.type] || "其他";
      var isSelected = _tlSelected.has(it.idx);
      var isKey = keyTypes.has(it.type);
      var extracted = extractCnTitle(it);
      var enName = extracted.enName;
      var displayCn = extracted.displayCn;

      var keyClass = isKey ? ' tl-s-key tl-s-key-' + dotClass : '';
      var selectedClass = isSelected ? ' tl-s-selected' : '';

      var h = '<div class="tl-s-card' + keyClass + selectedClass + '" data-tl-idx="' + it.idx + '" role="checkbox" aria-checked="' + (isSelected ? 'true' : 'false') + '" tabindex="0" onclick="_jumpToDocFromTimeline(' + it.idx + ')">';
      // 勾选框指示器（选择模式下显示）
      h += '<span class="tl-s-check' + (isSelected ? ' checked' : '') + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
      if (displayCn) {
        h += '<div class="tl-s-cn">' + escapeHtml(displayCn) + '</div>';
        h += '<div class="tl-s-en" title="' + escapeHtml(enName) + '">' + escapeHtml(enName) + '</div>';
      } else {
        h += '<div class="tl-s-title">' + escapeHtml(enName) + '</div>';
      }
      h += '<div class="tl-s-meta">';
      h += '  <span class="tl-s-code">' + escapeHtml(it.docCode || '') + '</span>';
      h += '  <span class="tl-s-badge ' + dotClass + '">' + typeLabel + '</span>';
      h += '</div>';
      h += '</div>';
      return h;
    }

    // 年份颜色映射 - 简洁配色
    var uniqueYears = groups.map(function (g) { return g.year; }).filter(function (y) { return y !== null; });
    uniqueYears = Array.from(new Set(uniqueYears)).sort(function (a, b) { return b - a; });
    var yearColors = {};
    var yrPal = ['#6366f1','#3b82f6','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6'];
    uniqueYears.forEach(function (yr, i) { yearColors[yr] = yrPal[i % yrPal.length]; });

    // ── 构建HTML ──
    var html = '<div class="tl-s-wrapper"><div class="tl-s-container" style="width:' + totalWidth + 'px;height:' + totalHeight + 'px;">';

    // SVG路径 - 简洁稳定的S曲线，无多余发光
    html += '<svg class="tl-s-svg" viewBox="0 0 ' + totalWidth + ' ' + totalHeight + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">';
    html += '<path class="tl-s-path" d="' + stablePath + '" fill="none" stroke="var(--border)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    html += '</svg>';

    // 渲染节点
    var prevYear = null;
    nodePositions.forEach(function (np, idx) {
      var g = np.group;
      var x = np.x;
      var y = np.y;
      var cardsAbove = np.cardsAbove;

      var isYearStart = (g.year !== null && g.year !== prevYear);
      if (g.year !== null) prevYear = g.year;

      var primaryItem = g.primaryItem;
      var dotClass = dotClassMap[primaryItem.type] || "tl-dot-misc";
      var typeIcon = typeIconMap[primaryItem.type] || typeIconMap.misc;
      var totalAtDate = g.items.length;
      var hasFolded = totalAtDate > 1;

      html += '<div class="tl-s-node ' + (cardsAbove ? 'tl-s-above' : 'tl-s-below') + (g.hasKey ? '' : ' tl-s-folded-node') + '" data-tl-idx="' + primaryItem.idx + '" style="left:' + x + 'px;top:' + y + 'px;">';

      // 年份标记（仅在每行第一个或新年份时显示）
      if (isYearStart && g.year) {
        var yc = yearColors[g.year];
        html += '<div class="tl-s-yr-tick" style="--yc:' + yc + '">';
        html += '  <div class="tl-s-yr-label">' + g.year + '</div>';
        html += '</div>';
      }

      // 连接器（带类型颜色与箭头，指向所属卡片）
      html += '<div class="tl-s-connector ' + dotClass + '"></div>';

      // 节点圆点
      var dotSizeClass = g.hasKey ? 'tl-s-dot-key' : 'tl-s-dot-mini';
      html += '<div class="tl-s-dot ' + dotClass + ' ' + dotSizeClass + '">';
      if (g.hasKey) {
        html += typeIcon;
      } else {
        html += '<span class="tl-s-mini-count">' + totalAtDate + '</span>';
      }
      html += '</div>';

      // 日期标签
      html += '<div class="tl-s-date">' + escapeHtml(g.date) + '</div>';

      // 关键文档卡片
      if (g.hasKey) {
        html += '<div class="tl-s-card-wrap">';
        html += buildCardHtml(primaryItem);
        if (hasFolded) {
          var foldN = g.otherItems.length + g.extraKeyItems.length;
          html += '<div class="tl-s-fold-badge" title="还有' + foldN + '个文档，悬浮查看">+' + foldN + '</div>';
        }
        html += '</div>';
      }

      // 悬浮弹出框（显示该日期所有文档）
      html += '<div class="tl-s-popup">';
      html += '<div class="tl-s-popup-title">' + escapeHtml(g.date) + ' · ' + totalAtDate + '个文档</div>';
      g.items.forEach(function (popIt) {
        var pk = keyTypes.has(popIt.type);
        var pdc = dotClassMap[popIt.type] || "tl-dot-misc";
        var pLabel = typeLabelMap[popIt.type] || "其他";
        var pIcon = typeIconMap[popIt.type] || typeIconMap.misc;
        var popExtracted = extractCnTitle(popIt);
        var pEn = popExtracted.enName;
        var pCn = popExtracted.displayCn;
        var pSel = _tlSelected.has(popIt.idx);
        html += '<div class="tl-s-popup-item' + (pk ? ' tl-s-popup-key' : '') + (pSel ? ' tl-s-popup-selected' : '') + '" data-tl-idx="' + popIt.idx + '" onclick="_jumpToDocFromTimeline(' + popIt.idx + ')">';
        html += '  <span class="tl-s-popup-check' + (pSel ? ' checked' : '') + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
        html += '  <span class="tl-s-popup-dot ' + pdc + '">' + pIcon + '</span>';
        html += '  <div class="tl-s-popup-text">';
        if (pCn) html += '<div class="tl-s-popup-cn">' + escapeHtml(pCn) + '</div>';
        html += '    <div class="tl-s-popup-en">' + escapeHtml(pEn) + (popIt.docCode ? ' [' + escapeHtml(popIt.docCode) + ']' : '') + '</div>';
        html += '    <span class="tl-s-popup-badge ' + pdc + '">' + pLabel + '</span>';
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';

      html += '</div>';
    });

    html += '</div></div>';

    // 图例
    var legendHtml = '<div class="tl-legend tl-s-legend">';
    legendHtml += '<div class="tl-legend-section">';
    legendHtml += '<span class="tl-legend-item"><span class="tl-legend-dot" style="background:#3b82f6"></span>申请人答复</span>';
    legendHtml += '<span class="tl-legend-item"><span class="tl-legend-dot" style="background:#ef4444"></span>审查意见</span>';
    legendHtml += '<span class="tl-legend-item"><span class="tl-legend-dot" style="background:#6366f1"></span>专利文件</span>';
    legendHtml += '<span class="tl-legend-item"><span class="tl-legend-dot" style="background:#22c55e"></span>授权通知</span>';
    legendHtml += '<span class="tl-legend-item"><span class="tl-legend-folded-dot"></span>折叠节点</span>';
    legendHtml += '</div>';
    legendHtml += '<div class="tl-legend-hint">时间倒序（最新在左上）· 悬浮节点查看全部文档 · 点击卡片跳转</div>';
    legendHtml += '</div>';

    board.innerHTML = legendHtml + '<div class="tl-s-scroll">' + html + '</div>';

    _bindTimelineHoverPopups(board);

    if (statusEl) {
      var keyCount = sorted.filter(function (it) { return keyTypes.has(it.type); }).length;
      var dateCount = groups.length;
      var s = '共 ' + sorted.length + ' 个文档 / ' + dateCount + ' 个日期节点（倒序）';
      s += ' · 重点展示 ' + keyCount + ' 个关键文档，其余已折叠';
      statusEl.textContent = s;
    }
  };
})();
