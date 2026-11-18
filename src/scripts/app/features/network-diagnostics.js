/*
 * PatentLens - GD/EPO 请求阶段与耗时诊断
 *
 * 只观察 /api/gd 请求，不改变业务返回值。主进程会返回来源、阶段和耗时
 * 响应头；这里把它们显示在审查文档加载区。请求取消和超时由查询模块
 * 与主进程管理，本模块保留调用者的 Request / AbortSignal。
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__patentLensNetworkDiagnostics) return;

  var rawFetch = window.fetch.bind(window);
  var history = [];
  var active = 0;
  var pendingUrls = new Map();
  var MAX_HISTORY = 30;

  function stageFor(url) {
    var value = String(url || "");
    if (/patent-family/i.test(value)) return "同族信息";
    if (/doc-list/i.test(value)) return "审查文档列表";
    if (/doc-content/i.test(value)) return "审查文档 PDF";
    if (/citation/i.test(value)) return "引用数据";
    return "审查文档请求";
  }

  function isDossierRequest(input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    return /\/api\/gd(?:[/?]|$)/i.test(String(url)) || /cloudfront\.net/i.test(String(url));
  }

  function updateUi(text, busy) {
    var el = document.getElementById("content-loading-text");
    if (el && (busy || el.dataset.plNetworkOwned === "1")) {
      el.textContent = text;
      el.dataset.plNetworkOwned = "1";
    }
    var loading = document.getElementById("content-loading-overlay");
    if (loading) {
      loading.setAttribute("data-network-stage", text);
      if (busy && window.electronAPI && typeof window.electronAPI.gdOpenLoginWindow === "function" && !loading.querySelector("[data-pl-gd-login]")) {
        var button = document.createElement("button");
        button.type = "button";
        button.dataset.plGdLogin = "1";
        button.textContent = "需要登录？打开 GD 登录窗口";
        button.style.cssText = "margin-top:8px;padding:6px 10px;border:1px solid #94a3b8;border-radius:7px;background:var(--bg-secondary,#fff);color:inherit;cursor:pointer;";
        button.addEventListener("click", function () { window.electronAPI.gdOpenLoginWindow().catch(function () {}); });
        loading.appendChild(button);
      }
    }
    try { window.dispatchEvent(new CustomEvent("patentlens-network-update", { detail: { text: text, busy: !!busy } })); } catch (_) {}
  }

  function record(item) {
    history.push(item);
    while (history.length > MAX_HISTORY) history.shift();
    window.__patentLensNetworkDiagnostics.last = item;
    window.__patentLensNetworkDiagnostics.history = history.slice();
  }

  window.fetch = function (input, init) {
    if (!isDossierRequest(input)) return rawFetch(input, init);
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var stage = stageFor(url);
    var started = Date.now();
    active++;
    var progressPath = String(url).replace(/^.*\/api\/gd/, "");
    pendingUrls.set(progressPath, (pendingUrls.get(progressPath) || 0) + 1);
    updateUi((/epoDirect=1/.test(url) ? "正在访问 EPO（" : "正在访问 GD（") + stage + "）…", true);

    return rawFetch(input, init).then(function (response) {
      var elapsed = Date.now() - started;
      var epo = response.headers && response.headers.get("X-Epo-Fallback") === "1";
      var source = response.headers && response.headers.get("X-PatentLens-Source") || (epo ? "epo" : "gd");
      var cache = response.headers && response.headers.get("X-PatentLens-Cache") || "MISS";
      var item = { url: String(url), stage: stage, source: source, cache: cache, status: response.status, elapsedMs: elapsed, at: Date.now() };
      record(item);
      var sourceLabel = source === "epo" ? "EPO" : (source === "cache" ? "本地 PDF 缓存" : "GD");
      updateUi(sourceLabel + " · " + stage + " · " + elapsed + " ms" + (cache === "HIT" ? " · 缓存命中" : ""), active > 1);
      return response;
    }).catch(function (error) {
      var elapsed = Date.now() - started;
      record({ url: String(url), stage: stage, source: "error", status: 0, elapsedMs: elapsed, error: error && error.message || "请求失败", at: Date.now() });
      updateUi(stage + "失败（" + elapsed + " ms）：" + (error && error.message || "网络错误"), active > 1);
      throw error;
    }).finally(function () {
      active = Math.max(0, active - 1);
      var count = (pendingUrls.get(progressPath) || 1) - 1;
      if (count) pendingUrls.set(progressPath, count); else pendingUrls.delete(progressPath);
      if (!active) setTimeout(function () {
        var el = document.getElementById("content-loading-text");
        if (el && el.dataset.plNetworkOwned === "1") delete el.dataset.plNetworkOwned;
      }, 1800);
    });
  };

  if (window.electronAPI && typeof window.electronAPI.onGdNetworkProgress === "function") {
    window.electronAPI.onGdNetworkProgress(function (event) {
      if (!event || !pendingUrls.has(event.path)) return;
      var stage = stageFor(event.path);
      updateUi((event.source === "epo" ? "正在访问 EPO（可能需要在弹窗完成验证）" : "正在访问 GD") + " · " + stage + "…", true);
    });
  }

  window.__patentLensNetworkDiagnostics = {
    history: history,
    getActive: function () { return active; },
    getHistory: function () { return history.slice(); },
    reset: function () { history.length = 0; },
  };
})();
