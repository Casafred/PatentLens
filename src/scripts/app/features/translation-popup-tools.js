/*!
 * PatentLens - 翻译浮窗拖拽与缩放
 *
 * web-app.js 中的翻译浮窗（#generic-translation-popup / #pd-selected-translation-popup）
 * 使用固定内联样式创建，位置固定且不可调整。本模块在浮窗出现后增强：
 *  - 顶部工具条可按住拖动，位置限制在视口内；
 *  - 右下角有独立的缩放手柄（不再使用浏览器原生 resize，避免拖动时误改宽度）；
 *  - 固定初始宽度，避免译文流式输出时自动撑宽浮窗，使拖动时宽度保持稳定；
 *  - 内容区随窗口高度伸缩，长文可滚动。
 *
 * web-app.js 已冻结，本模块通过 MutationObserver 和运行时样式增强，不修改 legacy 代码。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var POPUP_IDS = ["generic-translation-popup", "pd-selected-translation-popup"];
  var MIN_WIDTH = 280;
  var MIN_HEIGHT = 160;
  var DEFAULT_WIDTH = 440;
  var VIEWPORT_MARGIN = 4;
  var GRIP_SIZE = 16;

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function viewportWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 800;
  }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 600;
  }

  function startResize(popup, event) {
    if (event.button !== 0) return;
    var rect = popup.getBoundingClientRect();
    var startX = event.clientX;
    var startY = event.clientY;
    var startWidth = rect.width;
    var startHeight = rect.height;
    var startLeft = rect.left;
    var startTop = rect.top;

    function onMove(moveEvent) {
      var maxWidth = Math.min(viewportWidth() * 0.9, viewportWidth() - VIEWPORT_MARGIN * 2);
      var maxHeight = viewportHeight() * 0.9;
      var width = clamp(startWidth + moveEvent.clientX - startX, MIN_WIDTH, maxWidth);
      var height = clamp(startHeight + moveEvent.clientY - startY, MIN_HEIGHT, maxHeight);
      popup.style.width = width + "px";
      popup.style.height = height + "px";
      var left = startLeft;
      // 变宽后若右边缘超出视口，则整体向左收，避免被窗口右边界裁切
      if (left + width > viewportWidth() - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, viewportWidth() - width - VIEWPORT_MARGIN);
      }
      popup.style.left = left + "px";
      popup.style.top = clamp(startTop, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight() - height - VIEWPORT_MARGIN)) + "px";
      popup.style.right = "auto";
      popup.style.bottom = "auto";
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    event.preventDefault();
    event.stopPropagation();
  }

  function ensureResizeGrip(popup) {
    if (!popup || popup.querySelector(".pl-translation-resize-grip")) return;
    var grip = document.createElement("div");
    grip.className = "pl-translation-resize-grip";
    grip.title = "拖动调整窗口大小";
    grip.style.cssText =
      "position:absolute;right:0;bottom:0;width:" + GRIP_SIZE + "px;height:" + GRIP_SIZE + "px;" +
      "cursor:nwse-resize;z-index:20;border-bottom-right-radius:8px;" +
      "background:" +
      "linear-gradient(135deg,transparent 0 46%,rgba(0,0,0,0.28) 46% 54%,transparent 54% 66%," +
      "rgba(0,0,0,0.28) 66% 74%,transparent 74%);";
    grip.addEventListener("mousedown", function (event) {
      startResize(popup, event);
    });
    popup.appendChild(grip);
  }

  function startDrag(popup, header, event) {
    if (event.button !== 0) return;
    var target = event.target;
    if (target && target.closest &&
        target.closest("button, input, select, textarea, a, [contenteditable='true'], .pl-translation-resize-grip")) {
      return;
    }

    var rect = popup.getBoundingClientRect();
    var startX = event.clientX;
    var startY = event.clientY;
    var startLeft = rect.left;
    var startTop = rect.top;
    var dragWidth = rect.width;
    var dragHeight = rect.height;

    // 锁定当前宽度，避免译文流式输出改变内容尺寸、让拖动看起来像在改宽度
    popup.style.width = dragWidth + "px";
    popup.style.left = startLeft + "px";
    popup.style.top = startTop + "px";
    popup.style.right = "auto";
    popup.style.bottom = "auto";
    header.style.cursor = "grabbing";

    function onMove(moveEvent) {
      var left = clamp(
        startLeft + moveEvent.clientX - startX,
        VIEWPORT_MARGIN,
        viewportWidth() - dragWidth - VIEWPORT_MARGIN
      );
      var top = clamp(
        startTop + moveEvent.clientY - startY,
        VIEWPORT_MARGIN,
        viewportHeight() - dragHeight - VIEWPORT_MARGIN
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

    var targetWidth = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, viewportWidth() - 24));
    popup.style.width = targetWidth + "px";
    popup.style.resize = "none";
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

    ensureResizeGrip(popup);

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
