/*!
 * PatentLens - 审查看板勾选状态增强
 *
 * 目的：用户在审查看板（kanban/doclist）中手动勾选过文档后，切换选择模式
 * （review / citedRefs / mergeExport）或确认操作后，勾选状态应被保留并跨模式
 * 共享，而不是被默认规则重置。
 *
 * 依赖（均为 web-app.js 暴露的全局，该文件已冻结不可新增行）：
 *   - _kanbanSelected / _kanbanSelectMode   web-app.js 顶层全局选择状态
 *   - kanbanState / currentData / showError / escapeHtml
 *   - shouldDefaultSelectForAnalysis / buildMergeDownloadUrl
 *   - _applyKanbanSelection / _updateKanbanSelectSummary   原有 UI 同步函数（复用）
 *
 * 策略：web-app.js 的选择函数是经典脚本全局函数声明，本模块在加载后用增强版
 * 覆盖 window.enterKanbanSelectMode / window.exitKanbanSelectMode /
 * window._toggleKanbanCard。增强版保留原 UI 行为，但通过 _kanbanUserTouched
 * 标志控制 _kanbanSelected 的清空时机：
 *   - 用户手动 toggle 过 → 后续进入新模式不清空，保留用户勾选
 *   - 「全不选」「默认」「取消」按钮由 web-app.js 原监听处理，会 clear 并重置
 *     _kanbanSelected；本模块在按钮点击后将 _kanbanUserTouched 重置为 false，
 *     让下次进入可用默认规则
 *   - 加载新专利时 web-app.js 调 exitKanbanSelectMode，本模块额外清空 touched
 */
