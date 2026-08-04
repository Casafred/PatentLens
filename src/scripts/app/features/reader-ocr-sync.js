/*!
 * PatentLens - OCR 版面块与右侧栏段落级同步增强
 * Copyright (c) 2026 Alfred Shi. All rights reserved. PROPRIETARY/CONFIDENTIAL.
 *
 * 作用：
 * 1. 点击 OCR 版面块时，右侧「提取内容」栏定位到具体段落并高亮
 *    （在 web-app.js 已有的页码跳转基础上细化到段落级）。
 * 2. 若「对照翻译」已对全部内容完成翻译，并且点击时正处于对照翻译栏，
 *    则点击 OCR 块时改为在对照翻译栏内定位到对应译文段落并高亮，
 *    实现 OCR 版面块与对照翻译的位置同步跳转。
 *
 * 实现方式：作为独立特性模块在 web-app.js 之后加载。通过在
 * #reader-pdf-container 上注册一个捕获阶段的 click 监听，先于 web-app.js
 * 的块点击处理记录「点击前的右侧栏 tab 状态」与块 id，再用 setTimeout(0)
 * 在 web-app.js 的同步处理（切换到提取栏并滚动到对应页）完成后再执行
 * 段落级高亮/翻译同步。不修改 web-app.js（已冻结）。
 *
 * 依赖的 web-app.js 全局：kanbanState、pdfViewState、translatePageCache、
 * pdfTranslateLang、pdfTranslateContent、switchRightPanelTab、renderTranslateContent。
 */
