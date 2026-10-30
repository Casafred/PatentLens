/**
 * PatentLens OCR 默认策略
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 阅读器已支持直接选择/复制文字版 PDF 的文字，因此默认不再对所有 PDF 自动 OCR：
 *   1. 未设置 autoOcr 时按「关闭」处理（设置面板默认不勾选）；
 *   2. 只有扫描件（页面没有文字层）才自动触发 OCR，文字版 PDF 保持按需手动 OCR。
 *
 * 用户显式勾选「对所有 PDF 自动 OCR」时，仍保留原有行为（由 web-app.js 处理）。
 */
(function () {
  "use strict";

  const SAMPLE_PAGES = 3;            // 抽样检测前几页
  const SCANNED_CHARS_PER_PAGE = 20;  // 平均每页有效字符低于该值视为扫描件

  const pendingChecks = {};

  function countTextChars(textContent) {
    if (!textContent || !Array.isArray(textContent.items)) return 0;
    let total = 0;
    for (let i = 0; i < textContent.items.length; i++) {
      const item = textContent.items[i];
      if (item && typeof item.str === "string") {
        total += item.str.replace(/\s+/g, "").length;
      }
    }
    return total;
  }

  function isScannedChars(charTotal, pageCount) {
    const pages = Number(pageCount) || 0;
    if (pages <= 0) return false;
    return (Number(charTotal) || 0) < SCANNED_CHARS_PER_PAGE * pages;
  }

  // 把未保存的 autoOcr 视为关闭；已显式保存的值（true/false）保持不变。
  function applyDefaultOcrOff() {
    const AI = window.AI;
    if (!AI || typeof AI.getOCRConfig !== "function" || AI.__plOcrDefaultOff) return;
    const originalGetOCRConfig = AI.getOCRConfig;
    AI.getOCRConfig = function (config) {
      const ocr = originalGetOCRConfig(config);
      if (ocr && ocr.autoOcr === undefined) ocr.autoOcr = false;
      return ocr;
    };
    AI.__plOcrDefaultOff = true;
  }

  async function detectScannedPdf(pdfDoc, totalPages) {
    const pages = Number(totalPages) || Number(pdfDoc && pdfDoc.numPages) || 0;
    const sample = Math.min(pages, SAMPLE_PAGES);
    if (sample <= 0) return false;
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= sample; pageNumber++) {
      const page = await pdfDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      chars += countTextChars(textContent);
    }
    return isScannedChars(chars, sample);
  }

  function autoOcrForScannedPdf(idx) {
    if (idx == null) return;
    if (typeof pdfViewState === "undefined" || !pdfViewState.active) return;
    if (pdfViewState.currentDocIdx !== idx) return;
    if (pdfViewState.traceJumpPending) return;

    const ext = typeof kanbanState !== "undefined" && kanbanState.extractions
      ? kanbanState.extractions[idx]
      : null;
    if (ext && Array.isArray(ext.blocks) && ext.blocks.length > 0) return;

    // 已有 OCR 任务（运行中/完成/失败/中止）不再重复自动触发
    if (typeof ocrJobs !== "undefined" && ocrJobs[idx]) return;
    if (document.getElementById("ocr-scope-panel")) return;

    const pdfDoc = pdfViewState.pdfDoc;
    if (!pdfDoc) return;

    if (pendingChecks[idx]) return;
    pendingChecks[idx] = true;

    detectScannedPdf(pdfDoc, pdfViewState.totalPages).then(function (scanned) {
      delete pendingChecks[idx];
      if (!scanned) return;
      if (typeof pdfViewState === "undefined" || !pdfViewState.active) return;
      if (pdfViewState.currentDocIdx !== idx) return;
      if (typeof ocrJobs !== "undefined" && ocrJobs[idx]) return;
      if (document.getElementById("ocr-scope-panel")) return;

      const totalPages = pdfViewState.totalPages || (pdfDoc && pdfDoc.numPages) || 0;
      // 页数较多时沿用原有范围选择弹窗，避免意外产生高额 OCR 开销
      if (totalPages > 10) {
        if (typeof _showOcrScopeDialog === "function") _showOcrScopeDialog(idx, totalPages);
      } else if (typeof ocrPdf === "function") {
        ocrPdf();
      }
    }).catch(function () {
      delete pendingChecks[idx];
    });
  }

  applyDefaultOcrOff();

  if (typeof window !== "undefined") {
    window.__ocrAutoMode = {
      countTextChars,
      isScannedChars,
      detectScannedPdf,
      applyDefaultOcrOff,
      SAMPLE_PAGES,
      SCANNED_CHARS_PER_PAGE,
    };
  }

  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (typeof pdfViewState === "undefined" || typeof kanbanState === "undefined") return;
  if (typeof renderPdfView !== "function") return;

  const originalRenderPdfView = renderPdfView;
  renderPdfView = async function (idx) {
    const result = await originalRenderPdfView.apply(this, arguments);
    try {
      autoOcrForScannedPdf(idx);
    } catch (_) {}
    return result;
  };
})();
