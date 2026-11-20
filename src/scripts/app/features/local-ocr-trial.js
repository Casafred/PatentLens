/**
 * 本地轻量 OCR（实验）
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 在阅读器工具栏增加本地 OCR。结果写入阅读器现有的 extraction 结构，
 * 因此「提取内容」和「对照翻译」可以与 API OCR 共用同一条链路。
 *
 * 不修改 web-app.js：只读取 pdfViewState / pdfViewState.pdfDoc。
 */
(function () {
  "use strict";

  if (window.__plLocalOcrInstalled) return;
  window.__plLocalOcrInstalled = true;

  var STATE = {
    busy: false,
    cache: Object.create(null),
    panel: null,
    scopePanel: null,
    cancelled: false,
  };

  function toast(message, duration) {
    try {
      if (typeof showToast === "function") {
        showToast(message, duration || 4200);
        return;
      }
    } catch (_) {}
    try { console.log("[Local OCR]", message); } catch (_) {}
  }

  function injectStyle() {
    if (document.getElementById("pl-local-ocr-style")) return;
    var style = document.createElement("style");
    style.id = "pl-local-ocr-style";
    style.textContent =
      "#pdf-local-ocr-btn.loading{opacity:.62;pointer-events:none;}" +
      ".pl-local-ocr-panel{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "width:min(560px,calc(100vw - 32px));max-height:60vh;display:flex;flex-direction:column;" +
        "background:var(--bg-primary,#fff);color:var(--text-primary,#1f2937);border:1px solid var(--border,#cbd5e1);" +
        "border-radius:12px;box-shadow:0 18px 50px rgba(15,23,42,.28);z-index:100050;overflow:hidden;" +
        "font-family:inherit;}" +
      ".pl-local-ocr-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border,#e2e8f0);}" +
      ".pl-local-ocr-head strong{font-size:13px;}" +
      ".pl-local-ocr-head .pl-local-ocr-meta{font-size:11px;color:var(--text-secondary,#64748b);margin-left:auto;}" +
      ".pl-local-ocr-body{padding:10px 14px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto;}" +
      ".pl-local-ocr-body textarea{width:100%;height:220px;resize:vertical;box-sizing:border-box;" +
        "border:1px solid var(--border,#cbd5e1);border-radius:8px;padding:8px 10px;font:12px/1.6 ui-monospace,Consolas,monospace;" +
        "background:var(--bg-secondary,#f8fafc);color:inherit;}" +
      ".pl-local-ocr-hint{font-size:11px;line-height:1.6;color:var(--text-secondary,#64748b);}" +
      ".pl-local-ocr-actions{display:flex;gap:8px;align-items:center;}" +
      ".pl-local-ocr-actions button{border:1px solid var(--border,#cbd5e1);background:var(--bg-secondary,#f1f5f9);" +
        "color:inherit;border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;}" +
      ".pl-local-ocr-actions .pl-local-ocr-primary{background:#16a34a;border-color:#16a34a;color:#fff;}" +
      ".pl-local-ocr-actions .pl-local-ocr-close{margin-left:auto;background:transparent;}" +
      ".pl-local-ocr-scope{position:fixed;top:80px;right:24px;z-index:100050;width:min(360px,calc(100vw - 32px));" +
        "background:var(--bg-primary,#fff);color:var(--text-primary,#1f2937);border:1px solid var(--border,#cbd5e1);" +
        "border-radius:12px;box-shadow:0 18px 50px rgba(15,23,42,.28);overflow:hidden;font-family:inherit;}" +
      ".pl-local-ocr-scope-head{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border,#e2e8f0);}" +
      ".pl-local-ocr-scope-head strong{font-size:13px}.pl-local-ocr-scope-head button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer;}" +
      ".pl-local-ocr-scope-body{padding:12px 14px;display:flex;flex-direction:column;gap:8px;}" +
      ".pl-local-ocr-scope-body button{padding:9px 11px;text-align:left;border:1px solid var(--border,#cbd5e1);border-radius:8px;background:var(--bg-secondary,#f8fafc);color:inherit;font:inherit;font-size:12px;cursor:pointer;}" +
      ".pl-local-ocr-scope-body button.primary{border-color:#16a34a;background:#16a34a;color:#fff;}" +
      ".pl-local-ocr-scope-picker{display:none;padding:12px 14px;border-top:1px solid var(--border,#e2e8f0);}" +
      ".pl-local-ocr-scope-picker input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border,#cbd5e1);border-radius:7px;background:var(--bg-secondary,#f8fafc);color:inherit;font:inherit;}" +
      ".pl-local-ocr-scope-picker .error{min-height:18px;margin:6px 0;color:var(--danger,#dc2626);font-size:11px;}" +
      ".pl-local-ocr-scope-picker .actions{display:flex;gap:8px}.pl-local-ocr-scope-picker .actions button{flex:1;}";
    document.head.appendChild(style);
  }

  function ensureButton() {
    if (document.getElementById("pdf-local-ocr-btn")) return true;
    var anchor = document.getElementById("pdf-ocr-btn");
    if (!anchor || !anchor.parentElement) return false;
    var btn = document.createElement("button");
    btn.id = "pdf-local-ocr-btn";
    btn.type = "button";
    btn.className = "pdf-toolbar-btn pdf-toolbar-btn-text";
    btn.title = "本地 OCR：当前文档、全部文档、当前页或手动选页（离线）";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/>' +
      '<path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/>' +
      '<path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h10"/><path d="M7 12h7"/>' +
      '<path d="M7 16h5"/></svg><span>本地</span>';
    btn.addEventListener("click", function () {
      showScopePanel();
    });
    anchor.insertAdjacentElement("afterend", btn);
    return true;
  }

  function setButtonBusy(busy, text) {
    var btn = document.getElementById("pdf-local-ocr-btn");
    if (!btn) return;
    btn.classList.toggle("loading", !!busy);
    var label = btn.querySelector("span");
    if (label) label.textContent = text || (busy ? "识别中..." : "本地");
  }

  function closePanel() {
    if (STATE.panel && STATE.panel.parentNode) STATE.panel.parentNode.removeChild(STATE.panel);
    STATE.panel = null;
  }

  function closeScopePanel() {
    if (STATE.scopePanel && STATE.scopePanel.parentNode) STATE.scopePanel.parentNode.removeChild(STATE.scopePanel);
    STATE.scopePanel = null;
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast("已复制本地 OCR 文本");
        }, function () {});
        return;
      }
    } catch (_) {}
    try {
      var ta = STATE.panel && STATE.panel.querySelector("textarea");
      if (ta) {
        ta.focus();
        ta.select();
        document.execCommand("copy");
        toast("已复制本地 OCR 文本");
      }
    } catch (_) {}
  }

  function showPanel(text, meta) {
    closePanel();
    injectStyle();
    var panel = document.createElement("div");
    panel.className = "pl-local-ocr-panel";
    var low = meta.lowConfidence || 0;
    var metaLabel = meta.scope || (meta.page ? "第 " + meta.page + " 页" : "");
    panel.innerHTML =
      '<div class="pl-local-ocr-head"><strong>本地 OCR' +
        (meta.engineLabel ? "（" + meta.engineLabel + "）" : "") + '</strong>' +
        '<span class="pl-local-ocr-meta">' + metaLabel + (metaLabel ? " · " : "") + meta.lines + " 行 · " +
        meta.ms + "ms" + (low ? " · 低置信度 " + low + " 行" : "") + "</span></div>" +
      '<div class="pl-local-ocr-body">' +
        '<textarea readonly spellcheck="false"></textarea>' +
      '<div class="pl-local-ocr-hint">识别结果已写入「提取内容」，也可以直接使用「对照翻译」。页面文字层会保留坐标，便于选择和定位。</div>' +
        '<div class="pl-local-ocr-actions">' +
          '<button type="button" class="pl-local-ocr-primary" data-action="extract">查看提取内容</button>' +
          '<button type="button" data-action="translate">翻译全文档</button>' +
          '<button type="button" data-action="copy">复制全文</button>' +
          '<button type="button" class="pl-local-ocr-close" data-action="close">关闭</button>' +
        "</div>" +
      "</div>";
    var textarea = panel.querySelector("textarea");
    textarea.value = text;
    panel.querySelector('[data-action="copy"]').addEventListener("click", function () { copyText(text); });
    panel.querySelector('[data-action="extract"]').addEventListener("click", function () {
      closePanel();
      if (typeof enterReadingMode === "function") enterReadingMode("extract");
      if (typeof updateExtractPanel === "function") updateExtractPanel();
    });
    panel.querySelector('[data-action="translate"]').addEventListener("click", function () {
      closePanel();
      if (typeof translatePdfPage === "function") translatePdfPage();
    });
    panel.querySelector('[data-action="close"]').addEventListener("click", closePanel);
    document.body.appendChild(panel);
    STATE.panel = panel;
  }

  function boxBounds(line) {
    var xs = [];
    var ys = [];
    var box = line && line.box;
    if (!box || !box.length) return null;
    for (var i = 0; i < box.length; i++) {
      var point = box[i];
      if (!point) continue;
      xs.push(Number(point.x) || 0);
      ys.push(Number(point.y) || 0);
    }
    if (!xs.length) return null;
    return {
      x1: Math.min.apply(null, xs),
      x2: Math.max.apply(null, xs),
      y1: Math.min.apply(null, ys),
      y2: Math.max.apply(null, ys),
    };
  }

  // 双栏专利页按「左栏从上到下，再右栏从上到下」还原阅读顺序；
  // 单栏或大量跨栏行时退回纯 y 顺序。
  function orderLines(lines, imageWidth) {
    var list = (lines || []).filter(function (line) {
      return line && String(line.text || "").trim() && boxBounds(line);
    });
    if (list.length < 2) return list;
    var mid = (Number(imageWidth) || 0) / 2;
    if (!mid) return list;
    var cross = 0;
    list.forEach(function (line) {
      var b = boxBounds(line);
      if (b.x1 < mid * 0.75 && b.x2 > mid * 1.25) cross++;
    });
    function byY(a, b) {
      var ba = boxBounds(a);
      var bb = boxBounds(b);
      return (ba.y1 - bb.y1) || (ba.x1 - bb.x1);
    }
    if (cross > list.length * 0.3) return list.slice().sort(byY);
    var left = [];
    var right = [];
    list.forEach(function (line) {
      var b = boxBounds(line);
      var center = (b.x1 + b.x2) / 2;
      (center < mid ? left : right).push(line);
    });
    return left.sort(byY).concat(right.sort(byY));
  }

  function findPageWrapper(pageNumber) {
    var container = document.getElementById("reader-pdf-container");
    if (!container) return null;
    return container.querySelector('.pdf-page-wrapper[data-page="' + pageNumber + '"]');
  }

  function buildTextLayer(wrapper, lines, imageWidth, imageHeight) {
    if (!wrapper) return 0;
    var canvas = wrapper.querySelector("canvas");
    if (!canvas) return 0;
    var rect = canvas.getBoundingClientRect();
    var displayWidth = rect.width || canvas.clientWidth || canvas.width;
    var displayHeight = rect.height || canvas.clientHeight || canvas.height;
    if (!displayWidth || !displayHeight) return 0;

    var previous = wrapper.querySelector(".pl-local-ocr-layer");
    if (previous) previous.remove();

    var layer = document.createElement("div");
    layer.className = "pdf-text-layer pl-local-ocr-layer";
    layer.dataset.page = wrapper.dataset.page || "";
    layer.style.width = displayWidth + "px";
    layer.style.height = displayHeight + "px";

    var scaleX = displayWidth / (Number(imageWidth) || displayWidth);
    var scaleY = displayHeight / (Number(imageHeight) || displayHeight);
    var count = 0;

    lines.forEach(function (line) {
      var text = String(line.text || "").trim();
      var bounds = boxBounds(line);
      if (!text || !bounds) return;
      var left = bounds.x1 * scaleX;
      var top = bounds.y1 * scaleY;
      var width = Math.max(4, (bounds.x2 - bounds.x1) * scaleX);
      var height = Math.max(4, (bounds.y2 - bounds.y1) * scaleY);
      var span = document.createElement("span");
      span.textContent = text;
      span.style.left = left + "px";
      span.style.top = top + "px";
      span.style.width = width + "px";
      span.style.height = height + "px";
      span.style.fontSize = Math.max(6, height * 0.72) + "px";
      span.style.lineHeight = height + "px";
      span.style.overflow = "hidden";
      span.dataset.text = text;
      span.dataset.confidence = String(line.confidence == null ? "" : line.confidence);
      layer.appendChild(span);
      count++;
    });

    wrapper.appendChild(layer);
    wrapper.classList.add("pl-has-local-ocr");
    return count;
  }

  async function renderPageForOcr(page) {
    var base = page.getViewport({ scale: 1 });
    var targetWidth = Math.min(2200, Math.max(1400, Math.round(base.width * 2)));
    var scale = targetWidth / base.width;
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    var context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: viewport, background: "#ffffff" }).promise;
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
    if (!blob) throw new Error("页面渲染失败");
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function currentDocIndex() {
    return typeof pdfViewState !== "undefined" && pdfViewState ? pdfViewState.currentDocIdx : null;
  }

  function currentDocument() {
    var idx = currentDocIndex();
    if (idx == null || typeof kanbanState === "undefined" || !kanbanState.documents) return null;
    return kanbanState.documents.find(function (item) { return item.idx === idx; }) || null;
  }

  function pageRangePages(input, totalPages) {
    var text = String(input || "").trim();
    if (!text) return { valid: false, message: "请输入页码范围", pages: [] };
    var pages = [];
    var segments = text.split(",");
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i].trim();
      if (!segment) continue;
      var dash = segment.indexOf("-");
      var start = dash < 0 ? Number(segment) : Number(segment.slice(0, dash));
      var end = dash < 0 ? start : Number(segment.slice(dash + 1));
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end || end > totalPages) {
        return { valid: false, message: "页码范围无效，文档共 " + totalPages + " 页", pages: [] };
      }
      for (var page = start; page <= end; page++) pages.push(page);
    }
    pages = Array.from(new Set(pages)).sort(function (a, b) { return a - b; });
    return pages.length ? { valid: true, pages: pages, raw: text } : { valid: false, message: "请至少选择一页", pages: [] };
  }

  function pageRangeText(pages) {
    var sorted = Array.from(new Set(pages || [])).sort(function (a, b) { return a - b; });
    if (!sorted.length) return "";
    var ranges = [];
    var start = sorted[0];
    var end = sorted[0];
    for (var i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) end = sorted[i];
      else { ranges.push(start === end ? String(start) : start + "-" + end); start = end = sorted[i]; }
    }
    ranges.push(start === end ? String(start) : start + "-" + end);
    return ranges.join(",");
  }

  function toBlock(line, pageNumber, blockIndex) {
    var bounds = boxBounds(line);
    if (!bounds) return null;
    return {
      block_id: "B_p" + pageNumber + "_" + blockIndex,
      label: "text",
      page: pageNumber,
      bbox: [bounds.x1, bounds.y1, bounds.x2, bounds.y2],
      content: String(line.text || "").trim(),
      confidence: Number(line.confidence || 0),
    };
  }

  function mergeLocalExtraction(idx, pageResults, totalPages) {
    var existing = kanbanState.extractions && kanbanState.extractions[idx];
    var pages = pageResults.map(function (result) { return result.page; });
    var pageSet = new Set(pages);
    var oldBlocks = existing && Array.isArray(existing.blocks) ? existing.blocks : [];
    var kept = oldBlocks.filter(function (block) { return !pageSet.has(Number(block.page)); });
    var newBlocks = [];
    var dimensions = Object.assign({}, existing && existing.pageDimensions ? existing.pageDimensions : {});
    pageResults.forEach(function (result) {
      dimensions[result.page] = { width: result.imageWidth, height: result.imageHeight };
      result.lines.forEach(function (line, lineIndex) {
        var block = toBlock(line, result.page, lineIndex);
        if (block) newBlocks.push(block);
      });
    });
    var blocks = kept.concat(newBlocks).sort(function (a, b) {
      return (Number(a.page) || 0) - (Number(b.page) || 0) || String(a.block_id).localeCompare(String(b.block_id));
    });
    var byPage = Object.create(null);
    blocks.forEach(function (block) {
      var page = Number(block.page) || 1;
      if (!byPage[page]) byPage[page] = [];
      byPage[page].push(block.content || "");
    });
    var pageNumbers = Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; });
    var text = pageNumbers.map(function (page) { return byPage[page].filter(Boolean).join("\n"); }).join("\n\n---\n\n");
    var oldOcrPages = existing && Array.isArray(existing.ocrPages) ? existing.ocrPages : [];
    var knownBlockPages = oldBlocks.map(function (block) { return Number(block.page); }).filter(function (page) { return page > 0; });
    var ocrPages = Array.from(new Set(oldOcrPages.concat(knownBlockPages, pages))).sort(function (a, b) { return a - b; });
    kanbanState.extractions[idx] = {
      text: text,
      markdown: text,
      engine: "local_ocr",
      engineLabel: pageResults[pageResults.length - 1].engineLabel || "本地 OCR",
      blocks: blocks,
      pageDimensions: dimensions,
      ocrPages: ocrPages,
      partial: totalPages > 0 && ocrPages.length < totalPages,
    };
    kanbanState.hasUnsavedWork = true;
    if (!kanbanState.traceIndex) kanbanState.traceIndex = {};
    Object.keys(kanbanState.traceIndex).forEach(function (key) {
      var item = kanbanState.traceIndex[key];
      if (item && item.docIdx === idx && pageSet.has(Number(item.page))) delete kanbanState.traceIndex[key];
    });
    newBlocks.forEach(function (block) {
      kanbanState.traceIndex["D" + idx + "_" + block.block_id] = {
        docIdx: idx, page: block.page, bbox: block.bbox, content: block.content,
        label: block.label, originalBlockId: block.block_id, pageDimensions: dimensions[block.page],
      };
    });
    return kanbanState.extractions[idx];
  }

  async function waitForPdfDoc(idx) {
    if (pdfViewState.currentDocIdx === idx && pdfViewState.pdfDoc) return pdfViewState.pdfDoc;
    if (typeof selectReaderDoc !== "function") throw new Error("阅读器尚未准备好");
    selectReaderDoc(idx, true);
    var started = Date.now();
    while (Date.now() - started < 90000) {
      if (STATE.cancelled) throw new Error("本地 OCR 已停止");
      if (pdfViewState.currentDocIdx === idx && pdfViewState.pdfDoc) return pdfViewState.pdfDoc;
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    throw new Error("文档 PDF 加载超时");
  }

  async function ocrDocument(idx, requestedPages) {
    var doc = kanbanState.documents.find(function (item) { return item.idx === idx; });
    if (!doc) throw new Error("找不到文档信息");
    var pdfDoc = await waitForPdfDoc(idx);
    var totalPages = Number(pdfDoc.numPages || doc.numberOfPages || 0);
    var pages = requestedPages && requestedPages.length ? requestedPages.slice() : Array.from({ length: totalPages }, function (_, n) { return n + 1; });
    var results = [];
    for (var i = 0; i < pages.length; i++) {
      if (STATE.cancelled) throw new Error("本地 OCR 已停止");
      var pageNumber = pages[i];
      var page = await pdfDoc.getPage(pageNumber);
      var rendered = await renderPageForOcr(page);
      var result = await window.electronAPI.localOcrRecognize({ bytes: rendered.bytes });
      if (!result || !result.ok) throw new Error((result && result.error) || "本地 OCR 失败");
      var ordered = orderLines(result.lines, result.imageWidth);
      var cacheKey = String(pdfViewState.currentDocKey || idx) + "#" + pageNumber;
      STATE.cache[cacheKey] = { lines: result.lines, imageWidth: result.imageWidth, imageHeight: result.imageHeight, durationMs: result.durationMs, engineLabel: result.engineLabel || "" };
      var wrapper = findPageWrapper(pageNumber);
      buildTextLayer(wrapper, ordered, result.imageWidth, result.imageHeight);
      results.push({ page: pageNumber, lines: ordered, imageWidth: result.imageWidth, imageHeight: result.imageHeight, engineLabel: result.engineLabel || "本地 OCR" });
      setButtonBusy(true, Math.round(((i + 1) / pages.length) * 100) + "%");
    }
    mergeLocalExtraction(idx, results, totalPages);
    if (typeof autoSaveCache === "function") autoSaveCache();
    if (pdfViewState.currentDocIdx === idx && typeof updateExtractPanel === "function") updateExtractPanel();
    if (pdfViewState.currentDocIdx === idx && typeof renderPdfView === "function") await renderPdfView(idx);
    return results;
  }

  async function runDocuments(indices, requestedPages) {
    if (STATE.busy) return;
    if (!window.electronAPI || typeof window.electronAPI.localOcrRecognize !== "function") {
      toast("当前环境不支持本地 OCR（需要桌面版）");
      return;
    }
    if (!indices || !indices.length) { toast("没有可识别的文档"); return; }
    STATE.busy = true;
    STATE.cancelled = false;
    setButtonBusy(true, "准备中...");
    var originalIdx = currentDocIndex();
    var totalLines = 0;
    var startedAt = performance.now();
    try {
      for (var i = 0; i < indices.length; i++) {
        if (STATE.cancelled) break;
        var results = await ocrDocument(indices[i], requestedPages);
        results.forEach(function (result) { totalLines += result.lines.length; });
      }
      if (originalIdx != null && pdfViewState.currentDocIdx !== originalIdx && typeof selectReaderDoc === "function") selectReaderDoc(originalIdx, true);
      var current = kanbanState.extractions && kanbanState.extractions[currentDocIndex()];
      showPanel(current ? current.text || "" : "", {
        scope: indices.length > 1 ? "全部文档" : (requestedPages && requestedPages.length < (pdfViewState.totalPages || requestedPages.length) ? "指定页码" : "当前文档"),
        page: requestedPages && requestedPages.length === 1 ? requestedPages[0] : "",
        lines: totalLines,
        ms: Math.round(performance.now() - startedAt),
        engineLabel: "本地 OCR",
      });
      if (typeof enterReadingMode === "function") enterReadingMode("extract");
      if (typeof updateExtractPanel === "function") updateExtractPanel();
      toast("本地 OCR 完成：已写入提取内容");
    } catch (error) {
      toast("本地 OCR 失败：" + ((error && error.message) || error));
    } finally {
      STATE.busy = false;
      setButtonBusy(false);
    }
  }

  function showScopePanel() {
    if (STATE.busy) return;
    var doc = currentDocument();
    if (!doc || typeof pdfViewState === "undefined" || !pdfViewState.pdfDoc) {
      toast("请先打开一份 PDF 审查文档");
      return;
    }
    closeScopePanel();
    injectStyle();
    var totalPages = Number(pdfViewState.totalPages || doc.numberOfPages || 0);
    var docs = typeof kanbanState !== "undefined" && Array.isArray(kanbanState.documents) ? kanbanState.documents : [];
    var panel = document.createElement("div");
    panel.className = "pl-local-ocr-scope";
    panel.innerHTML =
      '<div class="pl-local-ocr-scope-head"><strong>本地 OCR</strong><button type="button" data-action="close">&times;</button></div>' +
      '<div class="pl-local-ocr-scope-body"><div style="font-size:11px;color:var(--text-secondary);line-height:1.5;">离线识别结果会进入「提取内容」，并可直接用于「对照翻译」。</div>' +
        '<button type="button" class="primary" data-action="doc">当前文档全部 OCR（' + totalPages + ' 页）</button>' +
        '<button type="button" data-action="page">仅识别当前页（第 ' + (Number(pdfViewState.currentPage) || 1) + ' 页）</button>' +
        '<button type="button" data-action="all">一次性 OCR 全部文档（' + docs.length + ' 个）</button>' +
        '<button type="button" data-action="pick">手动选择页码 OCR</button></div>' +
      '<div class="pl-local-ocr-scope-picker" data-picker="1"><input type="text" placeholder="例如 1-3,5,7-9" data-input="1"><div class="error" data-error="1"></div><div class="actions"><button type="button" data-action="back">返回</button><button type="button" class="primary" data-action="start">开始 OCR</button></div></div>';
    document.body.appendChild(panel);
    STATE.scopePanel = panel;
    panel.querySelector('[data-action="close"]').addEventListener("click", closeScopePanel);
    panel.querySelector('[data-action="doc"]').addEventListener("click", function () { closeScopePanel(); runDocuments([doc.idx], null); });
    panel.querySelector('[data-action="page"]').addEventListener("click", function () { closeScopePanel(); runDocuments([doc.idx], [Number(pdfViewState.currentPage) || 1]); });
    panel.querySelector('[data-action="all"]').addEventListener("click", function () { closeScopePanel(); runDocuments(docs.map(function (item) { return item.idx; }), null); });
    panel.querySelector('[data-action="pick"]').addEventListener("click", function () { panel.querySelector(".pl-local-ocr-scope-body").style.display = "none"; panel.querySelector('[data-picker="1"]').style.display = "block"; panel.querySelector('[data-input="1"]').focus(); });
    panel.querySelector('[data-action="back"]').addEventListener("click", function () { panel.querySelector('[data-picker="1"]').style.display = "none"; panel.querySelector(".pl-local-ocr-scope-body").style.display = "flex"; });
    panel.querySelector('[data-action="start"]').addEventListener("click", function () {
      var parsed = pageRangePages(panel.querySelector('[data-input="1"]').value, totalPages);
      if (!parsed.valid) { panel.querySelector('[data-error="1"]').textContent = parsed.message; return; }
      closeScopePanel();
      runDocuments([doc.idx], parsed.pages);
    });
  }

  async function runCurrentPage() {
    var idx = currentDocIndex();
    if (idx == null) { toast("请先打开一份 PDF 审查文档"); return; }
    await runDocuments([idx], [Number(pdfViewState.currentPage) || 1]);
  }

  function install() {
    injectStyle();
    if (!ensureButton()) {
      // 工具栏可能在脚本执行后才完成渲染。
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (ensureButton() || tries > 20) clearInterval(timer);
      }, 500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }

  window.__plLocalOcr = {
    run: runCurrentPage,
    runDocuments: runDocuments,
    pageRangePages: pageRangePages,
    pageRangeText: pageRangeText,
    toBlock: toBlock,
    orderLines: orderLines,
    buildTextLayer: buildTextLayer,
    boxBounds: boxBounds,
  };
})();
