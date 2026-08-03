/*!
 * PatentLens - 审查意见阅读器左侧文档列表排序增强
 * Copyright (c) 2026 Alfred Shi. All rights reserved. PROPRIETARY/CONFIDENTIAL.
 *
 * 作用：将「审查意见阅读器」最左侧的审查文档列表按日期倒序排列
 * （最新文档在最上面），「AI 分析报告」项固定保持在列表底部。
 *
 * 实现方式：作为独立特性模块在 web-app.js 之后加载，通过 MutationObserver
 * 监听 #reader-doc-list 的子节点变化，在 web-app.js 的 openReader() 重新渲染
 * 列表后对 DOM 子节点重排。不修改 web-app.js（已冻结），不改变数据源
 * kanbanState.documents 的顺序，仅改变阅读器左侧栏的展示顺序。
 * 日期解析复用 app/shared/dates.js 的全局 parseDocDateToTimestamp。
 */
(function () {
  "use strict";

  var DOC_LIST_ID = "reader-doc-list";
  var DOC_ITEM_SEL = ".reader-doc-item";
  var DATE_SEL = ".doc-item-date";
  var ANALYSIS_ACTION = "reader-select-analysis"; // AI 分析报告项的 data-action

  // 兜底日期解析：若全局 parseDocDateToTimestamp 不可用则按字符串比较
  function dateTs(text) {
    if (typeof parseDocDateToTimestamp === "function") {
      return parseDocDateToTimestamp(text);
    }
    return String(text || "").trim();
  }

  function dateTsOfItem(item) {
    var el = item.querySelector(DATE_SEL);
    return dateTs(el ? el.textContent : "");
  }

  // 计算期望顺序：文档按日期倒序（最新在上），分析报告项置底
  function desiredOrder(items) {
    var docs = [];
    var pinned = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.dataset && it.dataset.action === ANALYSIS_ACTION) {
        pinned.push(it);
      } else {
        docs.push(it);
      }
    }
    docs.sort(function (a, b) {
      var ta = dateTsOfItem(a);
      var tb = dateTsOfItem(b);
      // 倒序：tb - ta（数值）或字符串倒序
      if (typeof ta === "number" && typeof tb === "number") {
        return tb - ta;
      }
      return ta < tb ? 1 : (ta > tb ? -1 : 0);
    });
    return docs.concat(pinned);
  }

  function currentItems(container) {
    return Array.prototype.slice.call(container.querySelectorAll(DOC_ITEM_SEL));
  }

  function isSorted(container) {
    var items = currentItems(container);
    var desired = desiredOrder(items);
    if (desired.length !== items.length) return true; // 异常情况下不强行重排
    for (var i = 0; i < items.length; i++) {
      if (items[i] !== desired[i]) return false;
    }
    return true;
  }

  function reorder(container) {
    var items = currentItems(container);
    if (items.length === 0) return;
    var desired = desiredOrder(items);
    var changed = false;
    for (var i = 0; i < desired.length; i++) {
      if (items[i] !== desired[i]) { changed = true; break; }
    }
    if (!changed) return;
    // 按期望顺序重新追加（移动节点，保留每个元素上的 class/dataset/事件）
    for (var j = 0; j < desired.length; j++) {
      container.appendChild(desired[j]);
    }
  }

  function install() {
    var container = document.getElementById(DOC_LIST_ID);
    if (!container) return;
    if (container._readerDocListSortInstalled) return;
    container._readerDocListSortInstalled = true;

    // 首次排序（列表可能已渲染）
    reorder(container);

    // web-app.js 的 openReader() 通过 innerHTML 重建列表时触发重排
    var observer = new MutationObserver(function () {
      if (isSorted(container)) return; // 已有序则不写 DOM，避免循环
      reorder(container);
    });
    observer.observe(container, { childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
