/*!
 * PatentLens - 三态缓存选择弹窗
 *
 * 替代原生 confirm 的“使用缓存 / 重新加载”二选一：
 *  - 右上角 X、取消、Esc、点击遮罩都表示取消；
 *  - 取消后不再继续执行查询；
 *  - 同时为历史记录中的 GP 原文入口提供同样的选择体验。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var DIALOG_ID = "pl-cache-choice-dialog";
  var _resolver = null;
  var _dialog = null;
  var _message = null;

  function buildDialog() {
    if (_dialog) return;
    _dialog = document.createElement("div");
    _dialog.id = DIALOG_ID;
    _dialog.className = "cache-confirm-dialog hidden";
    _dialog.innerHTML =
      '<div class="cache-confirm-overlay"></div>' +
      '<div class="cache-confirm-box" style="position:relative;">' +
      '  <button type="button" class="pl-cache-choice-close" aria-label="关闭">&times;</button>' +
      '  <div class="cache-confirm-title">发现本地缓存</div>' +
      '  <div class="cache-confirm-message"></div>' +
      '  <div class="cache-confirm-actions">' +
      '    <button type="button" class="btn-primary" data-cache-choice="cache">使用缓存</button>' +
      '    <button type="button" class="btn-secondary" data-cache-choice="reload">重新加载</button>' +
      '    <button type="button" class="btn-secondary" data-cache-choice="cancel">取消</button>' +
      '  </div>' +
      "</div>";
    document.body.appendChild(_dialog);
    _message = _dialog.querySelector(".cache-confirm-message");

    _dialog.querySelector(".cache-confirm-overlay").addEventListener("click", function () { finish("cancel"); });
    _dialog.querySelector(".pl-cache-choice-close").addEventListener("click", function () { finish("cancel"); });
    _dialog.querySelectorAll("[data-cache-choice]").forEach(function (button) {
      button.addEventListener("click", function () { finish(button.dataset.cacheChoice); });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && _resolver) finish("cancel");
    }, true);
  }

  function finish(choice) {
    if (_dialog) _dialog.classList.add("hidden");
    var resolver = _resolver;
    _resolver = null;
    if (resolver) resolver(choice);
  }

  function ask(cacheAge) {
    buildDialog();
    if (_resolver) finish("cancel");
    _message.textContent = "发现本地缓存" + (cacheAge ? "（" + cacheAge + "保存）" : "") +
      "。\n\n使用缓存可快速恢复；重新加载将从网络获取最新数据。";
    _dialog.classList.remove("hidden");
    return new Promise(function (resolve) {
      _resolver = resolve;
    });
  }

  function isCacheChoiceCancelled() {
    return !!window.__plCacheChoiceCancelled;
  }

  // 覆盖全局 _promptCacheChoice（web-app.js 中搜索按钮使用）
  function installPromptOverride() {
    if (typeof window._promptCacheChoice !== "function") return;
    window._promptCacheChoice = async function (cacheKey) {
      // 每次新的查询先清除上一次的取消标记，避免残留标记误伤后续查询
      window.__plCacheChoiceCancelled = false;
      var meta = null;
      try {
        if (typeof PatentCache !== "undefined") meta = PatentCache.get(cacheKey);
      } catch (_) {}
      if (!meta) return { choice: "none", entry: null };

      var entry = null;
      try {
        if (typeof PatentCache !== "undefined") entry = await PatentCache.getFullAsync(cacheKey);
      } catch (_) {}
      if (!entry || !entry.kanbanState) return { choice: "none", entry: null };

      var age = "";
      try {
        if (entry.timestamp && typeof timeAgo === "function") age = timeAgo(entry.timestamp);
      } catch (_) {}

      var choice = await ask(age);
      if (choice === "cancel") {
        window.__plCacheChoiceCancelled = true;
        return { choice: "cancel", entry: null };
      }
      window.__plCacheChoiceCancelled = false;
      return {
        choice: choice === "cache" ? "cache" : "reload",
        entry: choice === "cache" ? entry : null,
      };
    };
  }

  // 取消标记：让搜索流程在调用 _dossierNewTabFromSearch 时直接中止
  function installNewTabOverride() {
    if (typeof window._dossierNewTabFromSearch !== "function" || window._dossierNewTabFromSearch.__plCacheCancelWrapped) return;
    var original = window._dossierNewTabFromSearch;
    var wrapped = function () {
      if (isCacheChoiceCancelled()) {
        window.__plCacheChoiceCancelled = false;
        return false;
      }
      return original.apply(this, arguments);
    };
    wrapped.__plCacheCancelWrapped = true;
    window._dossierNewTabFromSearch = wrapped;
  }

  function setPatentMode(patentNumber) {
    try { searchMode = "patent"; } catch (_) {}
    document.querySelectorAll(".search-mode-btn").forEach(function (button) {
      button.classList.toggle("active", button.dataset.mode === "patent");
    });
    var input = document.getElementById("patent-input");
    if (input) {
      input.style.display = "";
      input.value = patentNumber;
    }
    var searchButton = document.getElementById("search-btn");
    if (searchButton) searchButton.style.display = "";
    var batchToggle = document.getElementById("batch-search-toggle-btn");
    if (batchToggle) batchToggle.style.display = "";
  }

  function runPatentSearchWithConfirm(choice) {
    var originalConfirm = window.confirm;
    window.confirm = function () { return choice === "cache"; };
    try {
      var searchButton = document.getElementById("search-btn");
      if (searchButton) searchButton.click();
    } finally {
      window.confirm = originalConfirm;
    }
  }

  function hasGpCache(raw) {
    try {
      var mem = typeof _pdPatentCache !== "undefined" ? _pdPatentCache[raw] : null;
      var entry = typeof GPCache !== "undefined" ? GPCache.getEntry(raw) : null;
      return !!(mem || (entry && entry.data));
    } catch (_) {
      return false;
    }
  }

  function gpCacheAge(raw) {
    try {
      var entry = typeof GPCache !== "undefined" ? GPCache.getEntry(raw) : null;
      if (entry && entry.timestamp && typeof timeAgo === "function") return timeAgo(entry.timestamp);
    } catch (_) {}
    return "";
  }

  function isPatentAlreadyOpen(raw) {
    try {
      return typeof _pdOpenPatents !== "undefined" && _pdOpenPatents.indexOf(raw) >= 0;
    } catch (_) {
      return false;
    }
  }

  async function openGpOriginal(patentNumber) {
    var raw = String(patentNumber || "").trim().toUpperCase().replace(/[\s\/]/g, "");
    if (!raw) return;
    var cached = hasGpCache(raw);
    if (cached && !isPatentAlreadyOpen(raw)) {
      var choice = await ask(gpCacheAge(raw));
      if (choice === "cancel") return;
      setPatentMode(raw);
      runPatentSearchWithConfirm(choice);
      return;
    }
    setPatentMode(raw);
    // 已打开或没有缓存时不弹缓存选择；已打开时用缓存直接切换标签
    runPatentSearchWithConfirm(cached ? "cache" : "reload");
  }

  // 拦截历史记录中 GP 原文条目的默认点击，避免原生 confirm 关闭后仍继续查询
  function installHistoryClick() {
    var list = document.getElementById("history-list");
    if (!list || list.dataset.plCacheChoiceObserved) return;
    list.dataset.plCacheChoiceObserved = "1";
    list.addEventListener("click", function (event) {
      if (list.classList.contains("select-mode")) return;
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest(".history-item-alt-btn, .history-item-delete-btn, .cache-delete-btn, .history-item-checkbox")) return;
      var item = target.closest(".history-item");
      if (!item || item.classList.contains("select-mode")) return;
      if (item.dataset.type !== "patent") return;
      if (item.dataset.source === "jplatpat") return;
      var pn = item.dataset.patent;
      if (!pn) return;
      var raw = pn.trim().toUpperCase().replace(/[\s\/]/g, "");
      if (!hasGpCache(raw)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openGpOriginal(pn);
    }, true);
  }

  function init() {
    buildDialog();
    installPromptOverride();
    installNewTabOverride();
    installHistoryClick();
  }

  window.PatentLensCacheChoice = { ask: ask };
  window.PatentLensOpenGp = { open: openGpOriginal };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
