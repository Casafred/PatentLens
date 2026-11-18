/*
 * PatentLens - 审查文档查询中断
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 关闭审查文档标签页时，正在进行的 Global Dossier 查询应当立即终止：
 *   - 中止底层 fetch 请求，停止继续占用网络与上游连接；
 *   - 立即恢复查询按钮并移除加载遮罩，避免按钮长时间保持灰色；
 *   - 阻止已中断的 doSearch 继续写入看板/缓存/标签页状态。
 *
 * web-app.js 处于冻结状态，因此这里通过包装已有的全局函数实现，不向
 * legacy 文件添加任何代码。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__plDossierQueryAbortInstalled) return;
  window.__plDossierQueryAbortInstalled = true;

  var GD_REQUEST_PREFIX = "/api/gd/";
  var state = { active: null };

  function createAbortError() {
    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch (_) {
      var err = new Error("The operation was aborted.");
      err.name = "AbortError";
      return err;
    }
  }

  function isGdRequest(input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url) return false;
    try {
      var base = (window.location && window.location.href) || "http://localhost/";
      var parsed = new URL(url, base);
      return parsed.pathname.indexOf(GD_REQUEST_PREFIX) === 0;
    } catch (_) {
      return String(url).indexOf(GD_REQUEST_PREFIX) === 0;
    }
  }

  function restoreSearchUi() {
    var btn = document.getElementById("search-btn");
    if (btn) btn.disabled = false;
    var overlay = document.getElementById("content-loading-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    var loading = document.getElementById("loading");
    if (loading) loading.classList.add("hidden");
  }

  function cancelActiveQuery() {
    var ctx = state.active;
    if (!ctx) return false;
    ctx.aborted = true;
    state.active = null;
    try { ctx.controller.abort(); } catch (_) {}
    restoreSearchUi();
    return true;
  }

  // 给所有 /api/gd 请求附加当前查询的 AbortSignal。其他请求（OCR、翻译、
  // Google Patents 等）保持原样，避免误伤。
  var rawFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (rawFetch && !window.__plDossierAbortFetchInstalled) {
    window.__plDossierAbortFetchInstalled = true;
    window.fetch = function (input, init) {
      var ctx = state.active;
      if (ctx && isGdRequest(input)) {
        if (ctx.aborted || ctx.controller.signal.aborted) {
          return Promise.reject(createAbortError());
        }
        var options = init ? Object.assign({}, init) : {};
        if (!options.signal) options.signal = ctx.controller.signal;
        return rawFetch(input, options);
      }
      return rawFetch(input, init);
    };
  }

  // 查询中断后，底层 gdFetch 会因 AbortSignal 而 reject。doSearch 对
  // family/doc-list 的错误有内层 catch，会继续执行清空看板、写缓存等破坏性
  // 操作。这里在中断状态下让该 Promise 保持 pending，使 doSearch 停在上一个
  // await 处，不再产生任何副作用。
  var rawGdFetch = typeof gdFetch === "function" ? gdFetch : null;
  if (rawGdFetch) {
    gdFetch = function () {
      var ctx = state.active;
      var pending = rawGdFetch.apply(this, arguments);
      if (!ctx) return pending;
      return new Promise(function (resolve, reject) {
        pending.then(function (value) {
          if (ctx.aborted || ctx.controller.signal.aborted) return;
          resolve(value);
        }, function (err) {
          if (ctx.aborted || ctx.controller.signal.aborted) return;
          reject(err);
        });
      });
    };
  }

  function activeTabKey() {
    return typeof _dossierActiveKey === "undefined" ? null : _dossierActiveKey;
  }

  function tabStillExists(key) {
    if (typeof _dossierTabs === "undefined" || !Array.isArray(_dossierTabs)) return false;
    return _dossierTabs.some(function (tab) { return tab && tab.key === key; });
  }

  var rawDoSearch = typeof doSearch === "function" ? doSearch : null;
  if (rawDoSearch) {
    doSearch = function () {
      // 新查询开始时，前一个查询不应继续占用网络。
      cancelActiveQuery();
      var controller = new AbortController();
      var ctx = {
        controller: controller,
        tabKey: activeTabKey(),
        aborted: false,
      };
      state.active = ctx;
      var result;
      try {
        result = rawDoSearch.apply(this, arguments);
      } catch (err) {
        if (state.active === ctx) state.active = null;
        throw err;
      }
      if (!result || typeof result.then !== "function") {
        if (state.active === ctx) state.active = null;
        return result;
      }
      return result.finally(function () {
        if (state.active === ctx) state.active = null;
      });
    };
  }

  // 标签页真正关闭后再终止查询：_dossierCloseTab 可能因为未保存内容弹确认框，
  // 用户取消时不能误伤仍在运行的查询。
  function wrapTabCloser(name) {
    var original = window[name];
    if (typeof original !== "function") return;
    window[name] = function (key) {
      var existedBefore = tabStillExists(key);
      try {
        return original.apply(this, arguments);
      } finally {
        var ctx = state.active;
        if (existedBefore && ctx && ctx.tabKey && ctx.tabKey === key && !tabStillExists(key)) {
          cancelActiveQuery();
        }
      }
    };
  }
  wrapTabCloser("_dossierCloseTab");
  wrapTabCloser("_dossierCloseTabByKey");

  window.__dossierQueryAbort = {
    cancel: cancelActiveQuery,
    isActive: function () { return !!state.active; },
  };
})();
