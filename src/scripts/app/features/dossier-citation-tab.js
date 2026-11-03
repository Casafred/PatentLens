/*!
 * PatentLens - 审查文档模式 GD Citation Data 标签页
 *
 * 在“审查文档”结果区新增「引用数据」标签页：
 *  - 按当前审查申请查询 GD Citation Data；
 *  - 复用 gd-citation-data.js 的抓取与渲染逻辑；
 *  - 按审查文档标签页缓存结果，切换标签后再次回到引用数据无需重新请求；
 *  - 引用专利号通过链接渲染，点击后复用 _openPdPatent，
 *    在原文模式新开标签页并走 GP 查询。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var MAX_CACHE = 12;
  var cache = Object.create(null); // key -> { response, loadedAt }
  var loadingKeys = Object.create(null);

  function getContext() {
    var data = null;
    try {
      if (typeof currentData !== "undefined") data = currentData;
    } catch (_) {}
    if (!data && window.currentData) data = window.currentData;
    if (!data) return null;

    var office = String(data.office || "").toUpperCase();
    var appNum = String(data.applicationNumber || data.docNumber || "").replace(/[\s\/]/g, "");
    if (!office || !appNum) return null;

    var parsed = null;
    try {
      if (typeof window.parsePatentNumber === "function" && data.raw) {
        parsed = window.parsePatentNumber(data.raw);
      }
    } catch (_) {}

    var kindCode = String(data.kindCode || (parsed && parsed.kindCode) || "A").toUpperCase();
    var docNumber = String(data.docNumber || data.documents && data.documents.docNumber || "").replace(/[\s\/]/g, "");

    var candidates = [
      { type: "application", docNumber: appNum, kindCode: kindCode },
    ];
    if (parsed) {
      if (parsed.queryType && parsed.queryType !== "application") {
        candidates.push({
          type: parsed.queryType,
          docNumber: String(parsed.applicationNumber || "").replace(/[\s\/]/g, ""),
          kindCode: String(parsed.kindCode || kindCode).toUpperCase(),
        });
      }
      candidates.push({
        type: "publication",
        docNumber: String(parsed.applicationNumber || "").replace(/[\s\/]/g, ""),
        kindCode: String(parsed.kindCode || kindCode).toUpperCase(),
      });
      candidates.push({
        type: "patent",
        docNumber: String(parsed.applicationNumber || "").replace(/[\s\/]/g, ""),
        kindCode: String(parsed.kindCode || kindCode).toUpperCase(),
      });
    }
    if (docNumber && docNumber !== appNum) {
      candidates.push({ type: "publication", docNumber: docNumber, kindCode: kindCode });
    }

    return {
      key: office + "/" + appNum + "/" + kindCode,
      office: office,
      appNum: appNum,
      candidates: candidates,
    };
  }

  function activeDossierKey() {
    try {
      if (typeof _dossierActiveKey !== "undefined" && _dossierActiveKey) {
        return String(_dossierActiveKey);
      }
    } catch (_) {}
    return "";
  }

  function cacheKeyFor(ctx) {
    return activeDossierKey() + "::" + ctx.key;
  }

  function bodyEl() {
    return document.getElementById("citation-data-body");
  }

  function statusEl() {
    return document.getElementById("citation-status");
  }

  function citationTabActive() {
    var tab = document.getElementById("tab-citation");
    return !!(tab && tab.classList.contains("active"));
  }

  function setPlaceholder(text) {
    var body = bodyEl();
    if (body) body.innerHTML = '<div class="citation-empty-hint">' + text + "</div>";
  }

  function setStatus(text) {
    var status = statusEl();
    if (status) status.textContent = text;
  }

  function countsOf(response) {
    return {
      citations: response && Array.isArray(response.citationList) ? response.citationList.length : 0,
      npl: response && Array.isArray(response.nplCitationList) ? response.nplCitationList.length : 0,
    };
  }

  function statusFor(response) {
    var counts = countsOf(response);
    return counts.citations || counts.npl
      ? "专利文献 " + counts.citations + " · NPL " + counts.npl
      : "未获取到引用数据";
  }

  function renderResponse(response) {
    var body = bodyEl();
    var api = window.PatentLensGdCitationData;
    if (!body || !api || typeof api.renderCitationData !== "function") return;
    api.renderCitationData(body, response);
    setStatus(statusFor(response));
  }

  function pruneCache() {
    var keys = Object.keys(cache);
    if (keys.length <= MAX_CACHE) return;
    keys.sort(function (a, b) {
      return (cache[a].loadedAt || 0) - (cache[b].loadedAt || 0);
    });
    keys.slice(0, keys.length - MAX_CACHE).forEach(function (key) {
      delete cache[key];
    });
  }

  function syncForCurrentTab() {
    var ctx = getContext();
    if (!ctx) {
      setStatus("");
      setPlaceholder("请先查询审查文档，再加载 GD Citation Data。");
      return;
    }
    var key = cacheKeyFor(ctx);
    var entry = cache[key];
    if (entry) {
      renderResponse(entry.response);
      return;
    }
    if (loadingKeys[key]) return;
    setStatus("");
    setPlaceholder("打开本标签页时自动加载当前审查申请的 GD Citation Data。");
    if (citationTabActive()) {
      setTimeout(function () { ensureLoaded(false); }, 0);
    }
  }

  async function ensureLoaded(force) {
    var body = bodyEl();
    if (!body) return;
    var ctx = getContext();
    if (!ctx) {
      setPlaceholder("请先查询审查文档，再加载 GD Citation Data。");
      return;
    }

    var key = cacheKeyFor(ctx);
    if (!force && cache[key]) {
      renderResponse(cache[key].response);
      return;
    }

    var api = window.PatentLensGdCitationData;
    if (!api || typeof api.fetchCitationData !== "function" || typeof api.renderCitationData !== "function") {
      setPlaceholder("GD Citation Data 模块未加载。");
      return;
    }
    if (loadingKeys[key]) return;

    loadingKeys[key] = true;
    setStatus("加载中...");
    setPlaceholder("正在从 Global Dossier 获取 Citation Data...");

    try {
      var response = await api.fetchCitationData(ctx.office, ctx.candidates);
      cache[key] = { response: response, loadedAt: Date.now() };
      pruneCache();
      // 用户可能已经切换到其他审查文档标签：只缓存，不覆盖当前页面
      var current = getContext();
      if (current && cacheKeyFor(current) === key) {
        renderResponse(response);
      }
    } catch (error) {
      var currentOnError = getContext();
      if (currentOnError && cacheKeyFor(currentOnError) === key) {
        setPlaceholder("GD Citation Data 获取失败：" + String((error && error.message) || error));
        setStatus("加载失败");
      }
    } finally {
      delete loadingKeys[key];
    }
  }

  function wrapRenderOverview() {
    if (typeof window.renderOverview !== "function" || window.renderOverview.__dossierCitationWrapped) return;
    var original = window.renderOverview;
    var wrapped = function (data) {
      var result = original.apply(this, arguments);
      try { syncForCurrentTab(); } catch (_) {}
      return result;
    };
    wrapped.__dossierCitationWrapped = true;
    window.renderOverview = wrapped;
  }

  function bind() {
    var tabBtn = document.querySelector('.tab-btn[data-tab="citation"]');
    if (tabBtn && !tabBtn.dataset.dossierCitationBound) {
      tabBtn.dataset.dossierCitationBound = "1";
      tabBtn.addEventListener("click", function () {
        try {
          var app = document.getElementById("app");
          if (app) app.classList.add("wide-layout");
        } catch (_) {}
        setTimeout(function () { ensureLoaded(false); }, 0);
      });
    }

    var refreshBtn = document.getElementById("citation-refresh-btn");
    if (refreshBtn && !refreshBtn.dataset.dossierCitationBound) {
      refreshBtn.dataset.dossierCitationBound = "1";
      refreshBtn.addEventListener("click", function () {
        ensureLoaded(true);
      });
    }

    // 兼容通过 _dossierApplyTab 程序化切换标签页（不会触发 tab 按钮 click）
    var tabContent = document.getElementById("tab-citation");
    if (tabContent && typeof MutationObserver === "function" && !tabContent.dataset.dossierCitationObserved) {
      tabContent.dataset.dossierCitationObserved = "1";
      new MutationObserver(function () {
        if (!tabContent.classList.contains("active")) return;
        try {
          var app = document.getElementById("app");
          if (app) app.classList.add("wide-layout");
        } catch (_) {}
        setTimeout(function () { ensureLoaded(false); }, 0);
      }).observe(tabContent, { attributes: true, attributeFilter: ["class"] });
    }

    setPlaceholder("打开本标签页时自动加载当前审查申请的 GD Citation Data。");
  }

  function init() {
    wrapRenderOverview();
    bind();
  }

  window.PatentLensDossierCitation = {
    refresh: function () { return ensureLoaded(true); },
    getContext: getContext,
    clearCache: function () { cache = Object.create(null); },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
