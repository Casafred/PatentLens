/**
 * 本地轻量 OCR（实验）
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 在阅读器工具栏增加「本地 OCR」：只识别当前页，使用主进程中的
 * PP-OCRv6 Tiny（约 6MB 模型，CPU 离线推理），把识别结果叠加为
 * 透明可选文字层，并弹出文本框供核对/复制。
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
      ".pl-local-ocr-actions .pl-local-ocr-close{margin-left:auto;background:transparent;}";
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
    btn.title = "本地轻量 OCR：识别当前页并生成可选择文字层（离线，实验）";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/>' +
      '<path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/>' +
      '<path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h10"/><path d="M7 12h7"/>' +
      '<path d="M7 16h5"/></svg><span>本地</span>';
    btn.addEventListener("click", function () {
      runCurrentPage().catch(function (error) {
        toast("本地 OCR 失败：" + ((error && error.message) || error));
      });
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
    panel.innerHTML =
      '<div class="pl-local-ocr-head"><strong>本地 OCR（PP-OCRv6 Tiny）</strong>' +
        '<span class="pl-local-ocr-meta">第 ' + meta.page + " 页 · " + meta.lines + " 行 · " +
        meta.ms + "ms" + (low ? " · 低置信度 " + low + " 行" : "") + "</span></div>" +
      '<div class="pl-local-ocr-body">' +
        '<textarea readonly spellcheck="false"></textarea>' +
        '<div class="pl-local-ocr-hint">已把识别结果叠加为透明文字层；若无法拖选，请点工具栏「选字」开启。' +
          "若选择错位，可在下方文本框核对。首次识别含模型加载，之后会更快。</div>" +
        '<div class="pl-local-ocr-actions">' +
          '<button type="button" class="pl-local-ocr-primary" data-action="copy">复制全文</button>' +
          '<button type="button" class="pl-local-ocr-close" data-action="close">关闭</button>' +
        "</div>" +
      "</div>";
    var textarea = panel.querySelector("textarea");
    textarea.value = text;
    panel.querySelector('[data-action="copy"]').addEventListener("click", function () { copyText(text); });
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

  function pageHasDigitalText(pageNumber) {
    var wrapper = findPageWrapper(pageNumber);
    if (!wrapper) return false;
    var layer = wrapper.querySelector(".pdf-text-layer:not(.pl-local-ocr-layer)");
    return !!(layer && String(layer.textContent || "").trim());
  }

  async function runCurrentPage() {
    if (STATE.busy) return;
    if (typeof pdfViewState === "undefined" || !pdfViewState || !pdfViewState.active || !pdfViewState.pdfDoc) {
      toast("请先打开一份 PDF 审查文档");
      return;
    }
    if (!window.electronAPI || typeof window.electronAPI.localOcrRecognize !== "function") {
      toast("当前环境不支持本地 OCR（需要桌面版）");
      return;
    }

    var pageNumber = Number(pdfViewState.currentPage) || 1;
    var docKey = String(pdfViewState.currentDocKey || "doc");
    var cacheKey = docKey + "#" + pageNumber;
    var wrapper = findPageWrapper(pageNumber);
    if (!wrapper) {
      toast("当前页尚未渲染完成，请稍后再试");
      return;
    }
    if (pageHasDigitalText(pageNumber)) {
      toast("当前页已有可选择的文字层，无需本地 OCR");
      return;
    }

    var cached = STATE.cache[cacheKey];
    if (cached) {
      var cachedLines = orderLines(cached.lines, cached.imageWidth);
      buildTextLayer(wrapper, cachedLines, cached.imageWidth, cached.imageHeight);
      showPanel(cachedLines.map(function (line) { return line.text; }).join("\n"), {
        page: pageNumber,
        lines: cachedLines.length,
        ms: cached.durationMs || 0,
        lowConfidence: cached.lowConfidence || 0,
      });
      return;
    }

    STATE.busy = true;
    setButtonBusy(true, "识别中...");
    var startedAt = performance.now();
    try {
      var page = await pdfViewState.pdfDoc.getPage(pageNumber);
      var rendered = await renderPageForOcr(page);
      var result = await window.electronAPI.localOcrRecognize({ bytes: rendered.bytes });
      if (!result || !result.ok) throw new Error((result && result.error) || "本地 OCR 失败");
      var ordered = orderLines(result.lines, result.imageWidth);
      var lowConfidence = ordered.filter(function (line) {
        return Number(line.confidence) > 0 && Number(line.confidence) < 0.8;
      }).length;
      buildTextLayer(wrapper, ordered, result.imageWidth, result.imageHeight);
      var text = ordered.map(function (line) { return line.text; }).join("\n");
      STATE.cache[cacheKey] = {
        lines: result.lines,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        durationMs: result.durationMs,
        lowConfidence: lowConfidence,
      };
      showPanel(text, {
        page: pageNumber,
        lines: ordered.length,
        ms: Math.round(performance.now() - startedAt),
        lowConfidence: lowConfidence,
      });
      toast("本地 OCR 完成：已生成当前页文字层");
    } finally {
      STATE.busy = false;
      setButtonBusy(false);
    }
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
    orderLines: orderLines,
    buildTextLayer: buildTextLayer,
    boxBounds: boxBounds,
  };
})();
