/*!
 * PatentLens - 审查文档搜索定位
 *
 * 在「审查时间轴」和「审查文档列表」两个界面提供关键词搜索：
 *  - 输入关键词后自动统计匹配文档并定位到第一个；
 *  - 「上一个 / 下一个」循环跳转；
 *  - 时间轴会自动展开折叠节点并在弹层中高亮目标文档；
 *  - 文档列表直接滚动并高亮目标条带。
 *
 * web-app.js 已冻结，本模块只消费其渲染出的 DOM 与全局状态，不新增 legacy 代码。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var HIT_CLASS = "doc-search-hit";

  var states = {
    tl: { matches: [], pos: -1, keyword: "" },
    doclist: { matches: [], pos: -1, keyword: "" },
  };

  function getDocuments() {
    try {
      if (typeof kanbanState !== "undefined" && kanbanState && Array.isArray(kanbanState.documents)) {
        return kanbanState.documents;
      }
    } catch (_) {}
    return [];
  }

  function dateValue(item) {
    try {
      if (typeof parseDate === "function") return parseDate(item && item.date) || 0;
    } catch (_) {}
    return 0;
  }

  function sortedDocuments() {
    return getDocuments().slice().sort(function (a, b) {
      return dateValue(b) - dateValue(a);
    });
  }

  function documentSearchText(item) {
    if (!item) return "";
    return [
      item.name,
      item.desc,
      item.docCode,
      item.date,
      item.stage,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function findMatches(keyword) {
    var query = String(keyword || "").trim().toLowerCase();
    if (!query) return [];
    return sortedDocuments().filter(function (item) {
      return documentSearchText(item).indexOf(query) !== -1;
    });
  }

  function labelFor(item) {
    if (!item) return "";
    var name = item.name || item.desc || item.docCode || "";
    var code = item.docCode ? " [" + item.docCode + "]" : "";
    return name + code;
  }

  function updateInfo(state, boxId, text) {
    var box = document.getElementById(boxId);
    if (box) box.textContent = text;
  }

  function clearHits() {
    document.querySelectorAll("." + HIT_CLASS).forEach(function (el) {
      el.classList.remove(HIT_CLASS);
    });
  }

  function scrollIntoViewSafe(el) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    try {
      // 即时滚动，避免长时间 smooth 动画占用主线程、让输入框感觉被卡住
      el.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    } catch (_) {
      el.scrollIntoView();
    }
  }

  function defer(fn) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  }

  // ── 时间轴 ────────────────────────────────────────────────────────────────

  function closeTimelinePopupIfOpen() {
    try {
      if (typeof _tlPopupPinned !== "undefined") _tlPopupPinned = false;
      if (typeof _tlClosePopup === "function") _tlClosePopup();
    } catch (_) {}
  }

  function revealTimelineDocument(idx) {
    var board = document.getElementById("tl-board") || document.getElementById("timeline-board");
    if (!board) return false;

    closeTimelinePopupIfOpen();
    clearHits();

    var card = board.querySelector('.tl-s-card[data-tl-idx="' + idx + '"]');
    if (card) {
      card.classList.add(HIT_CLASS);
      scrollIntoViewSafe(card);
      return true;
    }

    var popupItem = board.querySelector('.tl-s-popup-item[data-tl-idx="' + idx + '"]');
    if (!popupItem) return false;
    var node = popupItem.closest(".tl-s-node");
    if (!node) return false;

    scrollIntoViewSafe(node);

    try {
      if (typeof _tlOpenPopupFor === "function") _tlOpenPopupFor(node);
    } catch (_) {}

    setTimeout(function () {
      var target = document.querySelector('.tl-s-popup-open .tl-s-popup-item[data-tl-idx="' + idx + '"]')
        || board.querySelector('.tl-s-popup-item[data-tl-idx="' + idx + '"]');
      if (!target) {
        scrollIntoViewSafe(node);
        return;
      }
      clearHits();
      target.classList.add(HIT_CLASS);
      scrollIntoViewSafe(target);
    }, 80);
    return true;
  }

  function jumpTimeline(step) {
    var state = states.tl;
    if (!state.matches.length) {
      updateInfo(state, "tl-doc-search-info", state.keyword ? "无匹配文档" : "");
      return;
    }
    state.pos = (state.pos + step + state.matches.length) % state.matches.length;
    var item = state.matches[state.pos];
    var prefix = state.keyword ? "第 " + (state.pos + 1) + " / " + state.matches.length + " 个：" : "";
    updateInfo(state, "tl-doc-search-info", prefix + labelFor(item));
    // 把 DOM 滚动/弹层展开放到下一帧，保证输入框事件先返回
    defer(function () {
      var ok = revealTimelineDocument(item.idx);
      updateInfo(
        state,
        "tl-doc-search-info",
        ok ? prefix + labelFor(item) : prefix + labelFor(item) + "（未在时间轴中找到节点）"
      );
    });
  }

  function recomputeTimeline(keyword) {
    var state = states.tl;
    state.keyword = String(keyword || "").trim();
    state.matches = findMatches(state.keyword);
    state.pos = -1;
    clearHits();
    if (!state.keyword) {
      updateInfo(state, "tl-doc-search-info", "");
      return;
    }
    updateInfo(
      state,
      "tl-doc-search-info",
      state.matches.length
        ? "共 " + state.matches.length + " 个匹配 · 按回车或“下一个”定位"
        : "无匹配文档"
    );
  }

  // ── 审查文档列表 ──────────────────────────────────────────────────────────

  function revealDocListItem(idx) {
    var board = document.getElementById("doclist-board");
    if (!board) return false;
    clearHits();
    var el = board.querySelector('.doclist-item[data-idx="' + idx + '"]');
    if (!el) return false;
    el.classList.add(HIT_CLASS);
    scrollIntoViewSafe(el);
    return true;
  }

  function jumpDocList(step) {
    var state = states.doclist;
    if (!state.matches.length) {
      updateInfo(state, "doclist-doc-search-info", state.keyword ? "无匹配文档" : "");
      return;
    }
    state.pos = (state.pos + step + state.matches.length) % state.matches.length;
    var item = state.matches[state.pos];
    var prefix = state.keyword ? "第 " + (state.pos + 1) + " / " + state.matches.length + " 个：" : "";
    updateInfo(state, "doclist-doc-search-info", prefix + labelFor(item));
    defer(function () {
      var ok = revealDocListItem(item.idx);
      updateInfo(
        state,
        "doclist-doc-search-info",
        ok ? prefix + labelFor(item) : prefix + labelFor(item) + "（未在列表中找到条带）"
      );
    });
  }

  function recomputeDocList(keyword) {
    var state = states.doclist;
    state.keyword = String(keyword || "").trim();
    state.matches = findMatches(state.keyword);
    state.pos = -1;
    clearHits();
    if (!state.keyword) {
      updateInfo(state, "doclist-doc-search-info", "");
      return;
    }
    updateInfo(
      state,
      "doclist-doc-search-info",
      state.matches.length
        ? "共 " + state.matches.length + " 个匹配 · 按回车或“下一个”定位"
        : "无匹配文档"
    );
  }

  // ── 事件绑定 ──────────────────────────────────────────────────────────────

  function bindSearchBar(options) {
    var input = document.getElementById(options.inputId);
    var prev = document.getElementById(options.prevId);
    var next = document.getElementById(options.nextId);
    if (!input || input.dataset.docSearchBound) return;
    input.dataset.docSearchBound = "1";

    // 输入时只更新匹配数量和提示，不做滚动/展开等重活，保证输入框随时可响应
    input.addEventListener("input", function () {
      options.recompute(input.value);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      var state = states[options.stateKey];
      if (state.keyword !== String(input.value || "").trim() || !state.matches.length) {
        options.recompute(input.value);
      }
      if (states[options.stateKey].matches.length) {
        options.jump(event.shiftKey ? -1 : 1);
      }
    });

    if (prev) {
      prev.addEventListener("click", function () {
        if (!states[options.stateKey].matches.length) options.recompute(input.value);
        options.jump(-1);
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        if (!states[options.stateKey].matches.length) options.recompute(input.value);
        options.jump(1);
      });
    }
  }

  function refreshAfterRender(which) {
    var state = states[which];
    if (!state.keyword) return;
    state.matches = findMatches(state.keyword);
    if (state.pos >= state.matches.length) state.pos = state.matches.length - 1;
    var infoId = which === "tl" ? "tl-doc-search-info" : "doclist-doc-search-info";
    if (!state.matches.length) {
      updateInfo(state, infoId, "无匹配文档");
      return;
    }
    if (state.pos < 0) state.pos = 0;
    updateInfo(
      state,
      infoId,
      "第 " + (state.pos + 1) + " / " + state.matches.length + " 个：" + labelFor(state.matches[state.pos]) + "（按回车继续定位）"
    );
  }

  function observeBoard(boardId, which) {
    var board = document.getElementById(boardId);
    if (!board || board.dataset.docSearchObserved) return;
    board.dataset.docSearchObserved = "1";
    if (typeof MutationObserver !== "function") return;
    new MutationObserver(function () {
      // 渲染完成后重新对齐关键词与当前命中项，不主动滚动，避免打断用户
      refreshAfterRender(which);
      if (which === "doclist") syncDoclistSearchWidth();
      if (which === "tl") {
        syncTimelineSearchWidth();
        // 卡片入场动画（tl-s-card-in）会临时改变 transform，
        // 动画结束后再对齐一次，避免按动画中间的位移计算左边距。
        scheduleTimelineWidthSync();
      }
    }).observe(board, { childList: true, subtree: false });
  }

  var timelineWidthTimer = null;

  function scheduleTimelineWidthSync() {
    if (timelineWidthTimer) clearTimeout(timelineWidthTimer);
    timelineWidthTimer = setTimeout(function () {
      timelineWidthTimer = null;
      syncTimelineSearchWidth();
    }, 450);
  }

  function contentBoxOf(el) {
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var left = rect.left;
    var right = rect.right;
    try {
      var style = window.getComputedStyle(el);
      left += (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
      right -= (parseFloat(style.borderRightWidth) || 0) + (parseFloat(style.paddingRight) || 0);
    } catch (_) {}
    if (right <= left) return null;
    return { left: left, right: right };
  }

  function horizontalBounds(elements) {
    if (!elements || !elements.length) return null;
    var minLeft = Infinity;
    var maxRight = -Infinity;
    for (var i = 0; i < elements.length; i++) {
      var rect = elements[i].getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      if (rect.left < minLeft) minLeft = rect.left;
      if (rect.right > maxRight) maxRight = rect.right;
    }
    if (!isFinite(minLeft) || !isFinite(maxRight) || maxRight <= minLeft) return null;
    return { left: minLeft, width: maxRight - minLeft };
  }

  // 将搜索栏精确对齐到下方条带/卡片的外沿：宽度取最左到最右的实际范围，
  // 左边距取相对内容盒的偏移，因此右侧按钮末端必然与条带右端重合。
  function alignBarToBounds(bar, content, bounds) {
    var box = contentBoxOf(content);
    if (!bar) return;
    if (!box || !bounds || bounds.width <= 0) {
      bar.style.width = "";
      bar.style.marginLeft = "";
      bar.style.marginRight = "";
      return;
    }
    var left = bounds.left - box.left;
    var maxWidth = box.right - box.left;
    if (left < 0) left = 0;
    var width = Math.min(bounds.width, maxWidth);
    if (left + width > maxWidth) left = Math.max(0, maxWidth - width);
    bar.style.width = width + "px";
    bar.style.marginLeft = left + "px";
    bar.style.marginRight = "auto";
  }

  // 时间轴：对齐到最后一行/第一行实际卡片框的外沿（不再依赖容器宽度）
  function syncTimelineSearchWidth() {
    var bar = document.getElementById("tl-doc-search-bar");
    var content = document.getElementById("timeline-tab-content");
    if (!bar || !content) return;
    var container = document.querySelector("#tl-board .tl-s-container");
    if (!container) {
      alignBarToBounds(bar, content, null);
      return;
    }
    var cards = container.querySelectorAll(".tl-s-card-wrap");
    var bounds = horizontalBounds(cards);
    if (!bounds) {
      var rect = container.getBoundingClientRect();
      bounds = rect.width > 0 ? { left: rect.left, width: rect.width } : null;
    }
    alignBarToBounds(bar, content, bounds);
  }

  // 文档列表：对齐到实际文档条带的外沿（含滚动条占用的宽度）
  function syncDoclistSearchWidth() {
    var bar = document.getElementById("doclist-doc-search-bar");
    var content = document.getElementById("doclist-content");
    var board = document.getElementById("doclist-board");
    if (!bar || !content || !board) return;
    var bounds = horizontalBounds(board.querySelectorAll(".doclist-item"));
    if (!bounds) {
      var items = board.querySelector(".doclist-items");
      if (items) {
        var rect = items.getBoundingClientRect();
        if (rect.width > 0) bounds = { left: rect.left, width: rect.width };
      }
    }
    alignBarToBounds(bar, content, bounds);
  }

  // ── 贴顶悬浮：根据顶部标签栏实际高度计算 sticky 偏移 ──────────────────────

  var stickyOffsetQueued = false;

  function updateStickyOffset() {
    stickyOffsetQueued = false;
    var tabsWrapper = document.querySelector(".tabs-wrapper");
    var tabsTop = 0;
    if (tabsWrapper) {
      try {
        tabsTop = parseFloat(window.getComputedStyle(tabsWrapper).top) || 0;
      } catch (_) {
        tabsTop = 0;
      }
    }
    // 标签栏 sticky 的 top（有 dossier 标签栏时为 40px）+ 标签栏自身高度
    var offset = tabsTop + (tabsWrapper ? (tabsWrapper.offsetHeight || 0) : 0);
    document.documentElement.style.setProperty("--doc-search-sticky-top", Math.max(0, offset) + "px");
  }

  function scheduleStickyOffset() {
    if (stickyOffsetQueued) return;
    stickyOffsetQueued = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(updateStickyOffset);
    } else {
      setTimeout(updateStickyOffset, 0);
    }
  }

  function observeStickyLayout() {
    window.addEventListener("resize", scheduleStickyOffset);
    window.addEventListener("resize", syncDoclistSearchWidth);
    window.addEventListener("resize", syncTimelineSearchWidth);
    var doclistTabBtn = document.querySelector('.tab-btn[data-tab="doclist"]');
    if (doclistTabBtn) {
      doclistTabBtn.addEventListener("click", function () {
        setTimeout(syncDoclistSearchWidth, 0);
      });
    }
    var timelineTabBtn = document.querySelector('.tab-btn[data-tab="timeline"]');
    if (timelineTabBtn) {
      timelineTabBtn.addEventListener("click", function () {
        setTimeout(syncTimelineSearchWidth, 0);
        scheduleTimelineWidthSync();
      });
    }
    var doclistTabContent = document.getElementById("tab-doclist");
    if (doclistTabContent && typeof MutationObserver === "function") {
      new MutationObserver(function () {
        if (doclistTabContent.classList.contains("active")) {
          setTimeout(syncDoclistSearchWidth, 0);
        }
      }).observe(doclistTabContent, { attributes: true, attributeFilter: ["class"] });
    }
    var timelineTabContent = document.getElementById("tab-timeline");
    if (timelineTabContent && typeof MutationObserver === "function") {
      new MutationObserver(function () {
        if (timelineTabContent.classList.contains("active")) {
          setTimeout(syncTimelineSearchWidth, 0);
          scheduleTimelineWidthSync();
        }
      }).observe(timelineTabContent, { attributes: true, attributeFilter: ["class"] });
    }
    var tlBoard = document.getElementById("tl-board");
    if (tlBoard) {
      tlBoard.addEventListener("animationend", function () {
        scheduleTimelineWidthSync();
      }, true);
    }
    var tabsWrapper = document.querySelector(".tabs-wrapper");
    if (tabsWrapper && typeof ResizeObserver === "function") {
      try { new ResizeObserver(scheduleStickyOffset).observe(tabsWrapper); } catch (_) {}
    }
    var dossierBar = document.getElementById("dossier-tabs-bar");
    if (dossierBar) {
      if (typeof ResizeObserver === "function") {
        try { new ResizeObserver(scheduleStickyOffset).observe(dossierBar); } catch (_) {}
      }
      if (typeof MutationObserver === "function") {
        try {
          new MutationObserver(scheduleStickyOffset).observe(dossierBar, {
            attributes: true,
            attributeFilter: ["class", "style"],
          });
        } catch (_) {}
      }
    }
    // 查询结果区从隐藏变为可见时，标签栏高度会从 0 恢复；重新计算 sticky 偏移
    ["result-section", "app"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || typeof MutationObserver !== "function") return;
      try {
        new MutationObserver(scheduleStickyOffset).observe(el, {
          attributes: true,
          attributeFilter: ["class"],
        });
      } catch (_) {}
    });
    scheduleStickyOffset();
  }

  function init() {
    bindSearchBar({
      inputId: "tl-doc-search-input",
      prevId: "tl-doc-search-prev",
      nextId: "tl-doc-search-next",
      stateKey: "tl",
      recompute: recomputeTimeline,
      jump: jumpTimeline,
    });
    bindSearchBar({
      inputId: "doclist-doc-search-input",
      prevId: "doclist-doc-search-prev",
      nextId: "doclist-doc-search-next",
      stateKey: "doclist",
      recompute: recomputeDocList,
      jump: jumpDocList,
    });
    observeBoard("tl-board", "tl");
    observeBoard("doclist-board", "doclist");
    observeStickyLayout();
    syncDoclistSearchWidth();
    syncTimelineSearchWidth();
    scheduleTimelineWidthSync();
  }

  window.PatentLensDocSearch = {
    findMatches: findMatches,
    recomputeTimeline: recomputeTimeline,
    recomputeDocList: recomputeDocList,
    // 供测试使用
    _documentSearchText: documentSearchText,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
