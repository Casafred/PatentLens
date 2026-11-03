/*!
 * PatentLens - 历史记录跨模式查询入口
 *
 * 不改变历史条目默认点击行为，只在条目内追加一个次要操作：
 *  - GP 原文历史 → 「查审查文档」，打开对应审查文档标签页；
 *  - 审查文档历史 → 「查GP原文」，在专利原文模式打开 GP 查询。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function decorate() {
    var list = document.getElementById("history-list");
    if (!list) return;
    if (list.classList.contains("select-mode")) return;

    list.querySelectorAll(".history-item").forEach(function (item) {
      var patentNumber = item.dataset ? item.dataset.patent : "";
      var type = item.dataset ? item.dataset.type : "";
      if (!patentNumber || !type) return;
      if (item.querySelector(".history-item-alt-actions")) return;

      var main = item.querySelector(".history-item-main");
      if (!main) return;

      var label = type === "patent" ? "查审查文档" : "查GP原文";
      var wrap = document.createElement("div");
      wrap.className = "history-item-alt-actions";

      var button = document.createElement("button");
      button.type = "button";
      button.className = "history-item-alt-btn";
      button.textContent = label;
      button.title = type === "patent"
        ? "在审查文档模式查询该专利"
        : "在专利原文模式（GP）查询该专利";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (type === "patent") {
          if (typeof window.restoreFromHistory === "function") {
            window.restoreFromHistory(patentNumber);
          } else if (typeof window.doRestoreFromHistory === "function") {
            window.doRestoreFromHistory(patentNumber);
          }
          return;
        }
        if (typeof window._openPdPatent === "function") {
          window._openPdPatent(patentNumber);
        }
      });

      wrap.appendChild(button);
      main.appendChild(wrap);
    });
  }

  function wrapRefreshHistoryList() {
    if (typeof window.refreshHistoryList !== "function" || window.refreshHistoryList.__historyAltWrapped) return;
    var original = window.refreshHistoryList;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      try { decorate(); } catch (_) {}
      return result;
    };
    wrapped.__historyAltWrapped = true;
    window.refreshHistoryList = wrapped;
  }

  function observeHistoryList() {
    var list = document.getElementById("history-list");
    if (!list || typeof MutationObserver !== "function") return;
    new MutationObserver(function () {
      try { decorate(); } catch (_) {}
    }).observe(list, { childList: true, subtree: false, attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    wrapRefreshHistoryList();
    observeHistoryList();
    decorate();
  }

  window.PatentLensHistoryAltActions = { refresh: decorate };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