(function () {
  "use strict";

  var HIGHLIGHT_CLASS = "reader-sync-highlight";
  var PDF_CONTAINER_ID = "reader-pdf-container";
  var OVERLAY_SEL = ".pdf-block-overlay";

  var pending = null; // { blockId, translateActive }
  var currentHighlights = []; // 当前高亮的元素
  var clearTimer = null;

  // 注入高亮样式（幂等）
  function injectStyle() {
    if (document.getElementById("reader-ocr-sync-style")) return;
    var style = document.createElement("style");
    style.id = "reader-ocr-sync-style";
    style.textContent =
      "." + HIGHLIGHT_CLASS + " {" +
      "  background: rgba(34,197,94,0.28) !important;" +
      "  outline: 2px solid rgba(34,197,94,0.85) !important;" +
      "  border-radius: 4px;" +
      "  box-shadow: 0 0 0 2px rgba(34,197,94,0.25) !important;" +
      "  scroll-margin-top: 90px;" +
      "  scroll-margin-bottom: 60px;" +
      "  transition: background .2s ease, outline .2s ease, box-shadow .2s ease;" +
      "}";
    document.head.appendChild(style);
  }

  function clearHighlights() {
    for (var i = 0; i < currentHighlights.length; i++) {
      var el = currentHighlights[i];
      if (el && el.classList) el.classList.remove(HIGHLIGHT_CLASS);
    }
    currentHighlights = [];
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }

  function highlight(el) {
    if (!el) return;
    clearHighlights();
    el.classList.add(HIGHLIGHT_CLASS);
    currentHighlights.push(el);
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    clearTimer = setTimeout(clearHighlights, 2800);
  }

  function normalizeText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  // 安全读取 web-app.js 全局变量
  function getKanbanState() {
    try { return typeof kanbanState !== "undefined" ? kanbanState : null; } catch (_) { return null; }
  }
  function getPdfViewState() {
    try { return typeof pdfViewState !== "undefined" ? pdfViewState : null; } catch (_) { return null; }
  }

  // 根据块 id 在当前文档的 blocks 中查找块对象
  function findBlock(blockId) {
    var ks = getKanbanState();
    var vs = getPdfViewState();
    if (!ks || !vs || vs.currentDocIdx == null) return null;
    var ext = ks.extractions ? ks.extractions[vs.currentDocIdx] : null;
    var blocks = ext && ext.blocks ? ext.blocks : [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].block_id === blockId) return blocks[i];
    }
    return null;
  }

  // 在提取内容栏的指定页内，按块文本匹配最具体的段落元素
  function findExtractParagraph(page, blockContentNorm) {
    var contentEl = document.getElementById("reader-extract-content");
    if (!contentEl) return null;
    var pageContent = contentEl.querySelector('.extract-page-content[data-extract-page="' + page + '"]');
    if (!pageContent) {
      // 退而求其次：页码分隔符
      return contentEl.querySelector('.extract-page-divider[data-extract-page="' + page + '"]');
    }
    if (!blockContentNorm) return pageContent;

    var sel = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, dt, dd, figcaption, caption";
    var candidates = pageContent.querySelectorAll(sel);
    var exact = null;
    var contains = null; // 段落文本包含块文本（块文本是子串）
    var containsLen = Infinity;
    var contained = null; // 块文本包含段落文本（段落文本是子串）
    var containedLen = -1;

    for (var i = 0; i < candidates.length; i++) {
      var norm = normalizeText(candidates[i].textContent);
      if (!norm) continue;
      if (norm === blockContentNorm) {
        exact = candidates[i];
        break; // 精确匹配最优
      }
      if (blockContentNorm.length >= 6 && norm.indexOf(blockContentNorm) >= 0) {
        if (norm.length < containsLen) { containsLen = norm.length; contains = candidates[i]; }
      } else if (norm.length >= 6 && blockContentNorm.indexOf(norm) >= 0) {
        if (norm.length > containedLen) { containedLen = norm.length; contained = candidates[i]; }
      }
    }
    return exact || contains || contained || pageContent;
  }

  // 查找当前文档「全文翻译」的缓存 key（translatePageCache 形如 `${idx}_${lang}_full`）
  function findFullTranslationCacheKey(idx) {
    try {
      var cache = (typeof translatePageCache !== "undefined") ? translatePageCache : null;
      if (!cache) return null;
      var prefix = idx + "_";
      var suffix = "_full";
      var langVal = (typeof pdfTranslateLang !== "undefined" && pdfTranslateLang) ? pdfTranslateLang.value : null;
      var langKey = langVal ? (prefix + langVal + suffix) : null;
      if (langKey && cache[langKey]) return langKey;
      var keys = Object.keys(cache);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.indexOf(prefix) === 0 && k.indexOf(suffix) === k.length - suffix.length && cache[k]) {
          return k;
        }
      }
    } catch (_) {}
    return null;
  }

  // 镜像 web-app.js 的 _buildBlockText 清洗逻辑，保证原文片段与发送给 AI 的文本一致
  function cleanOcrText(text) {
    return String(text || "")
      .replace(/\$\s*\\Box\s*\$/g, "☐")
      .replace(/\$\s*\\surd\s*\$/g, "☑")
      .replace(/\$\s*\\§\s*(\d+)\s*\$/g, "§$1")
      .replace(/\$\s*\\[^$]+\$/g, "")
      .replace(/\$\{[^}]+\}/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // 取「有内容」的块及其清洗后文本，保持与 _buildBlockText 一致的顺序
  function nonEmptyBlocksInOrder(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || !b.content || !String(b.content).trim()) continue;
      var cleaned = cleanOcrText(b.content);
      if (cleaned) out.push({ block: b, text: cleaned });
    }
    return out;
  }

  // 计算译文段落的累积字符长度数组，用于基于位置的映射。
  // 返回 { lengths: [每段长度], cumulative: [0, len0, len0+len1, ...] }
  function paragraphStats(paragraphs) {
    var lengths = [];
    var cum = 0;
    var cumulative = [0];
    for (var i = 0; i < paragraphs.length; i++) {
      var len = normalizeText(paragraphs[i].textContent).length;
      lengths.push(len);
      cum += len;
      cumulative.push(cum);
    }
    return { lengths: lengths, cumulative: cumulative, total: cum };
  }

  // 基于「累积字符长度的单调映射」+「数字锚点校正」定位译文段落。
  //
  // 原理：译文是原文的逐段翻译，两者的累积文本长度比例应单调对应。
  // 即使 AI 合并多个块为一段、或把一个块拆成多段，累积长度比例仍能
  // 保持大致同步，从而把每个块映射到位置最接近的译文段落，避免
  // 「多个相邻块挤到同一段」或「位置大面积漂移」的问题。
  //
  // 在累积映射的基准位置附近，再用块原文中的数字串（专利号、条款号、
  // 日期等）与译文段落做锚点校正，修正局部偏差。
  function pickTranslateParagraph(paragraphs, ordered, blockId) {
    if (!paragraphs || paragraphs.length === 0) return null;
    var total = ordered.length;
    var blockIdx = -1;
    for (var i = 0; i < total; i++) {
      if (ordered[i].block.block_id === blockId) { blockIdx = i; break; }
    }
    if (blockIdx < 0) return null;

    var stats = paragraphStats(paragraphs);
    if (stats.total === 0) return paragraphs[0];

    // 1) 累积长度比例映射：该块在原文中的累积长度比例 → 译文中的累积长度位置
    var blockCum = 0;
    for (var k = 0; k <= blockIdx; k++) blockCum += ordered[k].text.length;
    var blockTotal = 0;
    for (var m = 0; m < total; m++) blockTotal += ordered[m].text.length;
    var blockRatio = blockTotal > 0 ? (blockCum / blockTotal) : 0;
    var targetCum = blockRatio * stats.total;

    // 找到译文累积长度最接近 targetCum 的段落索引（用段落中点比较）
    var baseIdx = 0;
    var minDist = Infinity;
    for (var p = 0; p < paragraphs.length; p++) {
      var mid = (stats.cumulative[p] + stats.cumulative[p + 1]) / 2;
      var dist = Math.abs(mid - targetCum);
      if (dist < minDist) { minDist = dist; baseIdx = p; }
    }

    // 2) 数字锚点校正：在 baseIdx 附近 ±3 段内，找与块原文数字重合度最高的段落
    var blockDigits = (ordered[blockIdx].text.match(/\d{2,}/g) || []);
    var bestIdx = baseIdx;
    var bestScore = -1;
    var lo = Math.max(0, baseIdx - 3);
    var hi = Math.min(paragraphs.length - 1, baseIdx + 3);
    for (var j = lo; j <= hi; j++) {
      var pText = normalizeText(paragraphs[j].textContent);
      var score = 0;
      for (var d = 0; d < blockDigits.length; d++) {
        if (pText.indexOf(blockDigits[d]) >= 0) score++;
      }
      // 距离惩罚：离基准位置越远，分数衰减
      score -= Math.abs(j - baseIdx) * 0.5;
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }
    return paragraphs[bestIdx];
  }

  // 对照翻译栏：按累积长度映射 + 数字锚点校正定位译文段落
  function syncTranslatePanel(blockId) {
    var ks = getKanbanState();
    var vs = getPdfViewState();
    if (!ks || !vs || vs.currentDocIdx == null) return false;
    var ext = ks.extractions ? ks.extractions[vs.currentDocIdx] : null;
    if (!ext || !ext.blocks) return false;

    var fullKey = findFullTranslationCacheKey(vs.currentDocIdx);
    if (!fullKey) return false; // 没有全文翻译，交由提取内容栏处理

    // 切换到对照翻译栏并（重新）渲染全文翻译，确保展示的是全文译文
    try {
      if (typeof switchRightPanelTab === "function") switchRightPanelTab("translate");
      if (typeof renderTranslateContent === "function") {
        renderTranslateContent(translatePageCache[fullKey]);
      }
    } catch (_) {}

    var panel = (typeof pdfTranslateContent !== "undefined") ? pdfTranslateContent : null;
    if (!panel) return true;
    var resultContainer = panel.querySelector(".pdf-translate-result");
    if (!resultContainer) return true;
    var paragraphs = resultContainer.children;
    if (!paragraphs || paragraphs.length === 0) return true;

    var ordered = nonEmptyBlocksInOrder(ext.blocks);
    var target = pickTranslateParagraph(paragraphs, ordered, blockId);
    if (target) highlight(target);
    return true;
  }

  // 提取内容栏：定位并高亮具体段落
  function syncExtractPanel(block) {
    var page = block.page;
    var blockNorm = normalizeText(block.content);
    var target = findExtractParagraph(page, blockNorm);
    if (target) highlight(target);
  }

  function handleBlockClick(blockId, translateActive) {
    try {
      var vs = getPdfViewState();
      // 标注模式下不做同步
      if (vs && vs.annotTool) return;
      var block = findBlock(blockId);
      if (!block) return;

      // 若点击前处于对照翻译栏且存在全文翻译，则同步译文段落
      if (translateActive && syncTranslatePanel(blockId)) return;

      // 否则在提取内容栏定位并高亮具体段落
      syncExtractPanel(block);
    } catch (_) {
      // 任何异常都不应阻断 web-app.js 已完成的基础页码跳转
    }
  }

  function install() {
    var container = document.getElementById(PDF_CONTAINER_ID);
    if (!container) return;
    if (container._readerOcrSyncInstalled) return;
    container._readerOcrSyncInstalled = true;

    injectStyle();

    // 捕获阶段：先于 web-app.js 的块 click 处理记录点击前状态
    container.addEventListener("click", function (ev) {
      var overlay = ev.target.closest ? ev.target.closest(OVERLAY_SEL) : null;
      if (!overlay) return;
      var blockId = overlay.dataset ? overlay.dataset.blockId : null;
      if (!blockId) return;
      var translateTab = document.querySelector('.right-panel-tab[data-panel="translate"]');
      var translateActive = !!(translateTab && translateTab.classList.contains("active"));
      // 暂存，延迟到 web-app.js 同步处理完成后再执行段落级同步
      pending = { blockId: blockId, translateActive: translateActive };
      var captured = pending;
      setTimeout(function () {
        // 仅处理最近一次点击，避免快速连点串扰
        if (pending !== captured) return;
        handleBlockClick(captured.blockId, captured.translateActive);
      }, 0);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
