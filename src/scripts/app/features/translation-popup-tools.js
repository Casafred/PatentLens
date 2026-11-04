/*!
 * PatentLens - 翻译浮窗拖拽与缩放
 *
 * web-app.js 中的翻译浮窗（#generic-translation-popup / #pd-selected-translation-popup）
 * 使用固定内联样式创建，位置固定且不可调整。本模块在浮窗出现后增强：
 *  - 顶部工具条可按住拖动，位置限制在视口内；
 *  - 右下角可拖拽改变窗口大小（min 280x160，max 90vw/90vh）；
 *  - 内容区不再被旧的 max-height 限制，随窗口高度伸缩。
 *
 * web-app.js 已冻结，本模块通过 MutationObserver 和运行时样式增强，不修改 legacy 代码。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var POPUP_IDS = ["generic-translation-popup", "pd-selected-translation-popup"];
  var MIN_WIDTH = 280;
  var MIN_HEIGHT = 160;
  var VIEWPORT_MARGIN = 4;

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function startDrag(popup, header, event) {
    if (event.button !== 0) return;
    var target = event.target;
    if (target && target.closest &&
        target.closest("button, input, select, textarea, a, [contenteditable='true']")) {
      return;
    }

    var rect = popup.getBoundingClientRect();
    var startX = event.clientX;
    var startY = event.clientY;
    var startLeft = rect.left;
    var startTop = rect.top;

    popup.style.left = startLeft + "px";
    popup.style.top = startTop + "px";
    popup.style.right = "auto";
    popup.style.bottom = "auto";
    header.style.cursor = "grabbing";

    function onMove(moveEvent) {
      var width = popup.offsetWidth;
      var height = popup.offsetHeight;
      var left = clamp(
        startLeft + moveEvent.clientX - startX,
        VIEWPORT_MARGIN,
        window.innerWidth - width - VIEWPORT_MARGIN
      );
      var top = clamp(
        startTop + moveEvent.clientY - startY,
        VIEWPORT_MARGIN,
        window.innerHeight - height - VIEWPORT_MARGIN
      );
      popup.style.left = left + "px";
      popup.style.top = top + "px";
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      header.style.cursor = "move";
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    event.preventDefault();
    event.stopPropagation();
  }

  function enhance(popup) {
    if (!popup || popup.nodeType !== 1 || popup.dataset.plTranslationTools) return;
    popup.dataset.plTranslationTools = "1";

    popup.style.resize = "both";
    popup.style.overflow = "hidden";
    popup.style.minWidth = MIN_WIDTH + "px";
    popup.style.minHeight = MIN_HEIGHT + "px";
    popup.style.maxWidth = "90vw";
    popup.style.maxHeight = "90vh";
    popup.style.boxSizing = "border-box";

    var body = popup.querySelector("#" + popup.id + "-body");
    if (body) {
      body.style.maxHeight = "none";
      body.style.height = "auto";
      body.style.flex = "1 1 auto";
      body.style.minHeight = "0";
      body.style.overflowY = "auto";
    }

    var header = popup.firstElementChild;
    if (header && header !== body && !header.dataset.plTranslationHeader) {
      header.dataset.plTranslationHeader = "1";
      header.style.cursor = "move";
      header.style.userSelect = "none";
      header.addEventListener("mousedown", function (event) {
        startDrag(popup, header, event);
      });
    }
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (POPUP_IDS.indexOf(node.id) !== -1) {
      enhance(node);
      return;
    }
    if (typeof node.querySelectorAll !== "function") return;
    var found = node.querySelectorAll("#generic-translation-popup, #pd-selected-translation-popup");
    for (var i = 0; i < found.length; i++) enhance(found[i]);
  }

  function init() {
    POPUP_IDS.forEach(function (id) {
      var popup = document.getElementById(id);
      if (popup) enhance(popup);
    });
    if (typeof MutationObserver !== "function" || !document.body) return;
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        for (var i = 0; i < mutation.addedNodes.length; i++) scan(mutation.addedNodes[i]);
      });
    }).observe(document.body, { childList: true });
  }

  window.PatentLensTranslationPopupTools = { enhance: enhance };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
