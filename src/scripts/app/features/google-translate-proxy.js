/*!
 * PatentLens - Google 文本翻译本地代理
 *
 * 渲染进程直接 fetch translate.googleapis.com 会被 CORS 拦截
 * （该接口不返回 Access-Control-Allow-Origin），表现为翻译偶发失败、
 * 刷新或稍后又恢复。本模块把 window.googleTranslateText 重定向到本地主进程
 * 代理 /api/google-translate，失败时再回退到原始实现。
 *
 * web-app.js 已冻结，本模块只做运行时覆盖，不修改 legacy 代码。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function parseTranslated(data) {
    var dst = "";
    try {
      for (var i = 0; i < data[0].length; i++) dst += data[0][i][0];
    } catch (_) {}
    return dst;
  }

  async function translateViaLocal(text) {
    var resp = await window.fetch(
      "/api/google-translate?q=" + encodeURIComponent(String(text == null ? "" : text)),
      { cache: "no-store", credentials: "same-origin" }
    );
    if (!resp || !resp.ok) throw new Error("本地 Google 翻译代理不可用（HTTP " + (resp ? resp.status : "?") + "）");
    var data = await resp.json();
    if (data && data.error) throw new Error(data.error);
    var translated = parseTranslated(data);
    if (!translated) throw new Error("Google 翻译返回空结果");
    return translated;
  }

  function install() {
    var original = window.googleTranslateText;
    if (typeof original !== "function" || original.__plLocalProxyWrapped) return;
    var wrapped = async function (text) {
      try {
        return await translateViaLocal(text);
      } catch (e) {
        // 主进程代理不可用（旧版本未重启等）时保留原来的直连行为
        return original.apply(this, arguments);
      }
    };
    wrapped.__plLocalProxyWrapped = true;
    window.googleTranslateText = wrapped;
  }

  window.PatentLensGoogleTranslateProxy = { translate: translateViaLocal };

  install();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }
})();
