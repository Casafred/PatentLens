/*!
 * PatentLens - Agent 转移模式 · 交接面板
 *
 * 一个可复用的模态面板，支持三个场景：
 *   timeline  时间轴/概要
 *   dossier   审查文档（勾选文档 + OCR 块 + PDF 文件交接）
 *   fulltext  专利原文（基础信息/摘要/独权/从权/说明书/引证/附图/同族）
 *
 * 所有 DOM 自行创建与销毁，不改动 web-app.js；样式一次性注入。
 *
 * 对外暴露 window.TransferPanel.open(scene, options)
 */
var TransferPanel = (function () {
  "use strict";

  var SCENE_META = {
    timeline: { title: "交接给外部 Agent · 审查时间轴", tpl: "timeline" },
    dossier: { title: "交接给外部 Agent · 审查文档", tpl: "dossier" },
    fulltext: { title: "交接给外部 Agent · 专利原文", tpl: "fulltext" },
  };

  var state = null;
  var root = null;

  function esc(s) {
    try {
      if (typeof escapeHtml === "function") return escapeHtml(s);
    } catch (e) { /* ignore */ }
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, isError) {
    try {
      if (typeof showToast === "function") { showToast(msg); return; }
    } catch (e) { /* ignore */ }
    var el = document.getElementById("pl-transfer-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "pl-transfer-toast";
      el.className = "pl-transfer-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle("err", !!isError);
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function injectStyle() {
    if (document.getElementById("pl-transfer-style")) return;
    var css = [
      ".pl-transfer-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100050;display:flex;align-items:center;justify-content:center;padding:24px;}",
      ".pl-transfer-modal{background:var(--bg-primary,#fff);border-radius:14px;width:min(900px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:inherit;color:var(--text-primary,#1f2937);}",
      ".pl-transfer-modal *{box-sizing:border-box;}.pl-transfer-header,.pl-transfer-footer{flex-shrink:0;}.pl-transfer-body{min-height:0;}.pl-transfer-intro{margin:0 0 18px;font-size:13px;color:var(--text-secondary,#64748b);}.pl-transfer-section>summary{cursor:pointer;font-weight:600;font-size:13px;margin-bottom:10px;}",
      ".pl-transfer-header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #e5e7eb;background:#f0fdf4;}",
      ".pl-transfer-header h3{margin:0;font-size:16px;color:#14532d;display:flex;align-items:center;gap:8px;}",
      ".pl-transfer-close{border:none;background:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;padding:4px 8px;}",
      ".pl-transfer-body{padding:18px 22px;overflow-y:auto;flex:1;}",
      ".pl-transfer-section{margin-bottom:18px;}",
      ".pl-transfer-section>h4{margin:0 0 8px;font-size:13.5px;color:#0f172a;display:flex;align-items:center;gap:8px;}",
      ".pl-transfer-section>h4 .pl-row-actions{margin-left:auto;display:flex;gap:6px;}",
      ".pl-check-row{display:flex;align-items:flex-start;gap:9px;padding:7px 10px;border-radius:8px;font-size:13.5px;}",
      ".pl-check-row:hover{background:#f0fdf4;}",
      ".pl-check-row input{margin-top:3px;width:15px;height:15px;accent-color:#22c55e;flex:none;}",
      ".pl-check-row .pl-cr-main{flex:1;min-width:0;}",
      ".pl-check-row .pl-cr-label{font-weight:600;}",
      ".pl-check-row .pl-cr-meta{font-size:12px;color:#6b7280;margin-top:1px;}",
      ".pl-check-row .pl-cr-note{font-size:12px;color:#b45309;margin-top:2px;}",
      ".pl-check-row.disabled{opacity:.5;}",
      ".pl-badge{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;}",
      ".pl-badge.green{background:#dcfce7;color:#15803d;}",
      ".pl-badge.gray{background:#f1f5f9;color:#475569;}",
      ".pl-badge.amber{background:#fef3c7;color:#b45309;}",
      ".pl-transfer-textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical;}",
      ".pl-transfer-textarea:focus{outline:none;border-color:#22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.18);}",
      ".pl-btn{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}",
      ".pl-btn-primary{background:#22c55e;color:#fff;}",
      ".pl-btn-primary:hover{background:#16a34a;}",
      ".pl-btn-ghost{background:#f1f5f9;color:#374151;}",
      ".pl-btn-ghost:hover{background:#e2e8f0;}",
      ".pl-btn:disabled{opacity:.45;cursor:not-allowed;}",
      ".pl-transfer-footer{display:flex;align-items:center;gap:12px;padding:14px 22px;border-top:1px solid #e5e7eb;background:#f8fafc;}",
      ".pl-budget{font-size:12.5px;color:#475569;}",
      ".pl-budget strong{color:#14532d;}",
      ".pl-budget.over{color:#b91c1c;}",
      ".pl-file-chip{display:flex;align-items:center;gap:10px;border:1.5px dashed #86efac;background:#f0fdf4;border-radius:10px;padding:10px 12px;margin-bottom:8px;}",
      ".pl-file-chip.ready{border-style:solid;cursor:grab;}",
      ".pl-file-chip:active.ready{cursor:grabbing;}",
      ".pl-file-chip.unsupported,.pl-file-chip.error{border-color:#fca5a5;background:#fef2f2;}",
      ".pl-file-chip .pl-fc-icon{font-size:20px;}",
      ".pl-file-chip .pl-fc-thumb{width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid #d1d5db;background:#f8fafc;flex:none;}",
      ".pl-file-chip .pl-fc-main{flex:1;min-width:0;}",
      ".pl-file-chip .pl-fc-name{font-weight:700;font-size:13px;word-break:break-all;}",
      ".pl-file-chip .pl-fc-sub{font-size:12px;color:#6b7280;margin-top:2px;}",
      ".pl-transfer-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(20px);background:#0f172a;color:#fff;padding:11px 20px;border-radius:10px;font-size:13.5px;opacity:0;transition:all .25s;z-index:100080;max-width:80vw;}",
      ".pl-transfer-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}",
      ".pl-transfer-toast.err{background:#991b1b;}",
      ".pl-transfer-preview{margin-top:8px;}",
      ".pl-transfer-preview summary{cursor:pointer;font-size:12.5px;color:#2563eb;font-weight:600;}",
      ".pl-transfer-preview pre{background:#0f172a;color:#d1fae5;border-radius:10px;padding:14px;font-size:12px;line-height:1.6;max-height:260px;overflow:auto;white-space:pre-wrap;}",
      ".pl-doc-check{border:1px solid #e5e7eb;border-radius:10px;padding:4px 10px;max-height:230px;overflow-y:auto;margin-bottom:8px;}",
      ".pl-transfer-header,.pl-transfer-footer{background:var(--bg-secondary,#f0fdf4);border-color:var(--border,#e5e7eb);}.pl-transfer-header h3,.pl-transfer-section>h4{color:var(--text-primary,#14532d);}.pl-transfer-close,.pl-budget{color:var(--text-secondary,#475569);}.pl-budget strong{color:var(--accent,#15803d);}",
      ".pl-check-row:hover{background:var(--bg-hover,#f0fdf4)}.pl-check-row .pl-cr-meta,.pl-file-chip .pl-fc-sub{color:var(--text-secondary,#6b7280)}.pl-check-row .pl-cr-note{color:var(--warning,#b45309)}.pl-check-row.disabled{opacity:.7}",
      ".pl-transfer-textarea{background:var(--bg-secondary,#fff);color:var(--text-primary,#1f2937);border-color:var(--border,#d1d5db)}.pl-btn-ghost{background:var(--bg-hover,#f1f5f9);color:var(--text-primary,#374151)}.pl-file-chip{background:var(--accent-dim,#f0fdf4)}.pl-file-chip.error{background:var(--bg-secondary,#fef2f2)}.pl-doc-check{border-color:var(--border,#e5e7eb)}",
      "@media(max-width:600px){.pl-transfer-overlay{padding:8px}.pl-transfer-modal{max-height:95vh}.pl-transfer-header,.pl-transfer-body,.pl-transfer-footer{padding:14px}.pl-transfer-header h3{flex-wrap:wrap;font-size:14px}.pl-transfer-footer{flex-wrap:wrap}.pl-transfer-section>h4{flex-wrap:wrap}.pl-transfer-section>h4 .pl-row-actions{margin-left:0;flex-wrap:wrap}}",
    ].join("");
    var style = document.createElement("style");
    style.id = "pl-transfer-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    state = null;
  }

  function checkedBlocks() {
    return state.blocks.filter(function (b) { return b.checked && b.available !== false; });
  }

  function currentStats() {
    var blocks = checkedBlocks();
    var chars = TransferPackager.sumBlockChars(blocks);
    return { blocks: blocks, chars: chars };
  }

  function refreshStatsAndPreview() {
    state.revision = (state.revision || 0) + 1;
    state.bundlePath = null; state.bundleFiles = null;
    renderBundleDock();
    var stats = currentStats();
    var budgetEl = root.querySelector("[data-role=budget]");
    if (budgetEl) {
      budgetEl.innerHTML = "已选 <strong>" + stats.blocks.length + "</strong> 项材料 · <strong>" +
        stats.chars.toLocaleString() + "</strong> 字符";
      budgetEl.classList.toggle("over", stats.chars > 60000);
    }
    var previewEl = root.querySelector("[data-role=preview]");
    if (previewEl) {
      var pkg = TransferPackager.buildPackage({
        prompt: TransferTemplates.compose(SCENE_META[state.scene].tpl, root.querySelector("[data-role=prompt]").value),
        note: root.querySelector("[data-role=note]").value,
        blocks: stats.blocks,
        sceneLabel: SCENE_META[state.scene].title.replace("交接给外部 Agent · ", ""),
        data: state.data,
      });
      previewEl.textContent = pkg.text;
    }
  }

  function blockRowHtml(b, idx) {
    var disabled = b.available === false;
    var meta = b.chars ? b.chars.toLocaleString() + " 字" + (b.truncated ? " · 复制预览节选，文件交接含全文" : "") : "无数据";
    return '<label class="pl-check-row' + (disabled ? " disabled" : "") + '">' +
      '<input type="checkbox" data-block-idx="' + idx + '" ' + (b.checked ? "checked" : "") + (disabled ? " disabled" : "") + ">" +
      '<span class="pl-cr-main"><span class="pl-cr-label">' + esc(b.label) + '</span>' +
      '<div class="pl-cr-meta">' + esc(b.source || "PatentLens") + " · " + esc(meta) + "</div>" +
      (b.note ? '<div class="pl-cr-note">⚠ ' + esc(b.note) + "</div>" : "") +
      "</span></label>";
  }

  function renderBlockSection() {
    var host = root.querySelector("[data-role=block-list]");
    host.innerHTML = state.blocks.map(function (b, i) { return blockRowHtml(b, i); }).join("");
    host.querySelectorAll("input[data-block-idx]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        state.blocks[Number(this.dataset.blockIdx)].checked = this.checked;
        refreshStatsAndPreview();
      });
    });
  }

  function setAllBlocks(checked) {
    state.blocks.forEach(function (b) { if (b.available !== false) b.checked = checked; });
    renderBlockSection();
    refreshStatsAndPreview();
  }

  // ── dossier 场景：文档勾选与 OCR 块联动 ──
  function renderDocSection() {
    var host = root.querySelector("[data-role=doc-list]");
    if (!host) return;
    host.innerHTML = state.docs.map(function (d) {
      var ext = state.extractions && state.extractions[d.idx];
      var hasOcr = !!(ext && (ext.text || ext.markdown));
      return '<label class="pl-check-row">' +
        '<input type="checkbox" data-doc-idx="' + d.idx + '" ' + (state.docSelected[d.idx] ? "checked" : "") + ">" +
        '<span class="pl-cr-main"><span class="pl-cr-label">' + esc(d.docCode || "文档" + d.idx) + " · " + esc(d.name || d.desc || "") + "</span>" +
        '<div class="pl-cr-meta">' + esc(d.date || "") + " · " + (d.numberOfPages || "—") + " 页 · " +
        (hasOcr ? '<span class="pl-badge green">已 OCR</span>' : '<span class="pl-badge gray">未 OCR</span>') +
        (ext && ext.error ? ' <span class="pl-badge amber">OCR 失败</span>' : "") +
        "</div></span></label>";
    }).join("");

    host.querySelectorAll("input[data-doc-idx]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var idx = Number(this.dataset.docIdx);
        state.docSelected[idx] = this.checked;
        syncBlocksToDocSelection();
        renderBlockSection();
        refreshStatsAndPreview();
      });
    });
  }

  function syncBlocksToDocSelection() {
    var selectedIdxs = Object.keys(state.docSelected).filter(function (k) { return state.docSelected[k]; }).map(Number);
    // 重建文档清单块
    var listBlock = TransferContext.buildDocListBlock(state.data, state.docs, selectedIdxs);
    listBlock.checked = true;
    var oldList = state.blocks.filter(function (b) { return b.key === "doc-list"; })[0];
    var listPos = state.blocks.indexOf(oldList);
    if (listPos >= 0) state.blocks[listPos] = listBlock;
    state.blocks = state.blocks.filter(function (b) { return b.key.indexOf("ocr-") !== 0; }).concat(
      TransferContext.buildOcrBlocks(state.docs, state.extractions, selectedIdxs).map(function (b) {
        b.checked = b.available !== false;
        return b;
      })
    );
    renderFileDock();
  }

  function setAllDocs(checked) {
    state.docs.forEach(function (d) { state.docSelected[d.idx] = checked; });
    renderDocSection();
    syncBlocksToDocSelection();
    renderBlockSection();
    refreshStatsAndPreview();
  }

  // ── 文件交接区 ──
  function retainPayloads(payloads, cache) {
    return payloads.map(function (p) {
      var key = p.url + "|" + p.fileName;
      if (!cache[key]) cache[key] = p;
      return cache[key];
    });
  }

  function exportPayload(payload, image) {
    var session = state;
    var ticketId = ensureTicketId();
    if (payload.promise) return payload.promise.then(function () { return state === session; });
    payload.status = "exporting";
    var exporter = image ? TransferFileDock.exportImage : TransferFileDock.exportPdf;
    payload.promise = Promise.resolve().then(function () { return exporter(ticketId, payload); }).then(function (res) {
      payload.status = res && res.ok && res.filePath ? "ready" : "error";
      payload.filePath = res && res.filePath || null;
      payload.error = payload.status === "error" ? (res && res.error || "文件准备失败") : "";
    }).catch(function (error) {
      payload.status = "error"; payload.error = error.message || "文件准备失败";
    }).then(function () { payload.promise = null; return state === session; });
    return payload.promise;
  }

  function renderFileDock() {
    var host = root.querySelector("[data-role=file-dock]");
    if (!host) return;
    var selectedDocs = state.docs.filter(function (d) { return state.docSelected[d.idx]; });
    var payloads = retainPayloads(TransferFileDock.describePayloads(state.data, selectedDocs), state.pdfCache);
    state.payloads = payloads;
    if (!payloads.length) {
      host.innerHTML = '<div class="pl-cr-meta">勾选文档后可准备 PDF 交接文件</div>';
      return;
    }
    host.innerHTML = payloads.map(function (p, i) {
      var cls = p.status === "ready" ? "ready" : (p.status === "unsupported" || p.status === "error" ? "error" : "");
      var draggable = p.status === "ready" ? "draggable=\"true\"" : "";
      var sub = p.status === "ready"
        ? "已就绪，可直接拖入 Agent 聊天窗口"
        : (p.status === "unsupported" ? p.error : "待准备");
      return '<div class="pl-file-chip ' + cls + '" data-payload="' + i + '" ' + draggable + ">" +
        '<span class="pl-fc-icon">📄</span>' +
        '<span class="pl-fc-main"><div class="pl-fc-name">' + esc(p.fileName) + "</div>" +
        '<div class="pl-fc-sub">' + esc(p.docName) + " · " + esc(sub) + (p.error && p.status !== "unsupported" ? " · " + esc(p.error) : "") + "</div></span>" +
        (p.status === "ready"
          ? '<button class="pl-btn pl-btn-ghost" data-action="show-item">文件夹</button>'
          : (p.status === "pending" || p.status === "error" ? '<button class="pl-btn pl-btn-ghost" data-action="export">' + (p.status === "error" ? "重试" : "准备") + '</button>' : (p.status === "exporting" ? "准备中…" : ""))) +
        "</div>";
    }).join("");

    host.querySelectorAll(".pl-file-chip").forEach(function (chip) {
      var p = payloads[Number(chip.dataset.payload)];
      chip.addEventListener("dragstart", function () {
        if (p.status === "ready" && p.filePath) {
          TransferFileDock.startDrag(p.filePath);
        }
      });
      var btn = chip.querySelector("button[data-action]");
      if (!btn) return;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (btn.dataset.action === "show-item") {
          TransferFileDock.showItem(p.filePath);
        } else if (btn.dataset.action === "export") {
          prepareOnePdf(p, chip);
        }
      });
    });
  }

  function ensureTicketId() {
    if (!state.ticketId) state.ticketId = TransferFileDock.newTicketId();
    return state.ticketId;
  }

  function prepareOnePdf(payload, chip) {
    refreshStatsAndPreview();
    var btn = chip.querySelector("button");
    if (btn) { btn.disabled = true; btn.textContent = "准备中…"; }
    exportPayload(payload, false).then(function (active) {
      if (!active) return;
      toast(payload.status === "ready" ? "PDF 已就绪，可拖入 Agent 窗口" : payload.error, payload.status === "error");
      renderFileDock();
    });
  }

  async function preparePayloads(image) {
    var session = state, key = image ? "imagePayloads" : "payloads";
    var pending = (state[key] || []).filter(function (p) { return p.status === "pending" || p.status === "error" || p.status === "exporting"; });
    var next = 0, done = 0;
    async function worker() {
      while (next < pending.length && state === session) {
        var payload = pending[next++];
        if (state[key].indexOf(payload) < 0) continue;
        await exportPayload(payload, image); done++;
        if (state !== session) return;
        if (image) renderImageDock(); else renderFileDock();
        var button = root.querySelector('[data-action="bundle"]');
        if (button && button.disabled) button.textContent = "正在准备附件 " + done + " / " + pending.length + "…";
      }
    }
    // EPO may need an interactive verification window; keep those sequential.
    // GD and image downloads can use two connections.
    var interactiveEpo = !image && pending.some(function (p) { return /[?&](?:epoDirect|epoPdfUrl)=/.test(p.url || ""); });
    await Promise.all(interactiveEpo ? [worker()] : [worker(), worker()]);
    if (state !== session) return;
    var failed = (state[key] || []).filter(function (p) { return p.status === "error" || p.status === "unsupported"; }).length;
    if (failed) toast("有 " + failed + " 个附件未准备成功，可查看下载状态并重试", true);
  }
  function prepareAllPdfs() { return preparePayloads(false); }

  function exportOcrMd() {
    var selectedIdxs = Object.keys(state.docSelected).filter(function (k) { return state.docSelected[k]; }).map(Number);
    var parts = [];
    selectedIdxs.forEach(function (idx) {
      var doc = state.docs.filter(function (d) { return d.idx === idx; })[0];
      var ext = state.extractions && state.extractions[idx];
      var text = ext && (ext.markdown || ext.text);
      if (text) {
        parts.push("## " + (doc ? (doc.docCode + " " + (doc.name || "")) : "文档" + idx) + "\n\n" + text);
      }
    });
    if (!parts.length) { toast("所选文档没有可用的 OCR 文本", true); return; }
    var pn = (state.data && (state.data.patent_number || state.data.raw)) || "PATENT";
    var ticketId = ensureTicketId();
    TransferFileDock.saveTextFile(ticketId, pn + "_OCR文本.md", parts.join("\n\n---\n\n")).then(function (res) {
      if (res && res.ok) {
        toast("OCR 文本附件已生成：" + res.filePath);
        TransferFileDock.showItem(res.filePath);
      } else {
        toast("文本附件生成失败", true);
      }
    });
  }

  // ── 附图文件交接（fulltext 场景）──
  function renderImageDock() {
    var host = root.querySelector("[data-role=image-dock]");
    if (!host) return;
    var payloads = retainPayloads(TransferFileDock.describeImagePayloads(state.data), state.imageCache);
    state.imagePayloads = payloads;
    if (!payloads.length) {
      host.innerHTML = '<div class="pl-cr-meta">该专利没有可交接的附图</div>';
      return;
    }
    host.innerHTML = payloads.map(function (p, i) {
      var cls = p.status === "ready" ? "ready" : (p.status === "unsupported" || p.status === "error" ? "error" : "");
      var draggable = p.status === "ready" ? "draggable=\"true\"" : "";
      var sub = p.status === "ready"
        ? "已就绪，可直接拖入 Agent 聊天窗口"
        : (p.status === "unsupported" ? p.error : "待准备");
      return '<div class="pl-file-chip ' + cls + '" data-image-payload="' + i + '" ' + draggable + ">" +
        '<img class="pl-fc-thumb" src="' + esc(p.url) + '" alt="" onerror="this.style.display=\'none\'">' +
        '<span class="pl-fc-icon" style="display:none">🖼️</span>' +
        '<span class="pl-fc-main"><div class="pl-fc-name">' + esc(p.fileName) + "</div>" +
        '<div class="pl-fc-sub">' + esc(p.docName) + " · " + esc(sub) + (p.error && p.status !== "unsupported" ? " · " + esc(p.error) : "") + "</div></span>" +
        (p.status === "ready"
          ? '<button class="pl-btn pl-btn-ghost" data-action="show-item">文件夹</button>'
          : (p.status === "pending" || p.status === "error" ? '<button class="pl-btn pl-btn-ghost" data-action="export-img">' + (p.status === "error" ? "重试" : "准备") + '</button>' : (p.status === "exporting" ? "准备中…" : ""))) +
        "</div>";
    }).join("");

    host.querySelectorAll(".pl-file-chip").forEach(function (chip) {
      var p = payloads[Number(chip.dataset.imagePayload)];
      chip.addEventListener("dragstart", function () {
        if (p.status === "ready" && p.filePath) TransferFileDock.startDrag(p.filePath);
      });
      var btn = chip.querySelector("button[data-action]");
      if (!btn) return;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (btn.dataset.action === "show-item") {
          TransferFileDock.showItem(p.filePath);
        } else if (btn.dataset.action === "export-img") {
          prepareOneImage(p, chip);
        }
      });
    });
  }

  function prepareOneImage(payload, chip) {
    refreshStatsAndPreview();
    var btn = chip.querySelector("button");
    if (btn) { btn.disabled = true; btn.textContent = "准备中…"; }
    exportPayload(payload, true).then(function (active) {
      if (!active) return;
      toast(payload.status === "ready" ? "附图已就绪，可拖入 Agent 窗口" : payload.error, payload.status === "error");
      renderImageDock();
    });
  }

  function prepareAllImages() { return preparePayloads(true); }

  function renderBundleDock() {
    if (!root || !state) return;
    var host = root.querySelector("[data-role=bundle-dock]");
    if (!host) return;
    if (!state.bundlePath) {
      host.innerHTML = '<div class="pl-cr-meta">准备后，将 context.md、所选 PDF / 附图一次拖入 Agent 的文件上传区。也可使用 ZIP。</div>';
      return;
    }
    var files = state.bundleFiles.slice(), bundlePath = state.bundlePath;
    var missing = state.bundleMissing || [];
    host.innerHTML = '<div class="pl-file-chip ready" draggable="true" data-role="bundle-chip">' +
      '<span class="pl-fc-icon">📄</span><span class="pl-fc-main"><div class="pl-fc-name">拖给 Agent · ' + files.length + ' 个文件</div>' +
      '<div class="pl-fc-sub">含指令、完整已选上下文、时间轴和附件' + (missing.length ? '；缺少 ' + missing.length + ' 个附件，见下方' : '') + '</div></span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="pl-btn pl-btn-ghost" draggable="true" data-role="zip-chip">📦 拖出 ZIP</button><button class="pl-btn pl-btn-ghost" data-action="show-bundle">打开文件夹</button></div>' +
      (missing.length ? '<p role="status" class="pl-cr-note">以下材料未能下载，已在上下文中标记：' + missing.map(function (p) { return esc(p.fileName + '（' + p.error + '）'); }).join('；') + '</p>' : '');
    host.querySelector('[data-role="bundle-chip"]').addEventListener("dragstart", function (event) { event.preventDefault(); TransferFileDock.startDrag(files); });
    host.querySelector('[data-role="zip-chip"]').addEventListener("dragstart", function (event) { event.preventDefault(); TransferFileDock.startDrag(bundlePath); });
    host.querySelector('[data-action="show-bundle"]').addEventListener("click", function () { TransferFileDock.showItem(bundlePath); });
  }

  function buildBundleManifest(stats, pkg) {
    var docs = (state.docs || []).filter(function (d) { return state.docSelected[d.idx]; }).map(function (d) {
      var ext = state.extractions && state.extractions[d.idx];
      var pdf = (state.payloads || []).filter(function (p) { return String(p.idx) === String(d.idx); })[0];
      return {
        idx: d.idx, docId: d.docId || "", docCode: d.docCode || "", name: d.name || d.desc || "",
        date: d.date || "", type: d.type || "", pages: d.numberOfPages || 0,
        hasOcr: !!(ext && (ext.text || ext.markdown)), pdfFile: pdf && pdf.status === "ready" ? pdf.fileName : "",
        sourceUrl: d.epoPdfUrl || pdf && pdf.url || "",
        attachmentStatus: pdf && pdf.status || "unavailable", attachmentError: pdf && pdf.error || "",
      };
    });
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scene: state.scene,
      patent: state.data && (state.data.patent_number || state.data.raw || state.data.applicationNumber) || "",
      office: state.data && state.data.office || "",
      task: { title: SCENE_META[state.scene].title, promptChars: String(state.promptText || "").length, note: root.querySelector("[data-role=note]").value || "" },
      blocks: stats.blocks.map(function (b) { return { key: b.key, label: b.label, source: b.source || "", chars: b.chars || 0, truncated: !!b.truncated }; }),
      documents: docs,
      attachments: (stats.blocks.some(function (b) { return b.key === "drawings"; }) ? state.imagePayloads || [] : []).filter(function (p) { return p.status === "ready"; }).map(function (p) { return { fileName: p.fileName, docName: p.docName }; }),
      timelineDocumentCount: state.docs.length,
      packageChars: pkg.chars,
      source: "PatentLens",
    };
  }

  async function prepareBundle() {
    var stats = currentStats();
    if (!stats.blocks.length) { toast("请至少勾选一项材料", true); return; }
    var session = state, revision = state.revision;
    var button = root.querySelector('[data-action="bundle"]');
    if (button) { button.disabled = true; button.textContent = "正在下载并整理材料…"; }
    try {
      if (state.scene === "dossier") await prepareAllPdfs();
      if (state !== session) return;
      var includeImages = checkedBlocks().some(function (b) { return b.key === "drawings"; });
      if (state.scene === "fulltext" && includeImages) await prepareAllImages();
      if (state !== session || state.revision !== revision) return;
      stats = currentStats();
      stats.blocks = stats.blocks.map(function (b) {
        var full = b.fullText || b.text;
        return Object.assign({}, b, { text: full, chars: full.length, truncated: false });
      });
      var pkg = TransferPackager.buildPackage({
        prompt: TransferTemplates.compose(SCENE_META[state.scene].tpl, state.promptText),
        note: root.querySelector("[data-role=note]").value, blocks: stats.blocks,
        sceneLabel: SCENE_META[state.scene].title.replace("交接给外部 Agent · ", ""), data: state.data,
      });
      var payloads = (state.payloads || []).concat(includeImages ? state.imagePayloads || [] : []);
      var missing = payloads.filter(function (p) { return p.status !== "ready"; });
      var manifest = buildBundleManifest(stats, pkg);
      manifest.missingAttachments = missing.map(function (p) { return { fileName: p.fileName, reason: p.error || p.status }; });
      manifest.complete = missing.length === 0;
      var missingText = missing.length ? "\n\n## 未能交接的附件（请勿假设已阅读）\n" + missing.map(function (p) { return "- " + p.fileName + "：" + (p.error || p.status); }).join("\n") : "";
      var context = pkg.text + missingText;
      var pn = (state.data && (state.data.patent_number || state.data.raw || state.data.applicationNumber)) || "PATENT";
      var bundleName = TransferFileDock.sanitizeFileName(pn + "_Agent.zip");
      var result = await TransferFileDock.createBundle({
        ticketId: TransferFileDock.newTicketId(), bundleName: bundleName,
        textFiles: [
          { fileName: "context.md", content: context },
          { fileName: "manifest.json", content: JSON.stringify(manifest, null, 2) },
        ],
        fileEntries: payloads.filter(function (p) { return p.status === "ready" && p.filePath; }).map(function (p) { return { filePath: p.filePath, archiveName: p.fileName }; }),
      });
      if (state !== session || state.revision !== revision) return;
      if (!result || !result.ok) throw new Error(result && result.error || "上下文文件生成失败");
      state.bundlePath = result.filePath;
      state.bundleFiles = result.filePaths.filter(function (file) { return !/[\\/](?:manifest|checksums)\.json$/i.test(file); });
      state.bundleName = bundleName; state.bundleMissing = missing;
      renderBundleDock();
      toast(missing.length ? "已准备可用材料；有 " + missing.length + " 个附件缺失，请查看提示或重试" : "材料已就绪，拖动文件卡片到 Agent 上传区", missing.length > 0);
    } catch (error) {
      if (state === session) toast(error.message || "上下文文件生成失败", true);
    } finally {
      if (button && button.isConnected) { button.disabled = false; button.textContent = "准备材料并拖给 Agent"; }
      if (state === session && state.revision !== revision) toast("材料选择已变更，请重新准备文件");
    }
  }

  // ── 提示词区 ──
  function renderPromptSection() {
    var tplId = SCENE_META[state.scene].tpl;
    var tpl = TransferTemplates.get(tplId);
    var badge = root.querySelector("[data-role=tpl-badge]");
    if (badge) {
      badge.textContent = tpl.customized ? "自定义" : "系统预置";
      badge.className = "pl-badge " + (tpl.customized ? "amber" : "green");
    }
    var ta = root.querySelector("[data-role=prompt]");
    if (ta) ta.value = state.promptText;
  }

  function buildModal() {
    injectStyle();
    var overlay = document.createElement("div");
    overlay.className = "pl-transfer-overlay";
    var meta = SCENE_META[state.scene];

    var docSection = state.scene === "dossier"
      ? '<div class="pl-transfer-section"><h4>审查文档勾选 <div class="pl-row-actions">' +
        '<button class="pl-btn pl-btn-ghost" data-action="docs-all">全选</button>' +
        '<button class="pl-btn pl-btn-ghost" data-action="docs-none">全不选</button></div></h4>' +
        '<div class="pl-doc-check" data-role="doc-list"></div></div>'
      : "";

    var fileSection = state.scene === "dossier"
      ? '<details class="pl-transfer-section"><summary>查看 PDF 下载状态 / 单独拖出</summary><h4>PDF 文件交接<div class="pl-row-actions">' +
        '<button class="pl-btn pl-btn-ghost" data-action="prep-all">准备全部 PDF</button>' +
        '<button class="pl-btn pl-btn-ghost" data-action="export-md">导出 OCR 文本.md</button>' +
        '</div></h4><div data-role="file-dock"></div></details>'
      : "";

    var imageSection = state.scene === "fulltext"
      ? '<details class="pl-transfer-section"><summary>查看附图下载状态 / 单独拖出</summary><h4>说明书附图交接<div class="pl-row-actions">' +
        '<button class="pl-btn pl-btn-ghost" data-action="prep-images">准备全部附图</button>' +
        '</div></h4><div data-role="image-dock"></div></details>'
      : "";
    var bundleSection = '<div class="pl-transfer-section"><h4>拖给外部 Agent</h4>' +
      '<div class="pl-cr-meta" style="margin-bottom:8px">把 PatentLens 整理好的指令、时间轴、原文上下文和附件一次拖进 Agent，避免分别找文件。</div>' +
      '<button class="pl-btn pl-btn-primary" data-action="bundle">准备材料并拖给 Agent</button>' +
      '<div data-role="bundle-dock" style="margin-top:8px"></div></div>';

    overlay.innerHTML =
      '<div class="pl-transfer-modal" role="dialog" aria-modal="true">' +
      '<div class="pl-transfer-header"><h3>🤝 ' + esc(meta.title) +
      ' <span class="pl-badge green" data-role="tpl-badge">系统预置</span></h3>' +
      '<button class="pl-transfer-close" data-action="close" title="关闭">&times;</button></div>' +
      '<div class="pl-transfer-body">' +
      '<p class="pl-transfer-intro">已选好当前材料。点击准备，再将文件卡片拖到 Agent 的聊天上传区。需要时可调整下方材料与指令。</p>' +
      bundleSection +
      '<div class="pl-transfer-section"><h4>这次要 Agent 做什么？（可选）</h4><textarea class="pl-transfer-textarea" data-role="note" rows="2" placeholder="例如：梳理审查意见和答复，指出尚未解决的问题"></textarea></div>' +
      docSection +
      '<details class="pl-transfer-section"><summary>调整上下文材料</summary><h4>要发送的材料 <div class="pl-row-actions">' +
      '<button class="pl-btn pl-btn-ghost" data-action="blocks-all">全选可用</button>' +
      '<button class="pl-btn pl-btn-ghost" data-action="blocks-none">全不选</button></div></h4>' +
      '<div data-role="block-list"></div></details>' +
      '<details class="pl-transfer-section"><summary>调整分析指令（已预填，可选）</summary>' +
      '<textarea class="pl-transfer-textarea" data-role="prompt" rows="9"></textarea>' +
      '<div style="margin-top:8px;display:flex;gap:8px;">' +
      '<button class="pl-btn pl-btn-ghost" data-action="save-tpl">保存为我的默认</button>' +
      '<button class="pl-btn pl-btn-ghost" data-action="reset-tpl">恢复系统预置</button></div></details>' +
      fileSection +
      imageSection +
      (state.scene === "dossier" ? '<details class="pl-transfer-section"><summary>把分析结果保存回 PatentLens（可选）</summary><p class="pl-transfer-intro">创建审查分析任务后，可将 Agent 返回的结果导入本案并审核采用。</p><button class="pl-btn pl-btn-ghost" data-action="report">创建审查分析任务</button> <button class="pl-btn pl-btn-ghost" data-action="tasks">已有任务 / 导入结果</button></details>' : '') +
      '<details class="pl-transfer-preview"><summary>预览将发送的内容</summary>' +
      '<pre data-role="preview"></pre></details>' +
      "</div>" +
      '<div class="pl-transfer-footer">' +
      '<span class="pl-budget" data-role="budget"></span>' +
      '<span style="flex:1"></span>' +
      '<button class="pl-btn pl-btn-ghost" data-action="close">取消</button>' +
      '<button class="pl-btn pl-btn-primary" data-action="copy">复制指令（可选）</button>' +
      "</div></div>";

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function bindActions() {
    root.querySelectorAll('[data-action="close"]').forEach(function (b) {
      b.addEventListener("click", close);
    });
    root.querySelector('[data-action="blocks-all"]').addEventListener("click", function () { setAllBlocks(true); });
    root.querySelector('[data-action="blocks-none"]').addEventListener("click", function () { setAllBlocks(false); });

    var docsAll = root.querySelector('[data-action="docs-all"]');
    if (docsAll) docsAll.addEventListener("click", function () { setAllDocs(true); });
    var docsNone = root.querySelector('[data-action="docs-none"]');
    if (docsNone) docsNone.addEventListener("click", function () { setAllDocs(false); });

    var prepAll = root.querySelector('[data-action="prep-all"]');
    if (prepAll) prepAll.addEventListener("click", function () { refreshStatsAndPreview(); void prepareAllPdfs(); });
    var prepImages = root.querySelector('[data-action="prep-images"]');
    if (prepImages) prepImages.addEventListener("click", function () { refreshStatsAndPreview(); void prepareAllImages(); });
    var exportMd = root.querySelector('[data-action="export-md"]');
    if (exportMd) exportMd.addEventListener("click", exportOcrMd);
    root.querySelector('[data-action="bundle"]').addEventListener("click", function () { void prepareBundle(); });

    var report = root.querySelector('[data-action="report"]');
    if (report) report.addEventListener("click", function () {
      var selected = state.docs.filter(function (d) { return state.docSelected[d.idx]; }).map(function (d) { return d.idx; });
      close();
      window.AgentReportHandoff.open("review-report", { selectedIdxs: selected }).catch(function (error) { toast(error.message, true); });
    });
    var tasks = root.querySelector('[data-action="tasks"]');
    if (tasks) tasks.addEventListener("click", function () { close(); window.AgentTaskWorkspace.open(); });
    var promptTa = root.querySelector("[data-role=prompt]");
    root.querySelector('[data-action="save-tpl"]').addEventListener("click", function () {
      var ok = TransferTemplates.saveCustom(SCENE_META[state.scene].tpl, promptTa.value);
      state.promptText = promptTa.value;
      renderPromptSection();
      refreshStatsAndPreview();
      toast(ok ? "已保存为该场景的自定义默认提示词" : "保存失败", !ok);
    });
    root.querySelector('[data-action="reset-tpl"]').addEventListener("click", function () {
      TransferTemplates.reset(SCENE_META[state.scene].tpl);
      state.promptText = TransferTemplates.get(SCENE_META[state.scene].tpl).body;
      promptTa.value = state.promptText;
      renderPromptSection();
      refreshStatsAndPreview();
      toast("已恢复系统预置提示词");
    });
    promptTa.addEventListener("input", function () {
      state.promptText = promptTa.value;
      refreshStatsAndPreview();
    });
    root.querySelector("[data-role=note]").addEventListener("input", refreshStatsAndPreview);

    root.querySelector('[data-action="copy"]').addEventListener("click", function () {
      var stats = currentStats();
      if (!stats.blocks.length) {
        toast("请至少勾选一个有数据的上下文块", true);
        return;
      }
      var tplId = SCENE_META[state.scene].tpl;
      var fullPrompt = TransferTemplates.compose(tplId, state.promptText);
      var pkg = TransferPackager.buildPackage({
        prompt: fullPrompt,
        note: root.querySelector("[data-role=note]").value,
        blocks: stats.blocks,
        sceneLabel: SCENE_META[state.scene].title.replace("交接给外部 Agent · ", ""),
        data: state.data,
      });
      TransferPackager.copyText(pkg.text).then(function (res) {
        if (res && res.ok) {
          toast("交接指令已复制（" + pkg.chars.toLocaleString() + " 字符），请到 Agent 聊天窗口粘贴");
        } else {
          toast("剪贴板写入失败，请手动全选预览内容复制", true);
        }
      });
    });
  }

  /**
   * 打开面板
   * @param {string} scene timeline | dossier | fulltext
   * @param {object} opts { blocks, docs, extractions, docSelected, data }
   */
  function open(scene, opts) {
    if (!SCENE_META[scene]) throw new Error("unknown transfer scene: " + scene);
    if (root) close();
    opts = opts || {};

    state = {
      scene: scene,
      data: opts.data || TransferContext.getCurrentData(),
      blocks: (opts.blocks || []).map(function (b) {
        return Object.assign({}, b, { checked: b.available !== false && (b.checked !== false) });
      }),
      docs: opts.docs || [],
      extractions: opts.extractions || {},
      docSelected: opts.docSelected || {},
      payloads: [],
      imagePayloads: [],
      pdfCache: Object.create(null),
      imageCache: Object.create(null),
      ticketId: null,
      promptText: TransferTemplates.get(SCENE_META[scene].tpl).body,
    };

    root = buildModal();
    renderPromptSection();
    renderBlockSection();
    if (scene === "dossier") {
      renderDocSection();
      syncBlocksToDocSelection();
      renderBlockSection();
      renderFileDock();
    }
    if (scene === "fulltext") {
      renderImageDock();
    }
    renderBundleDock();
    bindActions();
    refreshStatsAndPreview();
  }

  return { open: open, close: close };
})();

if (typeof window !== "undefined") {
  window.TransferPanel = TransferPanel;
}
