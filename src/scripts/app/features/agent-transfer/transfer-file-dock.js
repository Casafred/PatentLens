/*!
 * PatentLens - Agent 转移模式 · 文件交接区（渲染进程编排）
 *
 * 职责：
 *   1. 依据审查文档描述符构造本地 PDF URL（与 renderDocList 的下载链路一致）
 *   2. 通过 preload 桥调用主进程 IPC：PDF 落盘、原生拖出、文件夹定位、文本附件
 *   3. 维护交接批次 ticketId 与文件载荷状态
 *
 * 主进程实现见 electron-main.js 的 transfer:* IPC；
 * 本模块只做参数组织与状态管理，不直接触碰 Node 能力。
 *
 * 对外暴露 window.TransferFileDock
 */
var TransferFileDock = (function () {
  "use strict";

  function api() {
    return (typeof window !== "undefined" && window.electronAPI) || null;
  }

  function newTicketId() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var rand = Math.random().toString(36).slice(2, 8);
    return "TK-" + stamp + "-" + rand;
  }

  function sanitizeFileName(name) {
    return String(name == null ? "" : name)
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "file";
  }

  // 与 web-app.js renderDocList 的 downloadUrl 构造保持同构
  function buildDocPdfUrl(data, doc) {
    if (!data || !doc || !doc.docId) return null;
    var isUS = data.office === "US";
    var isJP = data.office === "JP";
    var isDE = data.office === "DE";
    if (isJP || isDE) return null; // Electron 版 JPO/DE 代理未启用
    var urlDocNum = isUS
      ? data.applicationNumber
      : encodeURIComponent(data.docNumber || data.applicationNumber);
    var encodedDocId = encodeURIComponent(doc.docId);
    var url = "/api/gd/doc-content/svc/doccontent/" + data.office + "/" + urlDocNum +
      "/" + encodedDocId + "/" + (doc.numberOfPages || 1) + "/" + (doc.docFormat || "PDF");
    try {
      if (typeof withEpoPdfUrl === "function") url = withEpoPdfUrl(url, doc);
      if (typeof withEpoDirect === "function") url = withEpoDirect(url);
    } catch (e) { /* 全局不可用时使用基础 URL */ }
    return url;
  }

  function buildFileName(data, doc) {
    var pn = (data && (data.patent_number || data.raw || data.applicationNumber)) || "PATENT";
    var safeDate = (doc.date || "").replace(/[\\/:*?"<>|\s]/g, "-");
    var code = doc.docCode || ("doc" + doc.idx);
    return sanitizeFileName(pn + "_" + code + (safeDate ? "_" + safeDate : "") + ".pdf");
  }

  // 把文档描述符数组转为文件载荷描述（不落盘，仅描述）
  function describePayloads(data, documents) {
    return (documents || []).map(function (doc) {
      var url = buildDocPdfUrl(data, doc);
      return {
        idx: doc.idx,
        url: url,
        fileName: buildFileName(data, doc),
        docName: doc.name || doc.desc || ("文档" + doc.idx),
        docCode: doc.docCode || "",
        date: doc.date || "",
        pages: doc.numberOfPages || 0,
        status: url ? "pending" : "unsupported",
        filePath: null,
        error: url ? "" : "该专利局文档暂不支持 PDF 交接",
      };
    });
  }

  // 单个 PDF 落盘到交接目录
  function exportPdf(ticketId, payload) {
    var bridge = api();
    if (!bridge || typeof bridge.transferExportPdf !== "function") {
      return Promise.resolve({ ok: false, error: "当前环境不支持文件交接" });
    }
    return bridge.transferExportPdf({
      ticketId: ticketId,
      url: payload.url,
      fileName: payload.fileName,
    });
  }

  // 原生拖拽：由面板的 dragstart 事件调用
  function startDrag(filePath) {
    var bridge = api();
    if (!bridge || typeof bridge.transferStartDrag !== "function" || !filePath) return false;
    try {
      bridge.transferStartDrag({ filePath: filePath });
      return true;
    } catch (e) {
      return false;
    }
  }

  function showItem(filePath) {
    var bridge = api();
    if (!bridge || typeof bridge.transferShowItem !== "function" || !filePath) return false;
    try {
      bridge.transferShowItem({ filePath: filePath });
      return true;
    } catch (e) {
      return false;
    }
  }

  // OCR 文本附件（.md）
  function saveTextFile(ticketId, fileName, content) {
    var bridge = api();
    if (!bridge || typeof bridge.transferSaveText !== "function") {
      return Promise.resolve({ ok: false, error: "当前环境不支持文件交接" });
    }
    return bridge.transferSaveText({
      ticketId: ticketId,
      fileName: sanitizeFileName(fileName).replace(/\.md$/i, "") + ".md",
      content: String(content || ""),
    });
  }

  // ── 说明书附图（外部图片 URL）──
  function imageExtFromUrl(url) {
    try {
      var pathname = new URL(url, "https://example.com").pathname.toLowerCase();
      var m = /\.(png|jpe?g|gif|webp|tiff?|bmp)$/.exec(pathname);
      if (m) return "." + m[1].replace("jpeg", "jpg").replace("tif", "tiff");
    } catch (e) { /* ignore */ }
    return ".png";
  }

  function buildImageFileName(data, index, url) {
    var pn = (data && (data.patent_number || data.raw || data.applicationNumber)) || "PATENT";
    return sanitizeFileName(pn + "_图" + (index + 1) + imageExtFromUrl(url));
  }

  // 把附图 URL 数组转为图片载荷描述（不落盘，仅描述）
  function describeImagePayloads(data) {
    var drawings = (data && data.drawings) || [];
    return drawings.map(function (url, i) {
      var ok = /^https?:\/\//.test(url);
      return {
        kind: "image",
        index: i,
        url: ok ? url : "",
        fileName: buildImageFileName(data, i, url),
        docName: "说明书附图 图" + (i + 1),
        status: ok ? "pending" : "unsupported",
        filePath: null,
        error: ok ? "" : "附图地址不可用",
      };
    });
  }

  function exportImage(ticketId, payload) {
    var bridge = api();
    if (!bridge || typeof bridge.transferExportImage !== "function") {
      return Promise.resolve({ ok: false, error: "当前环境不支持文件交接" });
    }
    return bridge.transferExportImage({
      ticketId: ticketId,
      url: payload.url,
      fileName: payload.fileName,
    });
  }

  return {
    newTicketId: newTicketId,
    sanitizeFileName: sanitizeFileName,
    buildDocPdfUrl: buildDocPdfUrl,
    buildFileName: buildFileName,
    describePayloads: describePayloads,
    exportPdf: exportPdf,
    startDrag: startDrag,
    showItem: showItem,
    saveTextFile: saveTextFile,
    imageExtFromUrl: imageExtFromUrl,
    buildImageFileName: buildImageFileName,
    describeImagePayloads: describeImagePayloads,
    exportImage: exportImage,
  };
})();

if (typeof window !== "undefined") {
  window.TransferFileDock = TransferFileDock;
}
