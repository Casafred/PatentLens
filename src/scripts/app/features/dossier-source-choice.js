/*!
 * PatentLens - 审查文档数据源选择（GD 优先，失败后再由用户决定是否切 EPO）
 *
 * 背景：默认必须先走 USPTO Global Dossier（GD）。此前 GD 未登录时后端会在
 * 几秒内自动降级 EPO 并弹出 EPO 验证窗口，用户抓取回来后又会弹出 GD 登录窗，
 * 两个窗口互相打断，查询路径不可预期。
 *
 * 本模块：
 *   1. 接管 web-app.js 的 _promptGdEpoBrowserOpen，不再自动打开 EPO 窗口；
 *   2. GD 失败时弹出明确选择：「重新登录 GD」或「改用 EPO 查询」；
 *   3. 用户选择 EPO 后，仅为本次运行追加 epoFallback=1，重启应用即恢复 GD 优先；
 *   4. EPO 已被选择时，保留原有 EPO 人机验证窗口流程。
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__plDossierSourceChoiceInstalled) return;
  window.__plDossierSourceChoiceInstalled = true;

  var SESSION_KEY = "patentlens_epo_fallback_session";
  var state = { dialog: null, lastPromptAt: 0, lastGdFailure: null, loginCancelledAt: 0 };

  function epoPreferred() {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
    } catch (_) {}
    return !!window.__plPreferEpo;
  }

  function preferEpo(enabled) {
    window.__plPreferEpo = !!enabled;
    try {
      if (enabled) sessionStorage.setItem(SESSION_KEY, "1");
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function isGdRequest(input) {
    var url = typeof input === "string" ? input : (input && typeof input.url === "string" ? input.url : "");
    return url.indexOf("/api/gd/") !== -1;
  }

  function isGdJsonCandidate(input) {
    return isGdRequest(input) && String(typeof input === "string" ? input : input.url).indexOf("/doc-content/") === -1;
  }

  function withEpoFallback(input) {
    if (typeof input !== "string") return input;
    if (!isGdRequest(input) || /[?&]epoFallback=1(?:&|$)/.test(input)) return input;
    return input + (input.indexOf("?") === -1 ? "?" : "&") + "epoFallback=1";
  }

  // 用户选择 EPO 后，本次运行所有 /api/gd 请求都显式声明降级来源，
  // 主进程据此跳过 GD、不等待登录，也不会再自动弹 GD 登录窗口。
  var rawFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (rawFetch && !window.__plDossierSourceFetchInstalled) {
    window.__plDossierSourceFetchInstalled = true;
    window.fetch = function (input, init) {
      if (epoPreferred()) input = withEpoFallback(input);
      var pending = rawFetch(input, init);
      // web-app.js 的 gdFetch 只复制 cloudflare/rateLimited 等旧标志。
      // 这里从 JSON 响应中捕获 GD 失败标志，供 gdFetch 包装器补回错误对象。
      if (!isGdJsonCandidate(input)) return pending;
      return pending.then(function (resp) {
        var type = "";
        try {
          type = resp.headers && resp.headers.get ? resp.headers.get("content-type") || "" : "";
        } catch (_) {}
        if (type.indexOf("application/json") === -1 || !resp.clone) return resp;
        // 等克隆体解析完成再放行，确保 gdFetch 抛错前标志已就绪。
        return resp.clone().json().then(function (data) {
          if (data && data.gdFailed) {
            state.lastGdFailure = {
              at: Date.now(),
              flags: {
                gdFailed: true,
                loginRequired: !!data.loginRequired,
                epoAvailable: data.epoAvailable !== false,
                browserUrl: data.browserUrl || "",
                message: data.error || "",
              },
            };
          } else if (data && state.lastGdFailure && Date.now() - state.lastGdFailure.at < 15000) {
            state.lastGdFailure = null;
          }
          return resp;
        }).catch(function () { return resp; });
      });
    };
  }

  // 把捕获到的 gdFailed 标志补到 gdFetch 抛出的错误上，交给选择弹窗处理。
  // 若是“未登录 GD”，先不报错：打开登录窗口并挂起当前查询，登录成功后自动
  // 重试同一个请求，让 doSearch 像正常查询一样继续。
  function setLoadingText(text) {
    try {
      ["loading-text", "content-loading-text"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
      });
    } catch (_) {}
  }

  function showLoginPending() {
    toast("需要登录 USPTO Global Dossier，已打开登录窗口；登录完成后会自动继续本次查询…");
    setLoadingText("等待 USPTO GD 登录...");
  }

  var rawGdFetch = typeof window.gdFetch === "function" ? window.gdFetch : null;
  if (rawGdFetch && !window.__plGdFailureBridgeInstalled) {
    window.__plGdFailureBridgeInstalled = true;
    window.gdFetch = function () {
      var self = this;
      var args = arguments;
      function attach(error) {
        var info = state.lastGdFailure;
        state.lastGdFailure = null;
        if (!error || !info || Date.now() - info.at > 15000) return error;
        if (info.flags.gdFailed) error.gdFailed = true;
        if (info.flags.loginRequired) error.loginRequired = true;
        error.epoAvailable = info.flags.epoAvailable !== false;
        if (!error.message && info.flags.message) error.message = info.flags.message;
        return error;
      }
      function attempt(canLogin) {
        return rawGdFetch.apply(self, args).catch(function (error) {
          error = attach(error);
          if (!canLogin || !error || !error.loginRequired) throw error;
          var api = window.electronAPI;
          if (!api || typeof api.gdAwaitLogin !== "function") throw error;
          // 用户刚关闭登录窗口时不要在同一次查询里反复弹窗。
          if (state.loginCancelledAt && Date.now() - state.loginCancelledAt < 30000) throw error;
          showLoginPending();
          return api.gdAwaitLogin().then(function (result) {
            if (!result || !result.ready) {
              state.loginCancelledAt = Date.now();
              throw error;
            }
            state.loginCancelledAt = 0;
            setLoadingText("正在查询审查文档...");
            return attempt(false);
          }, function () {
            state.loginCancelledAt = Date.now();
            throw error;
          });
        });
      }
      return attempt(true);
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(message) {
    try {
      if (typeof showToast === "function") { showToast(message, 5000); return; }
    } catch (_) {}
  }

  function closeDialog() {
    if (state.dialog && state.dialog.parentNode) state.dialog.parentNode.removeChild(state.dialog);
    state.dialog = null;
  }

  function retrySearch() {
    var attempts = 0;
    function tick() {
      attempts++;
      var btn = document.getElementById("search-btn");
      var input = document.getElementById("patent-input");
      if (btn && !btn.disabled && input && input.value.trim()) {
        btn.click();
        return;
      }
      if (attempts < 12) setTimeout(tick, 500);
      else toast("查询按钮仍不可用，请手动重新查询");
    }
    setTimeout(tick, 300);
  }

  function loginGd() {
    closeDialog();
    try {
      if (window.electronAPI && typeof window.electronAPI.gdOpenLoginWindow === "function") {
        window.electronAPI.gdOpenLoginWindow().catch(function () {});
        toast("已打开 GD 登录窗口，登录完成后会自动重试查询");
        return;
      }
    } catch (_) {}
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
        window.electronAPI.openExternal("https://globaldossier.uspto.gov/");
      } else {
        window.open("https://globaldossier.uspto.gov/", "_blank");
      }
    } catch (_) {}
  }

  function switchToEpo() {
    preferEpo(true);
    closeDialog();
    toast("已改用 EPO 查询；本次运行将优先使用 EPO，重启应用后恢复 GD 优先");
    retrySearch();
  }

  function injectStyle() {
    if (document.getElementById("pl-source-choice-style")) return;
    var style = document.createElement("style");
    style.id = "pl-source-choice-style";
    style.textContent =
      ".pl-source-choice-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100020;display:flex;align-items:center;justify-content:center;padding:20px;}" +
      ".pl-source-choice-card{background:var(--bg-primary,#fff);color:var(--text-primary,#1f2937);border-radius:14px;width:min(460px,100%);box-shadow:0 20px 60px rgba(0,0,0,.28);padding:20px 22px;font-family:inherit;}" +
      ".pl-source-choice-card h3{margin:0 0 10px;font-size:16px;color:var(--text-primary,#14532d);}" +
      ".pl-source-choice-card p{margin:0 0 10px;font-size:13px;line-height:1.7;color:var(--text-secondary,#475569);white-space:pre-wrap;word-break:break-word;}" +
      ".pl-source-choice-card .pl-sc-hint{font-size:12px;color:var(--text-secondary,#64748b);}" +
      ".pl-source-choice-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}" +
      ".pl-source-choice-actions button{border:1px solid var(--border,#cbd5e1);background:var(--bg-secondary,#f1f5f9);color:inherit;border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;}" +
      ".pl-source-choice-actions button:hover{filter:brightness(.97);}" +
      ".pl-source-choice-actions .pl-sc-primary{background:#16a34a;border-color:#16a34a;color:#fff;}" +
      ".pl-source-choice-actions .pl-sc-ghost{margin-left:auto;background:transparent;}";
    document.head.appendChild(style);
  }

  function showChoice(error, kind) {
    if (state.dialog) return;
    var now = Date.now();
    if (now - state.lastPromptAt < 3000) return;
    state.lastPromptAt = now;

    injectStyle();
    var overlay = document.createElement("div");
    overlay.className = "pl-source-choice-overlay";

    var reason = error && error.message ? error.message : "获取审查文档失败";
    var loginHint = error && error.loginRequired
      ? "尚未登录 USPTO Global Dossier（GD）。\n建议先登录 GD，登录后会自动重试查询。"
      : "GD 暂时不可用。你可以在登录 GD 后重试，或改用 EPO Register 获取同一份审查文档。";
    var where = kind ? "（" + kind + "）" : "";

    overlay.innerHTML =
      '<div class="pl-source-choice-card" role="dialog" aria-modal="true" aria-labelledby="pl-sc-title">' +
        '<h3 id="pl-sc-title">审查文档获取失败' + escapeHtml(where) + "</h3>" +
        "<p>" + escapeHtml(reason) + "</p>" +
        "<p>" + escapeHtml(loginHint) + "</p>" +
        '<p class="pl-sc-hint">切换 EPO 只影响本次运行；重启应用后仍会优先使用 GD。</p>' +
        '<div class="pl-source-choice-actions">' +
          '<button type="button" class="pl-sc-primary" data-action="gd">重新登录 GD</button>' +
          '<button type="button" data-action="epo">改用 EPO 查询</button>' +
          '<button type="button" class="pl-sc-ghost" data-action="cancel">取消</button>' +
        "</div>" +
      "</div>";

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeDialog();
    });
    overlay.querySelector('[data-action="gd"]').addEventListener("click", loginGd);
    overlay.querySelector('[data-action="epo"]').addEventListener("click", switchToEpo);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", closeDialog);
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDialog();
    });

    state.dialog = overlay;
    document.body.appendChild(overlay);
    try { overlay.querySelector('[data-action="gd"]').focus(); } catch (_) {}
  }

  // 用户再次点击查询（含登录完成后的自动重试）时，关闭遗留的选择框
  document.addEventListener("click", function (event) {
    if (!state.dialog) return;
    var btn = event.target && event.target.closest ? event.target.closest("#search-btn") : null;
    if (btn) closeDialog();
  }, true);

  var originalPrompt = window._promptGdEpoBrowserOpen;
  window._promptGdEpoBrowserOpen = function (error, kind) {
    // EPO 直走测试模式：保持原有行为（可见窗口已处理验证）
    try {
      if (typeof getEpoDirectMode === "function" && getEpoDirectMode()) return;
    } catch (_) {}

    // 用户已经选择 EPO：EPO 需要人机验证时，沿用原有内嵌验证窗口流程
    if (epoPreferred() && error && (error.cloudflare || error.rateLimited)) {
      if (typeof originalPrompt === "function") {
        return originalPrompt.apply(this, arguments);
      }
      return;
    }

    // GD 失败（后端不再自动降级 EPO）：交给用户选择
    if (error && error.gdFailed) {
      showChoice(error, kind);
      return;
    }

    // 兼容旧错误标志：未选择 EPO 时绝不自动打开 EPO 窗口
    if (error && (error.cloudflare || error.rateLimited)) {
      showChoice(error, kind);
    }
  };

  window.__plDossierSourceChoice = {
    preferEpo: preferEpo,
    isEpoPreferred: epoPreferred,
    close: closeDialog,
  };
})();
