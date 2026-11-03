/*!
 * PatentLens - 审查文档模式 GD Citation Data 标签页
 *
 * 在“审查文档”结果区新增「引用数据」标签页：
 *  - 按当前审查申请查询 GD Citation Data；
 *  - 复用 gd-citation-data.js 的抓取与渲染逻辑；
 *  - 引用专利号通过链接渲染，点击后复用 _openPdPatent，
 *    在原文模式新开标签页并走 GP 查询。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var loadedKey = "";
  var loading = false;

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

  function bodyEl() {
    return document.getElementById("citation-data-body");
  }

  function statusEl() {
    return document.getElementById("citation-status");
  }

  function setPlaceholder(text) {
    var body = bodyEl();
    if (body) body.innerHTML = '<div class="citation-empty-hint">' + text + "</div>";
  }

  function resetForNewData() {
    loadedKey = "";
    var status = statusEl();
    if (status) status.textContent = "";
    setPlaceholder("当前审查申请已更新，打开本标签页时会自动加载 GD Citation Data。");
  }

  async function ensureLoaded(force) {
    var body = bodyEl();
    if (!body) return;
    var ctx = getContext();
    if (!ctx) {
      setPlaceholder("请先查询审查文档，再加载 GD Citation Data。");
      return;
    }
    if (!force && loadedKey === ctx.key) return;
    if (loading) return;

    var api = window.PatentLensGdCitationData;
    if (!api || typeof api.fetchCitationData !== "function" || typeof api.renderCitationData !== "function") {
      setPlaceholder("GD Citation Data 模块未加载。");
      return;
    }

    loading = true;
    var status = statusEl();
    if (status) status.textContent = "加载中...";
    setPlaceholder("正在从 Global Dossier 获取 Citation Data...");

    try {
      var response = await api.fetchCitationData(ctx.office, ctx.candidates);
      api.renderCitationData(body, response);
      var citations = response && Array.isArray(response.citationList) ? response.citationList.length : 0;
      var npl = response && Array.isArray(response.nplCitationList) ? response.nplCitationList.length : 0;
      if (status) {
        status.textContent = citations || npl
          ? "专利文献 " + citations + " · NPL " + npl
          : "未获取到引用数据";
      }
      loadedKey = ctx.key;
    } catch (error) {
      setPlaceholder("GD Citation Data 获取失败：" + String((error && error.message) || error));
      if (status) status.textContent = "加载失败";
    } finally {
      loading = false;
    }
  }

  function wrapRenderOverview() {
    if (typeof window.renderOverview !== "function" || window.renderOverview.__dossierCitationWrapped) return;
    var original = window.renderOverview;
    var wrapped = function (data) {
      var result = original.apply(this, arguments);
      try {
        var ctx = getContext();
        if (!ctx || loadedKey !== ctx.key) resetForNewData();
        // 当前正停留在引用数据标签页时，随查询自动刷新
        var tab = document.getElementById("tab-citation");
        if (tab && tab.classList.contains("active")) {
          setTimeout(function () { ensureLoaded(true); }, 0);
        }
      } catch (_) {}
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
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
