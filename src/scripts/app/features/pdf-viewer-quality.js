/**
 * PatentLens PDF 查看器画质与文字层增强
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 在不修改 web-app.js 的前提下，对现有 PDF 查看器做两项增强：
 *   1. 按 devicePixelRatio 渲染 canvas，达到与原生 PDF 阅读器一致的清晰度；
 *   2. 在 canvas 上方生成 pdf.js 文本层，支持鼠标选择 / Ctrl+C 复制文字。
 *
 * 对 EPO、USPTO Global Dossier 等所有通过主应用查看器打开的 PDF 生效。
 */
(function () {
  "use strict";

  const MAX_DEVICE_PIXEL_RATIO = 2;
  const TEXT_SELECT_KEY = "patentlens_pdf_text_select_mode";

  function isTextSelectModeEnabled() {
    try {
      return window.localStorage.getItem(TEXT_SELECT_KEY) !== "false";
    } catch (_) {
      return true;
    }
  }

  // 文字选择模式：启用时文字层优先接收鼠标事件，OCR 文本框不再拦截拖动；
  // 关闭后恢复 OCR 文本框点击、右键菜单与整页框选交互。
  function applyTextSelectMode() {
    if (typeof document === "undefined") return;
    const enabled = isTextSelectModeEnabled();
    const container = document.getElementById("reader-pdf-container");
    if (container) container.classList.toggle("pdf-text-select-mode", enabled);
    const btn = document.getElementById("pdf-text-select-btn");
    if (btn) {
      btn.classList.toggle("active", enabled);
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.textContent = enabled ? "选字 ✓" : "选字";
    }
  }

  function ensureTextSelectButton() {
    if (typeof document === "undefined") return;
    if (document.getElementById("pdf-text-select-btn")) {
      applyTextSelectMode();
      return;
    }
    const anchor = document.getElementById("pdf-annot-hide-ocr");
    const group = anchor && anchor.parentElement;
    if (!group) return;
    const btn = document.createElement("button");
    btn.id = "pdf-text-select-btn";
    btn.type = "button";
    btn.className = "pdf-toolbar-btn pdf-toolbar-btn-text";
    btn.title = "开启后可拖动选择并复制 PDF 文字；关闭后恢复 OCR 文本框点击/框选";
    btn.addEventListener("click", () => {
      const next = !isTextSelectModeEnabled();
      try { window.localStorage.setItem(TEXT_SELECT_KEY, next ? "true" : "false"); } catch (_) {}
      applyTextSelectMode();
    });
    group.insertBefore(btn, anchor);
    applyTextSelectMode();
  }

  // 兼容 pdf.js 的 Util.transform：两个 2D 仿射矩阵相乘
  function multiplyTransform(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  // 计算 canvas 实际渲染倍率：默认跟随设备像素比；
  // 已经放大到 2 倍以上时不再叠加，避免生成超大位图。
  function computeCanvasDpr(logicalScale, devicePixelRatio) {
    const scale = Number(logicalScale) || 1;
    if (scale >= 2) return 1;
    const dpr = Number(devicePixelRatio) || 1;
    return Math.min(Math.max(dpr, 1), MAX_DEVICE_PIXEL_RATIO);
  }

  // 把 pdf.js 的 textContent.items 转成可直接定位的文本片段
  function buildTextItems(textContent, viewport) {
    const items = [];
    if (!textContent || !Array.isArray(textContent.items) || !viewport || !viewport.transform) {
      return items;
    }
    const styles = textContent.styles || {};
    const viewportScale = Number(viewport.scale) || 1;
    for (const item of textContent.items) {
      const str = item && item.str;
      if (!str) continue;
      const tx = multiplyTransform(viewport.transform, item.transform || [1, 0, 0, 1, 0, 0]);
      const angle = Math.atan2(tx[1], tx[0]);
      const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]);
      if (!(fontHeight > 0)) continue;
      const style = styles[item.fontName] || {};
      items.push({
        str,
        left: tx[4],
        top: tx[5] - fontHeight,
        baseline: tx[5],
        fontSize: fontHeight,
        angle,
        fontFamily: style.fontFamily || "sans-serif",
        targetWidth: Math.abs((Number(item.width) || 0) * viewportScale),
        // pdf.js 在行尾标记 hasEOL，用来在复制时插入换行
        eol: !!item.hasEOL,
      });
    }
    // 有些 PDF 不设置 hasEOL；按基线位置判断换行，保证复制出的文字不会连成一行
    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i];
      const next = items[i + 1];
      const lineHeight = Math.max(current.fontSize, next.fontSize);
      if (next.baseline - current.baseline > lineHeight * 0.6) {
        current.eol = true;
      }
    }
    return items;
  }

  function patchPage(page) {
    if (!page || page.__plHiDpiPage) return page;
    page.__plHiDpiPage = true;
    const originalRender = page.render.bind(page);
    page.render = function (params) {
      const ctx = params && params.canvasContext;
      const viewport = params && params.viewport;
      const canvas = ctx && ctx.canvas;
      if (!canvas || !viewport || canvas.__plHiDpiCanvas) return originalRender(params);
      canvas.__plHiDpiCanvas = true;

      const cssWidth = viewport.width;
      const cssHeight = viewport.height;
      canvas.style.width = cssWidth + "px";
      canvas.style.height = cssHeight + "px";

      const dpr = computeCanvasDpr(viewport.scale, typeof window !== "undefined" ? window.devicePixelRatio : 1);
      if (dpr <= 1) {
        canvas.width = Math.floor(cssWidth);
        canvas.height = Math.floor(cssHeight);
        return originalRender(params);
      }
      try {
        const hiViewport = page.getViewport({
          scale: (Number(viewport.scale) || 1) * dpr,
          rotation: viewport.rotation,
        });
        canvas.width = Math.floor(hiViewport.width);
        canvas.height = Math.floor(hiViewport.height);
        const hiParams = Object.assign({}, params, { viewport: hiViewport });
        return originalRender(hiParams);
      } catch (e) {
        // 高清渲染失败时回退到原始分辨率
        canvas.width = Math.floor(cssWidth);
        canvas.height = Math.floor(cssHeight);
        if (typeof console !== "undefined") console.warn("[PDF画质] 高清渲染回退:", e && e.message);
        return originalRender(params);
      }
    };
    return page;
  }

  function patchPdfDocument(pdfDoc) {
    if (!pdfDoc || pdfDoc.__plHiDpiDoc) return pdfDoc;
    pdfDoc.__plHiDpiDoc = true;
    const originalGetPage = pdfDoc.getPage.bind(pdfDoc);
    pdfDoc.getPage = function (pageNumber) {
      return Promise.resolve(originalGetPage(pageNumber)).then(patchPage);
    };
    return pdfDoc;
  }

  function onTextLayerMouseDown(ev) {
    if (ev.button !== 0) return;
    if (!isTextSelectModeEnabled()) return;
    if (typeof pdfViewState !== "undefined" && pdfViewState.annotTool) {
      // 标注工具激活：交给 wrapper 处理标注拖拽，同时避免触发文字选择
      ev.preventDefault();
      return;
    }
    const wrapper = ev.currentTarget && ev.currentTarget.parentElement;
    if (wrapper && wrapper.classList.contains("ocr-page-selectable")) {
      // 正在选择 OCR 页码：保持原有整页点击行为
      ev.preventDefault();
      return;
    }
    if (ev.shiftKey) return; // Shift + 拖拽 = 原有 OCR 文本块框选
    // 阻止 wrapper 的 mousedown 处理器 preventDefault，从而允许浏览器原生选择文字
    ev.stopPropagation();
  }

  async function addTextLayers(pdfDoc, scale) {
    const container = typeof document !== "undefined" ? document.getElementById("reader-pdf-container") : null;
    if (!container || !pdfDoc) return;
    const wrappers = container.querySelectorAll(".pdf-page-wrapper");
    for (const wrapper of wrappers) {
      if (wrapper.querySelector(".pdf-text-layer")) continue;
      const pageNumber = parseInt(wrapper.dataset.page, 10);
      if (!pageNumber) continue;

      let page;
      let textContent;
      try {
        page = await pdfDoc.getPage(pageNumber);
        textContent = await page.getTextContent();
      } catch (_) {
        continue;
      }
      const viewport = page.getViewport({ scale });
      const items = buildTextItems(textContent, viewport);
      if (items.length === 0) continue;

      const layer = document.createElement("div");
      layer.className = "pdf-text-layer";
      layer.dataset.page = String(pageNumber);
      layer.style.width = viewport.width + "px";
      layer.style.height = viewport.height + "px";

      for (const item of items) {
        const span = document.createElement("span");
        span.textContent = item.str;
        span.style.left = item.left + "px";
        span.style.top = item.top + "px";
        span.style.fontSize = item.fontSize + "px";
        span.style.fontFamily = item.fontFamily;
        if (Math.abs(item.angle) > 0.001) {
          span.style.transform = "rotate(" + item.angle + "rad)";
        }
        span._plTargetWidth = item.targetWidth;
        layer.appendChild(span);
        if (item.eol) {
          // 用真实换行文本节点，保证 Selection.toString() 复制出来带换行
          const eolSpan = document.createElement("span");
          eolSpan.className = "pdf-text-layer-eol";
          eolSpan.textContent = "\n";
          eolSpan.style.left = "0px";
          eolSpan.style.top = "0px";
          layer.appendChild(eolSpan);
        }
      }

      // 按 PDF 中的实际宽度做水平缩放，保证选择区域与画面文字对齐
      for (const span of layer.querySelectorAll("span")) {
        const targetWidth = span._plTargetWidth;
        const measuredWidth = span.getBoundingClientRect().width;
        if (targetWidth > 1 && measuredWidth > 1) {
          const scaleX = targetWidth / measuredWidth;
          const prefix = span.style.transform ? span.style.transform + " " : "";
          span.style.transform = prefix + "scaleX(" + scaleX + ")";
        }
        delete span._plTargetWidth;
      }

      layer.addEventListener("mousedown", onTextLayerMouseDown);
      wrapper.appendChild(layer);
    }
  }

  const api = {
    multiplyTransform,
    computeCanvasDpr,
    buildTextItems,
    patchPage,
    patchPdfDocument,
    addTextLayers,
    applyTextSelectMode,
    ensureTextSelectButton,
    isTextSelectModeEnabled,
  };
  if (typeof window !== "undefined") {
    window.__pdfViewerQuality = api;
  }

  if (typeof document === "undefined" || typeof window === "undefined") return;
  try { ensureTextSelectButton(); } catch (_) {}
  if (typeof renderAllPdfPages !== "function") return;

  const originalRenderAllPdfPages = renderAllPdfPages;
  renderAllPdfPages = async function (pdfDoc, blocks, pageDimensions, scale) {
    try { patchPdfDocument(pdfDoc); } catch (_) {}
    const result = await originalRenderAllPdfPages(pdfDoc, blocks, pageDimensions, scale);
    try {
      await addTextLayers(pdfDoc, scale);
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[PDF文字层] 生成失败:", e && e.message);
    }
    try { applyTextSelectMode(); } catch (_) {}
    return result;
  };
})();
