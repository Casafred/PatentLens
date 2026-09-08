/*!
 * PatentLens - 专利原文标签栏目状态
 *
 * 原文详情区共用一份 DOM。切换专利标签时详情会重新渲染，
 * 因此栏目选择必须按专利号保存，不能依赖 renderPatentDetail 的默认 active 标记。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (typeof window.switchPatentTab !== "function" || typeof window.renderPatentDetail !== "function") return;

  var VALID_TABS = { overview: true, claims: true, description: true, references: true };
  var tabByPatent = Object.create(null);

  function normalizePatentKey(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s\/]/g, "");
  }

  function patentKeyFromData(data) {
    if (!data) return "";
    return normalizePatentKey(data.patent_number || data.publication_number || data.raw || "");
  }

  function activePatentKey() {
    // _pdActivePatent is the authoritative key during a detail-tab switch,
    // before _currentPatentData is updated by the caller.
    try {
      if (typeof _pdActivePatent !== "undefined" && _pdActivePatent) {
        return normalizePatentKey(_pdActivePatent);
      }
    } catch (_) {}
    try {
      return patentKeyFromData(window._currentPatentData);
    } catch (_) {
      return "";
    }
  }

  function readActiveTab() {
    var layout = document.querySelector("#patent-detail-content .pd-tab-layout");
    if (!layout) return "";
    var active = layout.querySelector(".pd-bookmark-tab.active");
    var tabName = active && active.dataset ? active.dataset.tab : "";
    return VALID_TABS[tabName] ? tabName : "";
  }

  function applyTab(tabName) {
    if (!VALID_TABS[tabName]) tabName = "overview";
    var layout = document.querySelector("#patent-detail-content .pd-tab-layout");
    if (!layout) return;
    layout.querySelectorAll(".pd-bookmark-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    layout.querySelectorAll(".pd-tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.dataset.panel === tabName);
    });
  }

  var originalSwitchPatentTab = window.switchPatentTab;
  window.switchPatentTab = function (tabName) {
    var key = activePatentKey();
    if (key && VALID_TABS[tabName]) tabByPatent[key] = tabName;
    return originalSwitchPatentTab.apply(this, arguments);
  };

  var originalRenderPatentDetail = window.renderPatentDetail;
  window.renderPatentDetail = function (data) {
    var key = patentKeyFromData(data) || activePatentKey();
    var result = originalRenderPatentDetail.apply(this, arguments);
    if (key) applyTab(tabByPatent[key] || "overview");
    return result;
  };

  // _renderPdTabs binds its close handler to a lexical function, so observe
  // the dynamic close click during capture to discard the matching state.
  var patentTabsBar = document.getElementById("patent-detail-tabs-bar");
  if (patentTabsBar) {
    patentTabsBar.addEventListener("click", function (event) {
      var close = event.target && event.target.closest ? event.target.closest(".pdt-tab-close") : null;
      var tab = close && close.closest ? close.closest(".pdt-tab") : null;
      var label = tab && tab.querySelector ? tab.querySelector(".pdt-tab-label") : null;
      if (label) delete tabByPatent[normalizePatentKey(label.textContent)];
    }, true);
  }

  window.PatentDetailTabState = {
    get: function (patentNumber) {
      return tabByPatent[normalizePatentKey(patentNumber)] || "overview";
    },
    set: function (patentNumber, tabName) {
      var key = normalizePatentKey(patentNumber);
      if (key && VALID_TABS[tabName]) tabByPatent[key] = tabName;
    },
    readActive: readActiveTab,
  };
})();
