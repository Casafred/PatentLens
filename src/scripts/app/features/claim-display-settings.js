/*!
 * PatentLens - 权利要求从权默认展开/收起（全局阅读偏好）
 *
 * 专利详情页的权利要求由 renderClaimsListHtml 渲染，默认折叠从属权利要求。
 * 该模块根据设置统一控制所有详情页/弹窗的默认展开状态，新渲染的列表也会自动应用。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var STORAGE_KEY = "patentlens_claims_expanded_default";
  var APPLIED_FLAG = "claimsDefaultApplied";

  function storageGet() {
    try { return window.localStorage.getItem(STORAGE_KEY) === "true"; } catch (_) { return false; }
  }

  function storageSet(value) {
    try { window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false"); } catch (_) {}
  }

  function claimGroups(list) {
    return list.querySelectorAll(".pd-claim-group");
  }

  function syncGroupControls(group, expanded) {
    var countBtn = group.querySelector(".pd-claim-dependent-count");
    var collapseBtn = group.querySelector(".pd-claim-collapse-btn");
    if (countBtn) {
      var count = group.querySelectorAll(".pd-claim-dependents .pd-claim-item").length;
      countBtn.style.display = expanded ? "none" : "";
      var span = countBtn.querySelector("span");
      if (span) span.textContent = "点击展开 " + count + " 项从属权利要求 ▼";
    }
    if (collapseBtn) collapseBtn.style.display = expanded ? "" : "none";
  }

  function syncExpandButton(list, expanded) {
    var panel = list.closest(".pd-tab-panel");
    var button = panel && panel.querySelector(".pd-claim-expand-btn");
    if (!button) return;
    button.innerHTML = expanded
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>收起全部从权'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>展开全部从权';
  }

  function applyList(list, expanded, force) {
    if (!list || !list.querySelector(".pd-claim-group")) return;
    var target = expanded ? "expanded" : "collapsed";
    if (!force && list.dataset[APPLIED_FLAG] === target) return;
    list.dataset[APPLIED_FLAG] = target;

    var groups = claimGroups(list);
    if (expanded) {
      list.classList.add("expanded-all");
      for (var i = 0; i < groups.length; i++) {
        groups[i].classList.add("expanded");
        syncGroupControls(groups[i], true);
      }
    } else {
      list.classList.remove("expanded-all");
      for (var j = 0; j < groups.length; j++) {
        groups[j].classList.remove("expanded");
        syncGroupControls(groups[j], false);
      }
    }
    syncExpandButton(list, expanded);
  }

  function applyAll(expanded, force) {
    document.querySelectorAll(".pd-claims-list").forEach(function (list) {
      applyList(list, expanded, force);
    });
  }

  function applyNewLists() {
    if (!storageGet()) return;
    document.querySelectorAll(".pd-claims-list").forEach(function (list) {
      if (list.dataset[APPLIED_FLAG] !== "expanded") applyList(list, true, false);
    });
  }

  function syncCheckbox() {
    var checkbox = document.getElementById("claims-default-expanded-checkbox");
    if (checkbox) checkbox.checked = storageGet();
  }

  function init() {
    syncCheckbox();
    // 设置项即时生效，无需额外保存按钮
    document.addEventListener("change", function (event) {
      if (event.target && event.target.id === "claims-default-expanded-checkbox") {
        var expanded = !!event.target.checked;
        storageSet(expanded);
        applyAll(expanded, true);
      }
    });
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.closest && (target.closest("#ai-settings-btn") || target.closest('[data-settings-tab="reading"]'))) {
        setTimeout(syncCheckbox, 0);
      }
    });
    // 详情页/弹窗的权利要求列表会反复重建，新增列表时自动套用设置
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled || !storageGet()) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        applyNewLists();
      });
    }).observe(document.body, { childList: true, subtree: true });
    applyNewLists();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
