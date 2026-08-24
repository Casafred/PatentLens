/*!
 * PatentLens - 历史记录恢复查询时间跟踪
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260824
 *
 * web-app.js 已冻结不可新增行，本模块以 DOM 增强 + 函数覆盖方式为
 * 侧边栏「历史记录」列表增加：
 *   1. 记录每条历史记录最近一次被点击（恢复查询）的时间
 *      （localStorage: patentlens-histacc-map = { "type|pn": ts }）
 *   2. 列表条目在原「缓存时间」下方追加「最近查看 xx前」
 *   3. 列表按恢复查询时间降序排列：刚查看过的记录置顶，
 *      从未查看过的保持原有（缓存时间）顺序
 *
 * 依赖（web-app.js 暴露的全局，经典脚本未用 IIFE 包裹）：
 *   - refreshHistoryList：function 声明挂 window，覆盖 window 属性后
 *     web-app.js 内部的直接调用（标识符运行时解析）会命中包装版本
 *   - timeAgo：function 声明，直接以名字访问
 *
 * 实现说明：
 *   - 点击记录采用「捕获阶段」事件委托，先于 web-app.js 绑定在
 *     .history-item 上的 handler 执行；此时移动 DOM 节点（排序）不会
 *     中断进行中的事件传播（事件路径在派发时已快照）
 *   - 删除/清空历史后通过「对账清理」移除对应访问记录：每次列表
 *     重渲染且搜索框为空（完整列表）时，删除 map 中已不存在于列表的键
 */
(function () {
  "use strict";

  var MAP_KEY = "patentlens-histacc-map";

  function loadMap() {
    try {
      var raw = localStorage.getItem(MAP_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function saveMap(map) {
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify(map));
    } catch (e) { /* 配额不足时忽略，访问时间仅影响排序展示 */ }
  }

  function itemKey(type, pn) {
    return (type || "dossier") + "|" + (pn || "");
  }

  function fmtAgo(ts) {
    try {
      if (typeof timeAgo === "function") return timeAgo(ts);
    } catch (e) { /* ignore */ }
    return new Date(ts).toLocaleDateString();
  }

  var _scheduled = false;
  function schedulePostProcess() {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(function () {
      _scheduled = false;
      try { postProcess(); } catch (e) { console.warn("[HistoryAccessTracker] postProcess failed:", e); }
    });
  }

  // 列表增强：追加「最近查看」时间 + 按访问时间排序 + 对账清理
  function postProcess() {
    var list = document.getElementById("history-list");
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll(".history-item"));
    if (items.length === 0) return;

    var map = loadMap();
    var selectMode = list.classList.contains("select-mode");

    // 1. 时间显示（选择模式下也更新显示，但不排序以免打乱勾选）
    items.forEach(function (el) {
      var ts = map[itemKey(el.dataset.type, el.dataset.patent)];
      var existing = el.querySelector(".history-item-access");
      if (ts) {
        if (!existing) {
          existing = document.createElement("div");
          existing.className = "history-item-access";
          var timeEl = el.querySelector(".history-item-time");
          if (timeEl && timeEl.parentNode) {
            timeEl.insertAdjacentElement("afterend", existing);
          } else {
            var main = el.querySelector(".history-item-main");
            if (main) main.appendChild(existing);
            else return;
          }
        }
        existing.textContent = "最近查看 " + fmtAgo(ts);
      } else if (existing) {
        existing.remove();
      }
    });

    // 2. 排序：按访问时间降序（稳定排序，未访问条目保持原顺序靠后）。
    //    列表内容与 .history-item 互斥渲染（有条目时无占位节点），
    //    依次 appendChild 即按目标顺序重排；顺序已正确时跳过避免 DOM 抖动
    if (!selectMode && items.length > 1) {
      var sorted = items.slice().sort(function (a, b) {
        var ta = map[itemKey(a.dataset.type, a.dataset.patent)] || 0;
        var tb = map[itemKey(b.dataset.type, b.dataset.patent)] || 0;
        return tb - ta;
      });
      var needSort = false;
      for (var i = 0; i < sorted.length; i++) {
        if (list.children[i] !== sorted[i]) { needSort = true; break; }
      }
      if (needSort) {
        sorted.forEach(function (el) { list.appendChild(el); });
      }
    }

    // 3. 对账清理：搜索框为空（完整列表）时，删除已不存在条目的访问记录。
    //    覆盖单条删除 / 批量删除 / 清空全部等入口，无需逐个监听按钮。
    var searchInput = document.getElementById("history-search-input");
    var searching = searchInput && (searchInput.value || "").trim();
    if (!searching) {
      var present = {};
      items.forEach(function (el) { present[itemKey(el.dataset.type, el.dataset.patent)] = true; });
      var dirty = false;
      Object.keys(map).forEach(function (k) {
        if (!present[k]) { delete map[k]; dirty = true; }
      });
      if (dirty) saveMap(map);
    }
  }

  // ── 点击记录（捕获阶段委托） ─────────────────────────────

  function setupClickTracker() {
    var list = document.getElementById("history-list");
    if (!list) return;
    list.addEventListener("click", function (e) {
      // 删除按钮/勾选框操作不算「恢复查询」
      if (e.target.closest(".history-item-delete-btn")) return;
      if (e.target.tagName === "INPUT") return;
      var item = e.target.closest(".history-item");
      if (!item) return;
      // 选择模式下点击是勾选，不是恢复查询
      if (list.classList.contains("select-mode")) return;

      var key = itemKey(item.dataset.type, item.dataset.patent);
      var map = loadMap();
      map[key] = Date.now();
      saveMap(map);
      // 立即重排置顶 + 更新时间行（事件路径已快照，移动节点不影响
      // web-app.js 绑定在本条目上的 click handler 继续执行）
      try { postProcess(); } catch (err) { /* ignore */ }
    }, true);
  }

  // ── 覆盖 refreshHistoryList：每次渲染后追加增强 ──────────

  function setupRefreshHook() {
    if (typeof window.refreshHistoryList !== "function") return;
    var _orig = window.refreshHistoryList;
    window.refreshHistoryList = function () {
      var result = _orig.apply(this, arguments);
      schedulePostProcess();
      return result;
    };
  }

  // ── 初始化 ──────────────────────────────────────────────

  setupRefreshHook();
  setupClickTracker();
  // 模块加载晚于 web-app.js 的首次 refreshHistoryList() 调用，补跑一次
  schedulePostProcess();

  // 侧边栏 DOM 结构变化（如初次显示、搜索重渲染）时兜底增强
  if (typeof MutationObserver === "function") {
    var sidebar = document.getElementById("history-list");
    if (sidebar) {
      new MutationObserver(function () {
        schedulePostProcess();
      }).observe(sidebar, { childList: true });
    }
  }
})();
