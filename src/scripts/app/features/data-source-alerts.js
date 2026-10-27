/*!
 * PatentLens - 数据源网络异常提醒
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 当 Google Patents / Global Dossier / EPO Register 等外部数据源返回网络或
 * 服务器错误时，在界面顶部显示明确的提示，避免用户误认为是 PatentLens 故障。
 * 外部数据源失败由 electron-main.js 通过 data-source-issue 事件推送。
 */
(function () {
  "use strict";

  var AUTO_HIDE_MS = 20000;
  var DEDUPE_MS = 12000;
  var _lastShownAt = Object.create(null);
  var _hideTimer = null;

  var SOURCES = {
    gp: { label: "Google Patents", scope: "专利原文" },
    gd: { label: "USPTO Global Dossier", scope: "审查文档" },
    epo: { label: "EPO Register", scope: "审查文档" },
    gd_epo: { label: "USPTO Global Dossier / EPO Register", scope: "审查文档" },
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSource(source) {
    return Object.prototype.hasOwnProperty.call(SOURCES, source) ? source : "";
  }

  function buildBody(source, reason) {
    var meta = SOURCES[source];
    if (reason === "cloudflare") {
      return "EPO Register 要求完成人机验证，暂时无法读取" + meta.scope +
        "。这不是 PatentLens 软件故障，请在 EPO 页面完成验证后重试。";
    }
    if (reason === "rate_limited") {
      return "EPO Register 限制了当前网络的访问频率，暂时无法读取" + meta.scope +
        "。这不是 PatentLens 软件故障，请稍后重试。";
    }
    return "获取" + meta.scope + "时遇到网络或服务器错误。这通常是 " +
      "USPTO / EPO 官方服务器或您当前网络的问题，不是 PatentLens 软件故障。" +
      "请稍后重试。";
  }

  function removeBanner() {
    var existing = document.getElementById("pl-data-source-alert");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function openUrl(url) {
    if (!/^https?:\/\//i.test(url || "")) return;
    if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  }

  function showBanner(payload) {
    var source = payload.source;
    var meta = SOURCES[source];
    removeBanner();
    if (_hideTimer) {
      clearTimeout(_hideTimer);
      _hideTimer = null;
    }

    var banner = document.createElement("div");
    banner.id = "pl-data-source-alert";
    banner.setAttribute("role", "alert");
    banner.setAttribute("aria-live", "assertive");
    banner.style.cssText = [
      "position:fixed",
      "top:18px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:1000000",
      "width:min(640px,calc(100vw - 32px))",
      "box-sizing:border-box",
      "display:flex",
      "gap:12px",
      "padding:14px 16px",
      "border:1px solid #f59e0b",
      "border-left:5px solid #f59e0b",
      "border-radius:10px",
      "background:#fffbeb",
      "color:#78350f",
      "box-shadow:0 10px 30px rgba(0,0,0,0.18)",
      "font-size:13px",
      "line-height:1.6",
    ].join(";");

    var detailHtml = payload.detail
      ? '<div style="margin-top:4px;color:#92400e;opacity:.85;font-size:12px;word-break:break-all;">' +
        escapeHtml(payload.detail) + "</div>"
      : "";
    var openHtml = payload.url
      ? '<button type="button" data-role="open" style="margin-left:8px;padding:4px 10px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#92400e;font-size:12px;cursor:pointer;">打开数据源页面</button>'
      : "";

    banner.innerHTML =
      '<div style="flex-shrink:0;font-size:18px;line-height:1;">⚠️</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:700;font-size:14px;">' + escapeHtml(meta.label) + " 暂时无法访问</div>" +
        '<div style="margin-top:2px;">' + escapeHtml(buildBody(source, payload.reason)) + "</div>" +
        detailHtml +
        '<div style="margin-top:8px;">' +
          openHtml +
          '<button type="button" data-role="close" style="margin-left:8px;padding:4px 10px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#92400e;font-size:12px;cursor:pointer;">知道了</button>' +
        "</div>" +
      "</div>";

    var closeBtn = banner.querySelector('[data-role="close"]');
    if (closeBtn) closeBtn.addEventListener("click", removeBanner);
    var openBtn = banner.querySelector('[data-role="open"]');
    if (openBtn) openBtn.addEventListener("click", function () { openUrl(payload.url); });

    document.body.appendChild(banner);
    _hideTimer = setTimeout(removeBanner, AUTO_HIDE_MS);
  }

  function report(payload) {
    if (!payload) return false;
    var source = normalizeSource(payload.source);
    if (!source) {
      console.warn("[DataSourceAlert] 未知数据源，忽略提醒:", payload.source);
      return false;
    }
    var now = Date.now();
    if (now - (_lastShownAt[source] || 0) < DEDUPE_MS) return false;
    _lastShownAt[source] = now;

    var normalized = {
      source: source,
      reason: payload.reason || "",
      detail: payload.detail ? String(payload.detail).slice(0, 240) : "",
      url: payload.url || "",
    };
    console.info("[DataSourceAlert]", normalized);
    try {
      showBanner(normalized);
    } catch (e) {
      console.warn("[DataSourceAlert] 渲染提醒失败:", e);
    }
    return true;
  }

  function init() {
    if (window.electronAPI && typeof window.electronAPI.onDataSourceIssue === "function") {
      window.electronAPI.onDataSourceIssue(function (payload) { report(payload); });
    }
  }

  window.PatentLensDataSourceAlerts = {
    report: report,
    _buildBody: buildBody,
    _sources: SOURCES,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
