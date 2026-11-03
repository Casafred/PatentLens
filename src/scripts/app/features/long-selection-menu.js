/*!
 * PatentLens - 长文本选区翻译菜单
 *
 * legacy 全局选区菜单在文本长度 >= 2000 时直接隐藏悬浮按钮和右键菜单。
 * 本模块在捕获阶段接管超长选区，复用同一套翻译/复制能力，避免大段文本无法操作。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var LEGACY_TEXT_LIMIT = 2000;
  var BTN_ID = "pl-long-selection-btn";
  var MENU_ID = "pl-long-selection-menu";
  var _btn = null;
  var _menu = null;

  function icon(name, size) {
    try {
      if (typeof window.icon === "function") return window.icon(name, size);
    } catch (_) {}
    return "";
  }

  function selectedText() {
    try {
      var selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return "";
      return String(selection.toString() || "").trim();
    } catch (_) {
      return "";
    }
  }

  function isLargeSelection(text) {
    return String(text || "").length >= LEGACY_TEXT_LIMIT;
  }

  function hideOwn() {
    if (_btn && _btn.parentNode) _btn.parentNode.removeChild(_btn);
    _btn = null;
    if (_menu && _menu.parentNode) _menu.parentNode.removeChild(_menu);
    _menu = null;
  }

  function isInOwnUi(target) {
    if (!target) return false;
    if (_btn && _btn.contains(target)) return true;
    if (_menu && _menu.contains(target)) return true;
    return false;
  }

  function copyText(text) {
    try {
      if (typeof window.copyTextToClipboard === "function") {
        return window.copyTextToClipboard(text);
      }
    } catch (_) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.resolve();
  }

  function clearSelection() {
    try { window.getSelection().removeAllRanges(); } catch (_) {}
  }

  function hasAiTranslation() {
    try {
      if (!window.AI || typeof window.AI.loadAIConfig !== "function") return false;
      var config = window.AI.loadAIConfig();
      var provider = window.AI.getTranslateProvider(config);
      return !!(provider && provider.apiKey);
    } catch (_) {
      return false;
    }
  }

  function showButton(x, y, text) {
    hideOwn();
    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.innerHTML = icon("type") || "译";
    btn.title = "翻译/复制选中文本";
    btn.style.cssText = "position:fixed;z-index:100030;background:var(--accent,#22c55e);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-family:inherit;display:flex;align-items:center;justify-content:center;";
    btn.style.left = Math.min(Math.max(x, 5), window.innerWidth - 40) + "px";
    btn.style.top = Math.max(5, Math.min(y, window.innerHeight - 40)) + "px";
    btn.addEventListener("mousedown", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var rect = btn.getBoundingClientRect();
      showMenu(rect.left, rect.bottom + 4, text);
    });
    document.body.appendChild(btn);
    _btn = btn;
  }

  function showMenu(x, y, text) {
    hideOwn();
    var menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "text-selection-context-menu pl-long-selection-menu";
    menu.style.cssText = "position:fixed;z-index:100031;background:var(--bg-card,#fff);color:var(--text-primary,#333);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);border:1px solid var(--border,#e0e0e0);padding:4px 0;min-width:160px;font-size:13px;";
    menu.style.left = Math.min(x, window.innerWidth - 190) + "px";
    menu.style.top = Math.max(10, Math.min(y, window.innerHeight - 190)) + "px";

    var hoverBg = "var(--bg-hover,#f0fdf4)";
    var items = [
      { label: icon("copy") + " 复制", action: function () { copyText(text); clearSelection(); } },
      { label: icon("bot") + " AI 翻译", action: function () { clearSelection(); if (typeof window.showFloatingTranslation === "function") window.showFloatingTranslation(text, x, y + 8, "ai"); }, disabled: !hasAiTranslation() },
      { label: icon("globe") + " Google 翻译", action: function () { clearSelection(); if (typeof window.showFloatingTranslation === "function") window.showFloatingTranslation(text, x, y + 8, "google"); } },
      { label: icon("external") + " 打开 Google 翻译", action: function () { if (typeof window.openInGoogleTranslate === "function") window.openInGoogleTranslate(text); } },
    ];

    items.forEach(function (item) {
      var row = document.createElement("div");
      row.innerHTML = item.label;
      row.style.cssText = "padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:6px;" + (item.disabled ? "opacity:0.5;cursor:not-allowed;" : "");
      if (!item.disabled) {
        row.addEventListener("mouseenter", function () { row.style.background = hoverBg; });
        row.addEventListener("mouseleave", function () { row.style.background = "transparent"; });
        row.addEventListener("click", function (event) {
          event.stopPropagation();
          hideOwn();
          try { item.action(); } catch (_) {}
        });
      }
      menu.appendChild(row);
    });

    document.body.appendChild(menu);
    _menu = menu;
  }

  function onMouseUp(event) {
    if (event.button === 2) return;
    if (isInOwnUi(event.target)) return;
    if (event.target && event.target.closest && event.target.closest("input, textarea, select, [contenteditable='true']")) {
      hideOwn();
      return;
    }
    var text = selectedText();
    if (!isLargeSelection(text)) {
      hideOwn();
      return;
    }
    showButton(Math.min(event.clientX + 12, window.innerWidth - 40), event.clientY - 40, text);
  }

  function onContextMenu(event) {
    if (event.target && event.target.closest && event.target.closest("input, textarea, select, button")) return;
    if (event.target && event.target.closest && event.target.closest("[contenteditable='true']")) return;
    if (isInOwnUi(event.target)) return;
    var text = selectedText();
    if (!isLargeSelection(text)) {
      hideOwn();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showMenu(event.clientX, event.clientY + 4, text);
  }

  function onMouseDown(event) {
    if (isInOwnUi(event.target)) return;
    hideOwn();
  }

  function onScroll() {
    hideOwn();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") hideOwn();
  }

  function init() {
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  window.PatentLensLongSelectionMenu = {
    isLargeSelection: isLargeSelection,
    hide: hideOwn,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
