/*!
 * PatentLens - 同族专利栏：说明书变动对比入口
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260822
 *
 * web-app.js 已冻结，本模块通过 DOM 增强方式在专利详情页的同族专利栏：
 *   1. 在同族表格每行公开号后注入勾选框（限选 2 个，勾选顺序：第一个为锚点）
 *   2. 在「转到智能比对分析同族」按钮旁注入「说明书变动对比」按钮
 *   3. 点击后跳转到智能比对 → 说明书变动定位特殊模式（comparison-specdiff.js）
 *
 * 覆盖 detail 主页面与 popup 弹层两个作用域（同族表格均由
 * renderPatentDetail / popup 渲染生成，MutationObserver 统一捕获）。
 */
var SpecDiffFamily = (function () {
  "use strict";

  var _observer = null;
  var _scheduled = false;
  var MAX_CHECK = 2;

  function esc(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function enhance() {
    // 所有含「转到智能比对分析同族」按钮的同族 section（detail + popup）
    document.querySelectorAll(".family-compare-btn").forEach(function (btn) {
      var section = btn.closest(".pd-section");
      if (!section || section.dataset.specDiffEnhanced === "1") return;
      var table = section.querySelector(".pd-legal-table");
      if (!table) return;

      // 表头追加「对比」列
      var theadRow = table.querySelector("thead tr");
      if (theadRow && !theadRow.querySelector(".specdiff-th")) {
        theadRow.insertAdjacentHTML("beforeend", '<th class="specdiff-th">对比</th>');
      }

      // 每行注入勾选框
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        if (tr.querySelector(".specdiff-check-cell")) return;
        var link = tr.querySelector(".pd-patent-link");
        var pn = link ? (link.dataset.patent || "") : "";
        tr.insertAdjacentHTML(
          "beforeend",
          '<td class="specdiff-check-cell"><input type="checkbox" class="specdiff-fam-cb" data-pn="' +
            esc(pn) + '" onchange="SpecDiffFamily.onToggle(this)" title="勾选两个公开号进行说明书变动对比（先勾选的作为锚点）"></td>'
        );
      });

      // 标题栏追加按钮
      if (!section.querySelector(".spec-diff-family-btn")) {
        btn.insertAdjacentHTML(
          "afterend",
          '<button class="family-compare-btn spec-diff-family-btn" onclick="SpecDiffFamily.compare(this)" ' +
            'title="勾选同族表格中的两个公开号，跳转到智能比对定位说明书变动点">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>说明书变动对比</button>'
        );
      }

      section.dataset.specDiffEnhanced = "1";
    });
  }

  function _scheduleEnhance() {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(function () {
      _scheduled = false;
      try { enhance(); } catch (e) { console.warn("[SpecDiffFamily] enhance failed:", e); }
    });
  }

  // 勾选限制：最多 2 个（ onchange 内联调用 ）
  function onToggle(cb) {
    if (!cb) return true;
    var section = cb.closest(".pd-section") || document;
    var checked = section.querySelectorAll(".specdiff-fam-cb:checked");
    if (checked.length > MAX_CHECK) {
      cb.checked = false;
      alert("说明书变动对比最多勾选 " + MAX_CHECK + " 个公开号（第一个勾选的作为锚点）");
      return false;
    }
    return true;
  }

  function compare(btnEl) {
    var section = btnEl ? btnEl.closest(".pd-section") : document;
    var checked = Array.prototype.slice.call(section.querySelectorAll(".specdiff-fam-cb:checked"));
    if (checked.length !== 2) {
      alert("请先在同族表格中勾选正好 2 个公开号（先勾选的作为锚点），再进行说明书变动对比");
      return;
    }
    var anchorNum = checked[0].dataset.pn;
    var compareNum = checked[1].dataset.pn;
    if (!anchorNum || !compareNum) {
      alert("勾选的公开号无效，请重试");
      return;
    }

    // 切换到智能比对模式（与 goToPatentDetailFamilyComparison 相同的入口方式）
    document.querySelectorAll(".search-mode-btn").forEach(function (b) { b.classList.remove("active"); });
    var cmpBtn = document.querySelector('.search-mode-btn[data-mode="comparison"]');
    if (cmpBtn) cmpBtn.classList.add("active");
    if (cmpBtn) cmpBtn.click();

    // comparison section 渲染完成后进入说明书变动定位模式并自动运行
    setTimeout(function () {
      if (typeof ComparisonSpecDiff === "undefined") {
        alert("说明书变动定位模块未加载");
        return;
      }
      ComparisonSpecDiff.enterWithPatents(anchorNum, compareNum);
      var sectionEl = document.getElementById("comparison-section");
      if (sectionEl) sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  }

  function init() {
    if (_observer) return;
    if (typeof MutationObserver !== "function") return;
    _observer = new MutationObserver(_scheduleEnhance);
    _observer.observe(document.body, { childList: true, subtree: true });
    _scheduleEnhance();
  }

  return {
    init: init,
    compare: compare,
    onToggle: onToggle
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", SpecDiffFamily.init);
} else {
  SpecDiffFamily.init();
}
