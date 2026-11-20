/*!
 * PatentLens - Agent 交接 · 一步打包面板
 *
 * 目标：在无法调用模型 API 时，一次点击就把「当前文档 PDF + 任务指令」
 * 打包到本地，可直接拖入外部 Agent 的聊天窗口。不再要求用户先创建任务、
 * 再复制指令、再单独准备附件。
 *
 * 对外暴露 window.HandoffQuickPanel.open(options)
 *   options: { title, prompt, attachment, baseName, onImport }
 */
var HandoffQuickPanel = (function () {
  "use strict";

  var rootEl = null;
  var state = null;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(message, isError) {
    try {
      if (typeof showToast === "function") { showToast(message, isError ? 6000 : 4000); return; }
    } catch (_) {}
    if (typeof window.alert === "function") window.alert(message);
  }

  function injectStyle() {
    if (document.getElementById("pl-quick-handoff-style")) return;
    var style = document.createElement("style");
    style.id = "pl-quick-handoff-style";
    style.textContent =
      ".plqh-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100040;display:flex;align-items:center;justify-content:center;padding:20px;}" +
      ".plqh-card{background:var(--bg-primary,#fff);color:var(--text-primary,#1f2937);border-radius:14px;width:min(520px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:inherit;}" +
      ".plqh-card [hidden]{display:none!important;}" +
      ".plqh-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);background:var(--bg-secondary,#f0fdf4);}" +
      ".plqh-head h3{margin:0;font-size:15px;color:var(--text-primary,#14532d);}" +
      ".plqh-close{border:none;background:none;font-size:20px;line-height:1;color:var(--text-secondary,#6b7280);cursor:pointer;padding:2px 6px;}" +
      ".plqh-body{padding:16px 18px;overflow:auto;}" +
      ".plqh-desc{margin:0 0 12px;font-size:13px;line-height:1.7;color:var(--text-secondary,#475569);}" +
      ".plqh-status{font-size:12.5px;line-height:1.6;color:var(--text-secondary,#64748b);margin-bottom:10px;}" +
      ".plqh-status.error{color:var(--danger,#b91c1c);}" +
      ".plqh-drop{display:block;border:2px dashed #86efac;background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;cursor:grab;}" +
      ".plqh-drop:active{cursor:grabbing;}" +
      ".plqh-drop-title{font-weight:700;font-size:14px;color:#15803d;}" +
      ".plqh-drop-sub{font-size:12px;color:#166534;margin-top:4px;word-break:break-all;}" +
      ".plqh-drop-actions{display:flex;justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap;}" +
      ".plqh-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}" +
      ".plqh-card button{border:1px solid var(--border,#cbd5e1);background:var(--bg-secondary,#f1f5f9);color:inherit;border-radius:8px;padding:7px 12px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}" +
      ".plqh-card button:hover{filter:brightness(.97);}" +
      ".plqh-card button:disabled{opacity:.55;cursor:default;}" +
      ".plqh-card .plqh-primary{background:#16a34a;border-color:#16a34a;color:#fff;}" +
      ".plqh-details{margin-top:14px;font-size:12px;color:var(--text-secondary,#475569);}" +
      ".plqh-details summary{cursor:pointer;font-weight:600;}" +
      ".plqh-details pre{max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#d1fae5;border-radius:8px;padding:10px;font-size:11.5px;line-height:1.55;}" +
      ".plqh-foot{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--border,#e5e7eb);background:var(--bg-secondary,#f8fafc);}";
    document.head.appendChild(style);
  }

  function close() {
    if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    rootEl = null;
    state = null;
  }

  function qs(selector) {
    return rootEl ? rootEl.querySelector(selector) : null;
  }

  function setStatus(text, isError) {
    var el = qs("[data-role=status]");
    if (!el) return;
    el.textContent = text || "";
    el.className = "plqh-status" + (isError ? " error" : "");
  }

  function renderReady() {
    if (!state || !rootEl) return;
    var drop = qs("[data-role=drop]");
    var sub = qs("[data-role=files]");
    if (!drop) return;
    var files = state.readyFiles || [];
    if (!files.length) {
      drop.hidden = true;
      return;
    }
    drop.hidden = false;
    drop.setAttribute("draggable", "true");
    sub.textContent = files.map(function (file) {
      return String(file).split(/[\\/]/).pop();
    }).join(" · ");
    var importBtn = qs('[data-action="import"]');
    if (importBtn) importBtn.hidden = !state.onImport;
    setStatus("已准备好，直接拖住上面的卡片放进 Agent 聊天窗口。", false);
  }

  function startDrag(paths) {
    if (!paths || !paths.length) return;
    try {
      if (window.TransferFileDock && typeof window.TransferFileDock.startDrag === "function") {
        window.TransferFileDock.startDrag(paths.length === 1 ? paths[0] : paths);
      }
    } catch (_) {}
  }

  async function prepare() {
    var session = state;
    if (!session || !rootEl) return;
    var dock = window.TransferFileDock;
    var status = qs("[data-role=status]");
    if (!dock || typeof dock.createBundle !== "function" || !window.electronAPI) {
      setStatus("当前环境不支持文件打包，请使用「复制指令」后手动附上 PDF。", true);
      return;
    }
    try {
      var baseName = dock.sanitizeFileName(session.baseName || "PatentLens");
      var mdName = baseName + "_交给Agent.md";
      var pdfEntry = null;
      var pdfName = "";
      var warning = "";
      if (session.attachment && session.attachment.url) {
        setStatus("正在准备 PDF…", false);
        var pdfResult = await dock.exportPdf(session.ticketId, session.attachment);
        if (session !== state || !rootEl) return;
        if (pdfResult && pdfResult.ok && pdfResult.filePath) {
          pdfEntry = { filePath: pdfResult.filePath, archiveName: session.attachment.fileName || (baseName + ".pdf") };
          pdfName = pdfEntry.archiveName;
        } else {
          warning = "PDF 准备失败：" + ((pdfResult && pdfResult.error) || "未知原因") + "；本次只打包指令。";
        }
      }
      if (session !== state || !rootEl) return;
      var bundle = await dock.createBundle({
        ticketId: session.ticketId,
        bundleName: baseName + "_Agent.zip",
        textFiles: [{ fileName: mdName, content: session.prompt || "" }],
        fileEntries: pdfEntry ? [pdfEntry] : [],
      });
      if (session !== state || !rootEl) return;
      if (!bundle || !bundle.ok) throw new Error((bundle && bundle.error) || "交接包生成失败");
      session.readyFiles = (bundle.filePaths || []).filter(function (file) {
        return !/[\\/]checksums\.json$/i.test(file);
      });
      session.zipPath = bundle.filePath || "";
      session.pdfName = pdfName;
      renderReady();
      if (warning) setStatus(warning, true);
    } catch (error) {
      if (session !== state || !rootEl) return;
      setStatus((error && error.message) || "交接包生成失败", true);
    }
  }

  function build() {
    injectStyle();
    var overlay = document.createElement("div");
    overlay.className = "plqh-overlay";
    overlay.innerHTML =
      '<div class="plqh-card" role="dialog" aria-modal="true" aria-labelledby="plqh-title">' +
        '<div class="plqh-head"><h3 id="plqh-title">🤝 ' + esc(state.title) + "</h3>" +
        '<button type="button" class="plqh-close" data-action="close" title="关闭">&times;</button></div>' +
        '<div class="plqh-body">' +
          '<p class="plqh-desc">已自动打包「当前文档 PDF + 任务指令」。准备好后，把卡片拖入外部 Agent 的聊天窗口即可，不需要 API。</p>' +
          '<div class="plqh-status" data-role="status">正在准备 PDF 和指令…</div>' +
          '<div class="plqh-drop" data-role="drop" hidden>' +
            '<div class="plqh-drop-title">拖到 Agent 窗口</div>' +
            '<div class="plqh-drop-sub" data-role="files"></div>' +
            '<div class="plqh-drop-actions"><button type="button" data-action="folder">打开文件夹</button>' +
            '<button type="button" data-action="zip">拖出 ZIP</button></div>' +
          "</div>" +
          '<div class="plqh-actions"><button type="button" class="plqh-primary" data-action="copy">复制指令</button>' +
          '<button type="button" data-action="import" hidden>Agent 已回答，导入结果</button></div>' +
          '<details class="plqh-details"><summary>查看发给 Agent 的指令</summary><pre data-role="prompt"></pre></details>' +
        "</div>" +
        '<div class="plqh-foot"><button type="button" data-action="close">关闭</button></div>' +
      "</div>";
    return overlay;
  }

  function bind() {
    rootEl.querySelectorAll('[data-action="close"]').forEach(function (button) {
      button.addEventListener("click", close);
    });
    rootEl.addEventListener("click", function (event) {
      if (event.target === rootEl) close();
    });
    var copyBtn = qs('[data-action="copy"]');
    if (copyBtn) copyBtn.addEventListener("click", function () {
      if (!state) return;
      try {
        var copy = window.TransferPackager && window.TransferPackager.copyText;
        if (typeof copy === "function") {
          copy(state.prompt).then(function (result) {
            toast(result && result.ok ? "指令已复制，可粘贴到 Agent 输入框" : "剪贴板写入失败，请在预览中手动复制", !(result && result.ok));
          });
        } else {
          if (window.electronAPI && window.electronAPI.copyToClipboard) window.electronAPI.copyToClipboard(state.prompt);
          toast("指令已复制");
        }
      } catch (_) { toast("复制失败，请在预览中手动复制", true); }
    });
    var importBtn = qs('[data-action="import"]');
    if (importBtn) importBtn.addEventListener("click", function () {
      var handler = state && state.onImport;
      close();
      if (typeof handler === "function") handler();
    });
    var drop = qs("[data-role=drop]");
    if (drop) drop.addEventListener("dragstart", function (event) {
      event.preventDefault();
      if (state) startDrag(state.readyFiles);
    });
    var zipBtn = qs('[data-action="zip"]');
    if (zipBtn) {
      zipBtn.setAttribute("draggable", "true");
      zipBtn.addEventListener("dragstart", function (event) {
        event.preventDefault();
        if (state && state.zipPath) startDrag([state.zipPath]);
      });
      zipBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state && state.zipPath) {
          try { window.TransferFileDock.showItem(state.zipPath); } catch (_) {}
        }
      });
    }
    var folderBtn = qs('[data-action="folder"]');
    if (folderBtn) folderBtn.addEventListener("click", function () {
      var target = state && (state.zipPath || (state.readyFiles || [])[0]);
      if (!target) return;
      try { window.TransferFileDock.showItem(target); } catch (_) {}
    });
    rootEl.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  function open(options) {
    if (rootEl) close();
    options = options || {};
    state = {
      title: options.title || "交给外部 Agent",
      prompt: String(options.prompt || ""),
      attachment: options.attachment || null,
      baseName: options.baseName || "PatentLens",
      onImport: typeof options.onImport === "function" ? options.onImport : null,
      ticketId: window.TransferFileDock.newTicketId(),
      readyFiles: [],
      zipPath: "",
      pdfName: "",
    };
    rootEl = build();
    var promptEl = rootEl.querySelector("[data-role=prompt]");
    if (promptEl) promptEl.textContent = state.prompt;
    document.body.appendChild(rootEl);
    bind();
    try { rootEl.tabIndex = -1; rootEl.focus(); } catch (_) {}
    prepare();
  }

  return { open: open, close: close };
})();

if (typeof window !== "undefined") {
  window.HandoffQuickPanel = HandoffQuickPanel;
}
