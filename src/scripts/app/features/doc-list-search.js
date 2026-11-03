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
    }).observe(board, { childList: true, subtree: false });
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
