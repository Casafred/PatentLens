/*!
 * PatentLens - Agent 转移模式 · 场景入口注入
 *
 * 在三个高频界面注入「交接 Agent」按钮，不修改 web-app.js：
 *   1. 时间轴页头（.tl-header-actions）          → timeline
 *   2. 审查文档列表 / 审查看板页头               → dossier
 *   3. 专利原文弹窗页头（.ppv-header）           → fulltext
 *   4. 专利原文内嵌视图（#patent-detail-content）→ fulltext
 *
 * 看板/列表会被 web-app.js 频繁重渲染，因此用防抖 MutationObserver 补按钮。
 *
 * 对外暴露 window.TransferEntry
 */
var TransferEntry = (function () {
  "use strict";

  var BTN_CLASS = "pl-transfer-entry-btn";
  var STYLE_ID = "pl-transfer-entry-style";
  var observerTimer = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "." + BTN_CLASS + "{display:inline-flex;align-items:center;gap:6px;border:1px solid #86efac;" +
      "background:#f0fdf4;color:#15803d;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:700;" +
      "cursor:pointer;font-family:inherit;white-space:nowrap;}" +
      "." + BTN_CLASS + ":hover{background:#dcfce7;border-color:#22c55e;}" +
      ".pd-links>." + BTN_CLASS + ",.ppv-actions>." + BTN_CLASS + "{min-height:30px;line-height:1.4;padding:5px 12px;flex-shrink:0;}" +
      ".ppv-actions,.doclist-header-actions,.kanban-header-actions,.tl-header-actions{flex-wrap:wrap;}" +
      ".pl-agent-choice{position:fixed;inset:0;margin:auto;max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--border,#cbd5e1);border-radius:16px;padding:24px;width:min(520px,calc(100vw - 32px));background:var(--bg-secondary,#fff);color:var(--text-primary,#172033);}" +
      ".pl-agent-choice::backdrop{background:#0f172a77;}" +
      ".pl-agent-choice h3{margin:0 0 8px;}.pl-agent-choice p{color:var(--text-secondary,#64748b);}" +
      ".pl-agent-choice button{display:block;width:100%;text-align:left;padding:14px;margin-top:10px;border:1px solid var(--border,#cbd5e1);border-radius:10px;background:var(--bg-primary,#f8fafc);color:inherit;cursor:pointer;font:inherit;}" +
      ".pl-agent-choice button strong,.pl-agent-choice button small{display:block;}.pl-agent-choice button small{margin-top:4px;color:var(--text-secondary,#64748b);}";
    document.head.appendChild(style);
  }

  function makeButton(id, title) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = id;
    btn.className = BTN_CLASS;
    btn.title = title;
    btn.textContent = "交给 Agent";
    return btn;
  }

  function upsertButton(container, id, title, onClick) {
    if (!container || container.querySelector("#" + id)) return;
    var btn = makeButton(id, title);
    btn.addEventListener("click", onClick);
    container.insertBefore(btn, container.querySelector('.ppv-close-btn'));
  }

  // ── 场景打开逻辑 ──
  function openTimeline() {
    var blocks = TransferContext.readTimelineBlocks();
    TransferPanel.open("timeline", { blocks: blocks });
  }

  function defaultSelectedIdxs(docs, extractions) {
    var keyTypes = { office_action: true, response: true, allowance: true };
    var ocrIdxs = docs.filter(function (d) {
      var ext = extractions && extractions[d.idx];
      return ext && (ext.text || ext.markdown);
    }).map(function (d) { return d.idx; });
    if (ocrIdxs.length) return ocrIdxs;
    var keyIdxs = docs.filter(function (d) { return keyTypes[d.type]; }).map(function (d) { return d.idx; });
    return (keyIdxs.length ? keyIdxs : docs.map(function (d) { return d.idx; })).slice(0, 6);
  }

  function openDossier() {
    var kb = TransferContext.getKanban();
    var docs = kb.documents || [];
    if (!docs.length) {
      alertLike("请先查询专利并加载审查文档，再使用交接功能");
      return;
    }
    var initial;
    try {
      initial = (typeof _kanbanSelected !== "undefined" && _kanbanSelected && _kanbanSelected.size)
        ? Array.from(_kanbanSelected)
        : defaultSelectedIdxs(docs, kb.extractions);
    } catch (e) {
      initial = defaultSelectedIdxs(docs, kb.extractions);
    }
    var docSelected = {};
    docs.forEach(function (d) { docSelected[d.idx] = initial.map(String).indexOf(String(d.idx)) >= 0; });
    var blocks = TransferContext.buildDossierBlocks(
      TransferContext.getCurrentData(), docs, kb.extractions, initial
    );
    TransferPanel.open("dossier", {
      blocks: blocks,
      docs: docs,
      extractions: kb.extractions || {},
      docSelected: docSelected,
    });
  }

  function openFulltext(scope) {
    var data = TransferContext.getFulltextData(scope);
    if (!data) {
      alertLike("请先打开一篇专利原文，再使用交接功能");
      return;
    }
    var blocks = TransferContext.buildFulltextBlocks(data);
    TransferPanel.open("fulltext", { blocks: blocks, data: data });
  }

  function openReviewChoice(materialAction) {
    var previous = document.activeElement;
    var dialog = document.createElement("dialog");
    dialog.className = "pl-agent-choice";
    dialog.setAttribute("aria-label", "交给 Agent · 审查材料");
    dialog.innerHTML = '<h3>用 Agent 处理审查材料</h3><p>选择这次要完成的工作。</p>' +
      '<button data-choice="report" data-agent-report="review-report"><strong>分析审查意见与答复</strong><small>准备 OCR 原文，带回报告，审核后采用。</small></button>' +
      '<button data-choice="materials"><strong>复制材料 / 导出 PDF</strong><small>自行向 Agent 提问，无需把结果导回软件。</small></button>' +
      '<button data-choice="tasks"><strong>继续已有任务 / 导入结果</strong><small>查看之前的任务、回答和报告。</small></button>' +
      '<button data-choice="close">取消</button>';
    dialog.addEventListener("click", function (event) {
      var button = event.target.closest("[data-choice]");
      if (!button) return;
      var choice = button.dataset.choice;
      dialog.close();
      if (choice === "materials") materialAction();
      if (choice === "tasks") window.AgentTaskWorkspace.open();
      if (choice === "report") window.AgentReportHandoff.open("review-report").catch(function (error) { alertLike(error.message); });
    });
    dialog.addEventListener("close", function () { dialog.remove(); if (previous && previous.isConnected) previous.focus(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function alertLike(msg) {
    try {
      if (typeof showToast === "function") { showToast(msg); return; }
    } catch (e) { /* ignore */ }
    window.alert(msg);
  }

  // 放入原有页头操作区，避免被 sticky 页头覆盖。
  function ensureInlineFulltextEntry() {
    var container = document.querySelector("#patent-detail-content .pd-header .pd-links");
    if (!container) return;
    upsertButton(container, "pl-transfer-entry-fulltext-inline", "选择本篇专利的原文与附图，交给外部 Agent", function () { openFulltext("detail"); });
  }

  function ensureButtons() {
    upsertButton(
      document.querySelector(".tl-header-actions"),
      "pl-transfer-entry-timeline",
      "一键打包审查概要与时间轴，复制给外部 Agent",
      function () { openReviewChoice(openTimeline); }
    );
    upsertButton(
      document.querySelector(".doclist-header-actions"),
      "pl-transfer-entry-doclist",
      "勾选审查文档与提示词，连同 PDF 交接给外部 Agent",
      function () { openReviewChoice(openDossier); }
    );
    upsertButton(
      document.querySelector(".kanban-header-actions"),
      "pl-transfer-entry-kanban",
      "勾选审查文档与提示词，连同 PDF 交接给外部 Agent",
      function () { openReviewChoice(openDossier); }
    );
    upsertButton(
      document.querySelector(".ppv-actions"),
      "pl-transfer-entry-ppv",
      "勾选打包专利原文内容并复制给外部 Agent",
      function () { openFulltext("popup"); }
    );
    ensureInlineFulltextEntry();
  }

  function scheduleEnsure() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(ensureButtons, 180);
  }

  function install() {
    if (!document.body) return;
    injectStyle();
    ensureButtons();
    var observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }

  return { install: install, ensureButtons: ensureButtons };
})();

if (typeof window !== "undefined") {
  window.TransferEntry = TransferEntry;
}
