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
      ".pl-transfer-modal{background:#fff;border-radius:14px;width:min(900px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:inherit;color:#1f2937;}",
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
    var stats = currentStats();
    var budgetEl = root.querySelector("[data-role=budget]");
    if (budgetEl) {
      budgetEl.innerHTML = "已勾选 <strong>" + stats.blocks.length + "</strong> 个上下文块 · 上下文约 <strong>" +
        stats.chars.toLocaleString() + "</strong> 字符（估算 " + Math.round(stats.chars / 1.8).toLocaleString() + " tokens）";
      budgetEl.classList.toggle("over", stats.chars > 60000);
    }
    var previewEl = root.querySelector("[data-role=preview]");
    if (previewEl) {
      var pkg = TransferPackager.buildPackage({
        prompt: root.querySelector("[data-role=prompt]").value,
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
    var meta = b.chars ? b.chars.toLocaleString() + " 字" + (b.truncated ? " · 已截断" : "") : "无数据";
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
    // OCR 块勾选与文档选择联动
    state.blocks.forEach(function (b) {
      if (b.key.indexOf("ocr-") === 0) {
        var idx = Number(b.key.slice(4));
        b.checked = !!state.docSelected[idx];
      }
    });
  }

  function setAllDocs(checked) {
    state.docs.forEach(function (d) { state.docSelected[d.idx] = checked; });
    renderDocSection();
    syncBlocksToDocSelection();
    renderBlockSection();
    refreshStatsAndPreview();
  }

  // ── 文件交接区 ──
  function renderFileDock() {
    var host = root.querySelector("[data-role=file-dock]");
    if (!host) return;
    var selectedDocs = state.docs.filter(function (d) { return state.docSelected[d.idx]; });
    var payloads = TransferFileDock.describePayloads(state.data, selectedDocs);
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
          : (p.status === "pending" ? '<button class="pl-btn pl-btn-ghost" data-action="export">准备</button>' : "")) +
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
    var ticketId = ensureTicketId();
    payload.status = "exporting";
    var btn = chip.querySelector("button");
    if (btn) { btn.disabled = true; btn.textContent = "准备中…"; }
    TransferFileDock.exportPdf(ticketId, payload).then(function (res) {
      if (res && res.ok && res.filePath) {
        payload.status = "ready";
        payload.filePath = res.filePath;
        toast("PDF 已就绪，可拖入 Agent 窗口");
      } else {
        payload.status = "error";
        payload.error = (res && res.error) || "落盘失败";
        toast("文件准备失败：" + payload.error, true);
      }
      renderFileDock();
    });
  }

  function prepareAllPdfs() {
    var pendings = (state.payloads || []).filter(function (p) { return p.status === "pending"; });
    if (!pendings.length) { toast("没有待准备的文件"); return; }
    var ticketId = ensureTicketId();
    var chain = Promise.resolve();
    pendings.forEach(function (p) {
      chain = chain.then(function () {
        p.status = "exporting";
        return TransferFileDock.exportPdf(ticketId, p).then(function (res) {
          if (res && res.ok && res.filePath) {
            p.status = "ready";
            p.filePath = res.filePath;
          } else {
            p.status = "error";
            p.error = (res && res.error) || "落盘失败";
          }
        });
      });
    });
    chain.then(function () {
      renderFileDock();
      var failed = (state.payloads || []).filter(function (p) { return p.status === "error"; }).length;
      toast(failed ? "部分文件准备失败，请查看芯片提示" : "全部 PDF 已就绪，可拖入 Agent 窗口", failed > 0);
    });
  }

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
      ? '<div class="pl-transfer-section"><h4>PDF 文件交接（拖入 Agent 上传区）<div class="pl-row-actions">' +
        '<button class="pl-btn pl-btn-ghost" data-action="prep-all">准备全部 PDF</button>' +
        '<button class="pl-btn pl-btn-ghost" data-action="export-md">导出 OCR 文本.md</button>' +
        '</div></h4><div data-role="file-dock"></div></div>'
      : "";

    overlay.innerHTML =
      '<div class="pl-transfer-modal" role="dialog" aria-modal="true">' +
      '<div class="pl-transfer-header"><h3>🤝 ' + esc(meta.title) +
      ' <span class="pl-badge green" data-role="tpl-badge">系统预置</span></h3>' +
      '<button class="pl-transfer-close" data-action="close" title="关闭">&times;</button></div>' +
      '<div class="pl-transfer-body">' +
      docSection +
      '<div class="pl-transfer-section"><h4>上下文块勾选 <div class="pl-row-actions">' +
      '<button class="pl-btn pl-btn-ghost" data-action="blocks-all">全选可用</button>' +
      '<button class="pl-btn pl-btn-ghost" data-action="blocks-none">全不选</button></div></h4>' +
      '<div data-role="block-list"></div></div>' +
      '<div class="pl-transfer-section"><h4>任务提示词（可编辑，自动保存为我的自定义版本）</h4>' +
      '<textarea class="pl-transfer-textarea" data-role="prompt" rows="9"></textarea>' +
      '<div style="margin-top:8px;display:flex;gap:8px;">' +
      '<button class="pl-btn pl-btn-ghost" data-action="save-tpl">保存为我的默认</button>' +
      '<button class="pl-btn pl-btn-ghost" data-action="reset-tpl">恢复系统预置</button></div></div>' +
      '<div class="pl-transfer-section"><h4>补充备注（可选，随指令一起交接）</h4>' +
      '<textarea class="pl-transfer-textarea" data-role="note" rows="3" placeholder="例如：客户重点关注创造性争议，希望输出对比表格…"></textarea></div>' +
      fileSection +
      '<details class="pl-transfer-preview" open><summary>预览完整交接指令（复制内容即所得）</summary>' +
      '<pre data-role="preview"></pre></details>' +
      "</div>" +
      '<div class="pl-transfer-footer">' +
      '<span class="pl-budget" data-role="budget"></span>' +
      '<span style="flex:1"></span>' +
      '<button class="pl-btn pl-btn-ghost" data-action="close">取消</button>' +
      '<button class="pl-btn pl-btn-primary" data-action="copy">📋 一键复制交接指令</button>' +
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
    if (prepAll) prepAll.addEventListener("click", prepareAllPdfs);
    var exportMd = root.querySelector('[data-action="export-md"]');
    if (exportMd) exportMd.addEventListener("click", exportOcrMd);

    var promptTa = root.querySelector("[data-role=prompt]");
    root.querySelector('[data-action="save-tpl"]').addEventListener("click", function () {
      var ok = TransferTemplates.saveCustom(SCENE_META[state.scene].tpl, promptTa.value);
      state.promptText = promptTa.value;
      renderPromptSection();
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
    bindActions();
    refreshStatsAndPreview();
  }

  return { open: open, close: close };
})();

if (typeof window !== "undefined") {
  window.TransferPanel = TransferPanel;
}