(function () {
  "use strict";

  // 仅在 web-app.js 已加载且存在选择状态时启用
  if (typeof window._kanbanSelected === "undefined") return;
  if (typeof window.enterKanbanSelectMode !== "function") return;

  // 用户手动勾选/取消过文档后置 true；进入新模式时若为 true 则保留勾选
  var _kanbanUserTouched = false;
  // 用户最近一次手动勾选时所属档案的文档签名；用于检测「加载了新专利」场景：
  // 新专利 renderKanban 会调用 exitKanbanSelectMode，此时若签名不一致，说明
  // _kanbanSelected 中的 idx 已对当前档案失效，必须清空并重置 touched。
  var _lastTouchedDocSig = "";

  function isUserTouched() { return _kanbanUserTouched; }
  function resetTouched() { _kanbanUserTouched = false; }

  // 用文档集合的 docId+docCode+date 拼接签名，唯一标识当前档案的文档集
  function currentDocSig() {
    if (!window.kanbanState || !window.kanbanState.documents || !window.kanbanState.documents.length) return "";
    return window.kanbanState.documents.map(function (d) {
      return (d.docId || "") + "#" + (d.docCode || "") + "#" + (d.date || "");
    }).join("|");
  }

  // ── 覆盖 enterKanbanSelectMode：保留用户勾选，不再无条件重置默认 ──
  // 完整复刻 web-app.js 原实现，仅修改 Pre-select documents 段：
  // 若 _kanbanUserTouched 为 true，则不清空 _kanbanSelected，保留用户勾选；
  // 仅对 mergeExport 过滤掉不可下载项。否则维持原默认规则。
  window.enterKanbanSelectMode = function (mode, options) {
    if (!window.kanbanState || !window.kanbanState.documents || window.kanbanState.documents.length === 0) {
      if (typeof showError === "function") showError("请先查询专利并加载审查文档");
      return;
    }
    var office = window.currentData && window.currentData.office;
    var canAnalyze = office === "US" || office === "EP" || office === "CN" || office === "WO" || office === "KR";
    if (!canAnalyze && mode !== "mergeExport") {
      if (typeof showError === "function") showError("当前国家/地区暂不支持AI梳理");
      return;
    }
    window.exitKanbanSelectMode();
    window._kanbanSelectMode = mode;
    var opts = options || {};
    var board = document.getElementById("kanban-board");
    if (board) board.classList.add("select-mode");
    var selectBar = document.getElementById("kanban-select-bar");
    if (selectBar) selectBar.classList.remove("hidden");
    var modeLabel = document.getElementById("kanban-select-mode-label");
    if (modeLabel) {
      if (mode === "citedRefs") modeLabel.textContent = "选择引用文献文件";
      else if (mode === "mergeExport") modeLabel.textContent = "选择要合并导出的文档";
      else modeLabel.textContent = opts.append ? "追加文件后重新梳理审查意见" : "选择审查意见文件";
    }
    var confirmBtn = document.getElementById("kanban-select-confirm-btn");
    if (confirmBtn) {
      if (mode === "citedRefs") confirmBtn.textContent = "确认并梳理引用文献";
      else if (mode === "mergeExport") confirmBtn.textContent = "确认合并导出";
      else confirmBtn.textContent = opts.append ? "确认追加并重新梳理" : "确认并梳理审查意见";
    }

    var dlBoard = document.getElementById("doclist-board");
    if (dlBoard) dlBoard.classList.add("select-mode");
    var dlSelectBar = document.getElementById("doclist-select-bar");
    if (dlSelectBar) dlSelectBar.classList.remove("hidden");
    var dlModeLabel = document.getElementById("doclist-select-mode-label");
    if (dlModeLabel) {
      if (mode === "citedRefs") dlModeLabel.textContent = "选择引用文献文件";
      else if (mode === "mergeExport") dlModeLabel.textContent = "选择要合并导出的文档";
      else dlModeLabel.textContent = opts.append ? "追加文件后重新梳理审查意见" : "选择审查意见文件";
    }
    var dlConfirmBtn = document.getElementById("doclist-select-confirm-btn");
    if (dlConfirmBtn) {
      if (mode === "citedRefs") dlConfirmBtn.textContent = "确认并梳理引用文献";
      else if (mode === "mergeExport") dlConfirmBtn.textContent = "确认合并导出";
      else dlConfirmBtn.textContent = opts.append ? "确认追加并重新梳理" : "确认并梳理审查意见";
    }

    // Pre-select documents
    // 用户已手动勾选过 → 保留勾选，不重置默认；否则用原默认规则
    if (!isUserTouched()) {
      window._kanbanSelected.clear();
    }
    if (opts.append && opts.preSelectedIdxs && opts.preSelectedIdxs.length > 0) {
      opts.preSelectedIdxs.forEach(function (idx) { window._kanbanSelected.add(idx); });
      _kanbanUserTouched = true;
      _lastTouchedDocSig = currentDocSig();
    } else if (!isUserTouched()) {
      window.kanbanState.documents.forEach(function (it) {
        var shouldSelect = false;
        if (mode === "review") {
          shouldSelect = shouldDefaultSelectForAnalysis(it);
        } else if (mode === "mergeExport") {
          shouldSelect = shouldDefaultSelectForAnalysis(it) && !!buildMergeDownloadUrl(it);
        } else {
          var CITED_DOC_CODES = ["FOR", "892", "1449", "IDS", "SRNT", "SRFW"];
          shouldSelect = CITED_DOC_CODES.indexOf(it.docCode) >= 0;
        }
        if (shouldSelect) window._kanbanSelected.add(it.idx);
      });
    } else if (mode === "mergeExport") {
      // 用户已勾选过，进入合并导出时仅移除不可下载项，其余保留
      var toRemove = [];
      window._kanbanSelected.forEach(function (idx) {
        var it = window.kanbanState.documents.find(function (d) { return d.idx === idx; });
        if (it && !buildMergeDownloadUrl(it)) toRemove.push(idx);
      });
      toRemove.forEach(function (idx) { window._kanbanSelected.delete(idx); });
    }
    window._applyKanbanSelection();
    window._updateKanbanSelectSummary();

    var hintEl = document.getElementById("kanban-select-append-hint");
    var dlHintEl = document.getElementById("doclist-select-append-hint");
    if (opts.append) {
      if (hintEl) { hintEl.textContent = "当前为追加模式：已选中的文件会保留OCR结果，新选择的文件将进行OCR后与原有文件一起重新梳理。"; hintEl.classList.remove("hidden"); }
      if (dlHintEl) { dlHintEl.textContent = "当前为追加模式：已选中的文件会保留OCR结果，新选择的文件将进行OCR后与原有文件一起重新梳理。"; dlHintEl.classList.remove("hidden"); }
    } else if (mode === "mergeExport") {
      if (hintEl) { hintEl.textContent = "合并导出：选择需要合并的文档，按日期倒序排列，每个文档前将插入封面页作为分隔。"; hintEl.classList.remove("hidden"); }
      if (dlHintEl) { dlHintEl.textContent = "合并导出：选择需要合并的文档，按日期倒序排列，每个文档前将插入封面页作为分隔。"; dlHintEl.classList.remove("hidden"); }
    } else {
      if (hintEl) hintEl.classList.add("hidden");
      if (dlHintEl) dlHintEl.classList.add("hidden");
    }
  };

  // ── 覆盖 exitKanbanSelectMode：不清空 _kanbanSelected，让勾选跨模式/跨确认保留 ──
  // 真正的清空由「全不选」「取消」按钮（下方 capture 委托）或加载新专利时处理。
  // 加载新专利时 renderKanban 会重建 kanbanState.documents 后调用本函数；
  // 此时文档签名与用户上次勾选时的签名不一致，说明 _kanbanSelected 中的 idx
  // 已对当前档案失效，必须清空并重置 touched，避免跨档案串用勾选状态。
  window.exitKanbanSelectMode = function () {
    window._kanbanSelectMode = null;
    if (isUserTouched()) {
      var sig = currentDocSig();
      if (sig && _lastTouchedDocSig && sig !== _lastTouchedDocSig) {
        window._kanbanSelected.clear();
        resetTouched();
      }
    }
    var board = document.getElementById("kanban-board");
    if (board) board.classList.remove("select-mode");
    var selectBar = document.getElementById("kanban-select-bar");
    if (selectBar) selectBar.classList.add("hidden");
    var hintEl = document.getElementById("kanban-select-append-hint");
    if (hintEl) hintEl.classList.add("hidden");
    document.querySelectorAll(".kanban-card.selected").forEach(function (c) { c.classList.remove("selected"); });
    var dlBoard = document.getElementById("doclist-board");
    if (dlBoard) dlBoard.classList.remove("select-mode");
    var dlSelectBar = document.getElementById("doclist-select-bar");
    if (dlSelectBar) dlSelectBar.classList.add("hidden");
    var dlHintEl = document.getElementById("doclist-select-append-hint");
    if (dlHintEl) dlHintEl.classList.add("hidden");
    document.querySelectorAll(".doclist-item.selected").forEach(function (c) { c.classList.remove("selected"); });
  };

  // ── 覆盖 _toggleKanbanCard：标记用户已触摸 ──
  window._toggleKanbanCard = function (idx) {
    if (!window._kanbanSelectMode) return;
    if (window._kanbanSelected.has(idx)) {
      window._kanbanSelected.delete(idx);
    } else {
      window._kanbanSelected.add(idx);
    }
    _kanbanUserTouched = true; // 用户手动勾选/取消，后续不再用默认规则重置
    _lastTouchedDocSig = currentDocSig(); // 记录当前档案签名，供加载新专利时比对
    window._applyKanbanSelection();
    window._updateKanbanSelectSummary();
  };

  // ── 选择栏按钮：capture 阶段同步 touched 标志 ──
  // web-app.js 已为这些按钮注册 click 监听（bubble 阶段，会改写 _kanbanSelected）。
  // 本模块在 capture 阶段（先于 bubble）同步 _kanbanUserTouched，使后续切换模式时
  // 能正确判断是否保留用户勾选：
  //   - 「全选」「全不选」：用户显式做出的选择决定 → touched=true，跨模式保留
  //   - 「默认」：用户要求恢复自动默认 → touched=false，下次进入模式时用默认规则
  //   - 「取消」：用户中止选择 → touched=false 且清空 _kanbanSelected
  var SET_TOUCHED_IDS = [
    "kanban-select-all-btn",
    "kanban-select-none-btn",
    "doclist-select-all-btn",
    "doclist-select-none-btn"
  ];
  var RESET_TOUCHED_IDS = [
    "kanban-select-default-btn",
    "kanban-select-cancel-btn",
    "doclist-select-default-btn",
    "doclist-select-cancel-btn"
  ];
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.id) return;
    if (SET_TOUCHED_IDS.indexOf(target.id) >= 0) {
      _kanbanUserTouched = true;
      _lastTouchedDocSig = currentDocSig();
      return;
    }
    if (RESET_TOUCHED_IDS.indexOf(target.id) >= 0) {
      resetTouched();
      // 「取消」按钮还需清空 _kanbanSelected（与原 exitKanbanSelectMode 行为一致）
      if (target.id.indexOf("cancel") >= 0) {
        window._kanbanSelected.clear();
        if (typeof window._applyKanbanSelection === "function") window._applyKanbanSelection();
        if (typeof window._updateKanbanSelectSummary === "function") window._updateKanbanSelectSummary();
      }
    }
  }, true); // capture 阶段，先于 web-app.js 的 bubble 监听执行
})();
