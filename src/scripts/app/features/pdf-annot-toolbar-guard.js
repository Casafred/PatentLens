/*!
 * PatentLens - PDF 标注多选工具栏守卫
 *
 * web-app.js 的 selectAnnotsInRect 在框选结束时会无条件调用
 * showAnnotMultiToolbar，即使框中没有任何标注（页面上本来就没有标注）也会
 * 弹出“已选 0 个标注”的工具栏。这里在不修改冻结的 web-app.js 的前提下，
 * 为 showAnnotMultiToolbar 增加空选择守卫：没有选中标注时只隐藏旧工具栏。
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__plAnnotToolbarGuardInstalled) return;
  window.__plAnnotToolbarGuardInstalled = true;

  var originalShow = typeof window.showAnnotMultiToolbar === "function"
    ? window.showAnnotMultiToolbar
    : null;
  if (!originalShow) return;

  function selectedAnnotIds() {
    try {
      // pdfViewState 是 web-app.js 的顶层 let，不会挂到 window 上，
      // 只能通过全局词法作用域读取。
      if (typeof pdfViewState !== "undefined" && pdfViewState && pdfViewState.selectedAnnotIds) {
        return pdfViewState.selectedAnnotIds;
      }
    } catch (_) {}
    return [];
  }

  window.showAnnotMultiToolbar = function () {
    if (!selectedAnnotIds().length) {
      var stale = document.getElementById("pdf-annot-multi-toolbar");
      if (stale) stale.classList.add("hidden");
      return;
    }
    return originalShow.apply(this, arguments);
  };
})();
