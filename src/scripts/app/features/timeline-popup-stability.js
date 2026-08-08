(function () {
  "use strict";

  // Keep all state local to this patch. The legacy renderer owns the global
  // timeline variables and is intentionally not edited here.
  var state = {
    closeTimer: null,
    refreshFrame: 0,
    openToken: 0,
    pointerActive: false,
    pointerX: 0,
    pointerY: 0,
    pointerInNode: false,
    pointerInPopup: false,
    globalEventsBound: false,
  };

  function getPopupInfo() {
    return typeof _tlOpenPopupInfo === "undefined" ? null : _tlOpenPopupInfo;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  // Pure placement calculation. Keeping this separate makes the edge cases
  // deterministic: a popup must never end up outside the viewport just
  // because its anchor is close to an edge.
  window._tlComputePopupPlacement = function (options) {
    var rect = options.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0 };
    var vw = Math.max(1, Number(options.viewportWidth) || 1);
    var vh = Math.max(1, Number(options.viewportHeight) || 1);
    var margin = Math.max(0, Number(options.margin) || 8);
    var gap = Math.max(0, Number(options.gap) || 8);
    var flipMargin = Math.max(0, Number(options.flipMargin) || 24);
    var minUsable = Math.max(1, Number(options.minUsable) || 90);
    var hardCap = Math.max(1, Number(options.hardCap) || Math.floor(vh * 0.55));
    var popupWidth = Math.max(1, Number(options.popupWidth) || 1);
    var popupHeight = Math.max(1, Number(options.popupHeight) || 1);
    var viewportHeight = Math.max(1, vh - margin * 2);
    var preferredBelow = !!options.preferredBelow;

    var width = Math.min(popupWidth, Math.max(1, vw - margin * 2));
    var centerX = Number(rect.left) + (Number(rect.width) || 0) / 2;
    var left = clamp(centerX - width / 2, margin, vw - margin - width);

    var belowTop = Number(rect.bottom) + gap;
    var belowSpace = Math.max(0, vh - margin - belowTop);
    var aboveSpace = Math.max(0, Number(rect.top) - gap - margin);
    var preferredSpace = preferredBelow ? belowSpace : aboveSpace;
    var alternateSpace = preferredBelow ? aboveSpace : belowSpace;
    var placeBelow = preferredBelow;

    // Flip only when the preferred side is genuinely unusable. The margin
    // prevents a node near the boundary from changing sides on every scroll.
    if (preferredSpace < Math.min(minUsable, popupHeight) && alternateSpace > preferredSpace + flipMargin) {
      placeBelow = !preferredBelow;
    } else if (preferredSpace <= 0 && alternateSpace > 0) {
      placeBelow = !preferredBelow;
    }

    var available = placeBelow ? belowSpace : aboveSpace;
    var otherAvailable = placeBelow ? aboveSpace : belowSpace;
    if (available < Math.min(minUsable, popupHeight) && otherAvailable > available + flipMargin) {
      placeBelow = !placeBelow;
      available = placeBelow ? belowSpace : aboveSpace;
    }

    var maxHeight = Math.min(popupHeight, hardCap, viewportHeight);
    var top;
    if (available >= 1) {
      maxHeight = Math.min(maxHeight, available);
      top = placeBelow ? belowTop : Number(rect.top) - gap - maxHeight;
    } else {
      // Both sides are clipped. Keep the list usable in the viewport instead
      // of assigning a negative/zero height or a top coordinate below it.
      top = margin;
    }

    if (available < Math.min(minUsable, popupHeight) && otherAvailable < Math.min(minUsable, popupHeight)) {
      maxHeight = Math.min(popupHeight, hardCap, viewportHeight);
      top = Number(rect.top) - maxHeight / 2;
    }

    top = clamp(top, margin, vh - margin - maxHeight);
    return {
      left: left,
      top: top,
      width: width,
      maxHeight: Math.max(1, maxHeight),
      placeBelow: placeBelow,
    };
  };

  window._tlClosePopup = function () {
    if (typeof _tlPopupPinned !== "undefined" && _tlPopupPinned) return;

    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = null;
    }
    if (typeof _tlPopupCloseTimer !== "undefined" && _tlPopupCloseTimer) {
      clearTimeout(_tlPopupCloseTimer);
      _tlPopupCloseTimer = null;
    }

    var info = getPopupInfo();
    if (!info) return;

    state.openToken += 1;
    var popup = info.el;
    var home = info.home;
    popup.classList.remove("tl-s-popup-open");
    popup.style.left = "";
    popup.style.top = "";
    popup.style.bottom = "";
    popup.style.width = "";
    popup.style.minWidth = "";
    popup.style.maxWidth = "";
    popup.style.maxHeight = "";
    popup.style.overflowY = "";
    popup.style.boxSizing = "";
    popup.style.visibility = "";
    popup.style.opacity = "";
    popup.style.pointerEvents = "";
    popup.style.transform = "";
    popup.style.animation = "";
    popup.style.willChange = "";

    if (home && home.isConnected) home.appendChild(popup);
    else if (popup.parentNode) popup.parentNode.removeChild(popup);

    _tlOpenPopupInfo = null;
    state.pointerInPopup = false;
  };

  window._tlScheduleClosePopup = function () {
    if (typeof _tlPopupPinned !== "undefined" && _tlPopupPinned) return;
    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.closeTimer = setTimeout(function () {
      state.closeTimer = null;
      if (!state.pointerInNode && !state.pointerInPopup) window._tlClosePopup();
    }, 320);
    if (typeof _tlPopupCloseTimer !== "undefined") _tlPopupCloseTimer = state.closeTimer;
  };

  window._tlPositionPopup = function (popup, node, rect) {
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;
    var margin = 8;
    var hardCap = Math.max(120, Math.floor(vh * 0.65));
    var popupWidth = Math.min(320, Math.max(1, vw - margin * 2));

    popup.style.boxSizing = "border-box";
    popup.style.width = popupWidth + "px";
    popup.style.minWidth = "0";
    popup.style.maxWidth = popupWidth + "px";
    popup.style.maxHeight = hardCap + "px";
    popup.style.overflowY = "auto";
    popup.style.willChange = "left, top";

    // The popup is visible to layout but hidden from the user while measured.
    void popup.offsetWidth;
    var naturalHeight = Math.max(popup.scrollHeight || 0, popup.offsetHeight || 1);
    var placement = window._tlComputePopupPlacement({
      rect: rect,
      viewportWidth: vw,
      viewportHeight: vh,
      popupWidth: popupWidth,
      popupHeight: naturalHeight,
      hardCap: hardCap,
      preferredBelow: node.classList.contains("tl-s-above") || node.classList.contains("tl-s-folded-node"),
    });

    popup.style.maxHeight = placement.maxHeight + "px";
    popup.style.left = placement.left + "px";
    popup.style.top = placement.top + "px";
    popup.style.bottom = "auto";
  };

  window._tlOpenPopupFor = function (node) {
    if (!node) return;
    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = null;
    }
    if (typeof _tlPopupCloseTimer !== "undefined" && _tlPopupCloseTimer) {
      clearTimeout(_tlPopupCloseTimer);
      _tlPopupCloseTimer = null;
    }

    var current = getPopupInfo();
    if (current && current.home === node) return;
    if (current && current.home !== node) _tlPopupPinned = false;
    window._tlClosePopup();

    var popup = node.querySelector(".tl-s-popup");
    if (!popup) return;

    var token = ++state.openToken;
    var rect = node.getBoundingClientRect();
    document.body.appendChild(popup);
    popup.style.animation = "none";
    popup.style.visibility = "hidden";
    popup.style.opacity = "0";
    popup.style.pointerEvents = "none";
    popup.classList.toggle("select-mode", typeof _tlSelectMode !== "undefined" && _tlSelectMode !== null);
    popup.classList.add("tl-s-popup-open");

    // Set the ownership before measuring so scroll/resize handlers cannot see
    // a half-open popup and position a stale one.
    _tlOpenPopupInfo = { el: popup, home: node };
    window._tlPositionPopup(popup, node, rect);
    popup.style.visibility = "visible";
    popup.style.opacity = "1";
    popup.style.pointerEvents = "auto";

    if (node.classList.contains("tl-s-folded-node")) node.style.cursor = "pointer";

    if (!popup._tlStableHoverBound) {
      popup.addEventListener("pointerenter", function () {
        state.pointerInPopup = true;
        if (state.closeTimer) clearTimeout(state.closeTimer);
        state.closeTimer = null;
      });
      popup.addEventListener("pointerleave", function (event) {
        state.pointerInPopup = false;
        if (event.relatedTarget === node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        window._tlScheduleClosePopup();
      });
      popup._tlStableHoverBound = true;
    }

    // A second measurement is allowed only after the hidden first layout. It
    // corrects font loading/layout changes without exposing an intermediate
    // coordinate to the user.
    requestAnimationFrame(function () {
      if (token !== state.openToken) return;
      var info = getPopupInfo();
      if (!info || info.el !== popup || info.home !== node) return;
      window._tlPositionPopup(popup, node, node.getBoundingClientRect());
    });
  };

  function isInsidePopup(target) {
    var info = getPopupInfo();
    return !!(info && info.el && target && info.el.contains(target));
  }

  function nodeAtPointer() {
    if (!state.pointerActive || !document.elementFromPoint) return null;
    var target = document.elementFromPoint(state.pointerX, state.pointerY);
    return target && target.closest ? target.closest(".tl-s-node") : null;
  }

  function refreshPopupPosition() {
    state.refreshFrame = 0;
    var info = getPopupInfo();
    if (!info || !info.el || !info.home || !info.home.isConnected) return;

    var rect = info.home.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;
    var visible = rect.right > 0 && rect.left < vw && rect.bottom > 0 && rect.top < vh;
    if (visible) {
      window._tlPositionPopup(info.el, info.home, rect);
      return;
    }

    // Do not leave a stale popup at the previous screen coordinate. If the
    // pointer is now over another node after scrolling, reopen it immediately.
    _tlPopupPinned = false;
    window._tlClosePopup();
    var node = nodeAtPointer();
    if (node) {
      state.pointerInNode = true;
      window._tlOpenPopupFor(node);
    }
  }

  function schedulePopupRefresh() {
    if (state.refreshFrame) return;
    state.refreshFrame = requestAnimationFrame(refreshPopupPosition);
  }

  function onPointerMove(event) {
    state.pointerActive = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;

    if (isInsidePopup(event.target)) {
      state.pointerInPopup = true;
      state.pointerInNode = false;
      if (state.closeTimer) clearTimeout(state.closeTimer);
      state.closeTimer = null;
      return;
    }

    var node = event.target && event.target.closest ? event.target.closest(".tl-s-node") : null;
    if (node) {
      state.pointerInNode = true;
      state.pointerInPopup = false;
      if (!(typeof _tlPopupPinned !== "undefined" && _tlPopupPinned)) window._tlOpenPopupFor(node);
      return;
    }

    state.pointerInNode = false;
    state.pointerInPopup = false;
    window._tlScheduleClosePopup();
  }

  function bindGlobalEvents() {
    if (state.globalEventsBound) return;
    state.globalEventsBound = true;

    document.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("scroll", schedulePopupRefresh, { passive: true, capture: true });
    window.addEventListener("resize", schedulePopupRefresh, { passive: true });
  }

  window._bindTimelineHoverPopups = function (board) {
    if (!board) return;
    _tlPopupPinned = false;
    window._tlClosePopup();
    bindGlobalEvents();

    board.querySelectorAll(".tl-s-node").forEach(function (node) {
      node.addEventListener("pointerenter", function () {
        state.pointerInNode = true;
        state.pointerInPopup = false;
        if (!(typeof _tlPopupPinned !== "undefined" && _tlPopupPinned)) window._tlOpenPopupFor(node);
      });
      node.addEventListener("pointerleave", function (event) {
        state.pointerInNode = false;
        var info = getPopupInfo();
        if (info && event.relatedTarget && info.el.contains(event.relatedTarget)) {
          state.pointerInPopup = true;
          return;
        }
        window._tlScheduleClosePopup();
      });

      if (node.classList.contains("tl-s-folded-node")) {
        var clickTarget = node.querySelector(".tl-s-dot-mini") || node;
        clickTarget.addEventListener("click", function (event) {
          if (getPopupInfo() && getPopupInfo().el.contains(event.target)) return;
          event.stopPropagation();
          if (getPopupInfo() && getPopupInfo().home === node && _tlPopupPinned) {
            _tlPopupPinned = false;
            window._tlClosePopup();
          } else {
            _tlPopupPinned = true;
            window._tlOpenPopupFor(node);
          }
        });
      }
    });

    var scroll = board.querySelector(".tl-s-scroll");
    if (scroll && !scroll._tlStableScrollBound) {
      scroll.addEventListener("scroll", schedulePopupRefresh, { passive: true });
      scroll._tlStableScrollBound = true;
    }
  };
})();
