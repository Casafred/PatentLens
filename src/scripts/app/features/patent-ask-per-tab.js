/*!
 * PatentLens - AI 问一问按专利号隔离会话
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260903
 *
 * web-app.js 已冻结不可新增行，本模块通过覆盖函数声明实现
 * 「AI 问一问」的会话与缓存严格按专利号隔离：
 *
 *   1. 会话归属跟踪：openPatentAsk 打开时记录本次会话所属专利号
 *      （_sessionPn），此后所有保存都以该键写入 localStorage，修复
 *      「弹窗内切换专利标签后再关闭 → 对话被写进新专利缓存键」的错位。
 *   2. 覆盖 _savePatentAskCache：流式完成/关闭窗口时的持久化改按
 *      _sessionPn 落盘（web-app.js 内部调用经 window 名字解析，覆盖生效）。
 *   3. 弹窗活动专利切换联动：监听 #ppv-patent-number 文本变化
 *      （switchPpvPatent / openPatentPopup / closePpvPatentTab 自动切换
 *      均会更新该节点），若问一问窗口处于打开状态且来源为 popup：
 *      - 先把当前对话保存到原专利号的缓存键；
 *      - 立即切换为新专利号的独立会话（读取其缓存并重渲染）；
 *      - 若正处于流式回答中则延迟到回答结束后再切换，避免旧专利的
 *        回答被追加进新专利的会话数组。
 *   4. 覆盖 clearPatentAsk：清空时同步删除会话所属专利号的缓存键
 *      （原实现按"当前数据源"删除，切换标签后会删错键）。
 *
 * 依赖（web-app.js 暴露的全局，经典脚本未用 IIFE 包裹）：
 *   - 函数声明（挂 window，可用 window.xxx = 覆盖）：
 *     openPatentAsk / _savePatentAskCache / clearPatentAsk /
 *     _loadPatentAskCache / _renderPatentAskMessages
 *   - 顶层 let/const（不挂 window，只能通过作用域链以直接名字访问）：
 *     _patentAskSource / _patentAskMessages / _patentAskStreaming /
 *     _PATENT_ASK_CACHE_PREFIX
 */
(function () {
  "use strict";

  // ── 守卫：web-app.js 必须已加载 ──
  if (typeof openPatentAsk !== "function") return;
  if (typeof _patentAskMessages === "undefined") return;

  var PREFIX = (typeof _PATENT_ASK_CACHE_PREFIX !== "undefined")
    ? _PATENT_ASK_CACHE_PREFIX
    : "patentlens_ask_";

  var _sessionPn = "";     // 当前内存对话所属专利号
  var _pendingSwapPn = ""; // 流式回答中切换了标签：回答结束后要切换到的专利号

  function modalEl() { return document.getElementById("patent-ask-modal"); }

  function modalOpen() {
    var m = modalEl();
    return !!m && !m.classList.contains("hidden");
  }

  function sourceIsPopup() {
    try { return _patentAskSource === "popup"; } catch (e) { return false; }
  }

  function isStreaming() {
    try { return _patentAskStreaming === true; } catch (e) { return false; }
  }

  function dataSourcePn(source) {
    try {
      var data = source === "popup" ? window._patentPopupData : window._currentPatentData;
      return data && data.patent_number ? String(data.patent_number) : "";
    } catch (e) { return ""; }
  }

  function saveSession(pn, msgs) {
    if (!pn || !msgs) return;
    try {
      localStorage.setItem(PREFIX + pn, JSON.stringify({
        messages: msgs,
        ts: Date.now(),
      }));
    } catch (e) { /* 忽略配额错误 */ }
  }

  function setHeaderPn(pn) {
    var el = document.getElementById("patent-ask-pn");
    if (el) el.textContent = pn || "";
  }

  // 切换为指定专利号的独立会话：读缓存、重渲染、更新头部专利号
  function swapToPn(pn) {
    var cached = null;
    try {
      if (typeof _loadPatentAskCache === "function") cached = _loadPatentAskCache(pn);
    } catch (e) { cached = null; }
    _patentAskMessages = cached ? cached.slice() : [];
    _sessionPn = pn || "";
    setHeaderPn(_sessionPn);
    try {
      if (typeof _renderPatentAskMessages === "function") _renderPatentAskMessages();
    } catch (e) {}
  }

  // ══ 1. openPatentAsk：记录会话归属 ═══════════════════════

  var _origOpen = window.openPatentAsk;
  window.openPatentAsk = function (source) {
    _sessionPn = dataSourcePn(source || "detail");
    _pendingSwapPn = "";
    return _origOpen(source);
  };

  // ══ 2. _savePatentAskCache：按会话专利号保存 ═════════════

  var _origSave = window._savePatentAskCache;
  window._savePatentAskCache = function () {
    if (_sessionPn) {
      saveSession(_sessionPn, _patentAskMessages);
      return;
    }
    return _origSave();
  };

  // ══ 3. clearPatentAsk：清除会话专利号的缓存 ══════════════

  var _origClear = window.clearPatentAsk;
  window.clearPatentAsk = function () {
    var pn = _sessionPn;
    var r = _origClear();
    if (pn) {
      try { localStorage.removeItem(PREFIX + pn); } catch (e) {}
    }
    return r;
  };

  // ══ 4. 弹窗活动专利切换联动 ══════════════════════════════
  // #ppv-patent-number 由 openPatentPopup / switchPpvPatent /
  // closePpvPatentTab（自动切换）统一更新，监听它即可覆盖全部路径

  function onActivePopupPnChanged(newPn) {
    if (!modalOpen() || !sourceIsPopup()) return;
    if (!newPn || newPn === _sessionPn) return;
    // 旧会话先落盘到它自己的缓存键
    if (_sessionPn) saveSession(_sessionPn, _patentAskMessages);
    if (isStreaming()) {
      // 流式回答中：回答仍属于旧专利，延迟到回答结束后切换
      _pendingSwapPn = newPn;
      return;
    }
    swapToPn(newPn);
  }

  (function setupPopupPnObserver() {
    var pnEl = document.getElementById("ppv-patent-number");
    if (!pnEl || typeof MutationObserver !== "function") return;
    new MutationObserver(function () {
      try {
        onActivePopupPnChanged((pnEl.textContent || "").trim());
      } catch (e) {
        console.warn("[PatentAskPerTab] swap on popup pn change failed:", e);
      }
    }).observe(pnEl, { childList: true, characterData: true, subtree: true });
  })();

  // 流式回答结束后执行延迟的会话切换
  (function setupStreamEndObserver() {
    var sendBtn = document.getElementById("patent-ask-send-btn");
    if (!sendBtn || typeof MutationObserver !== "function") return;
    new MutationObserver(function () {
      if (sendBtn.disabled || !_pendingSwapPn) return;
      var pn = _pendingSwapPn;
      _pendingSwapPn = "";
      if (!modalOpen() || !sourceIsPopup() || pn === _sessionPn) return;
      try { swapToPn(pn); } catch (e) {}
    }).observe(sendBtn, { attributes: true, attributeFilter: ["disabled"] });
  })();
})();
