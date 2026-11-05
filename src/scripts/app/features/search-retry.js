/*!
 * PatentLens - 查询失败提示与重新查询
 *
 * 目标：
 *   1. 查询失败不再弹出需要手动确认的重试对话框，改为自动消失的通知条；
 *      通知消失后，用户直接再次点击「查询」即可重新触发查询。
 *   2. 查询失败后仍残留的空标签页不会拦截下一次查询：再次输入同一专利号时，
 *      会关闭该失败标签并重新发起查询，而不是只切换到空标签页。
 *
 * 实现方式（不向 web-app.js 增加任何代码，该文件已冻结）：
 *   - 在 doSearch 执行期间拦截其内部的原生 confirm("查询失败…重试")，返回 false，
 *     让 web-app.js 走已有的 showError() 自动消失通知分支。
 *   - 包裹 _dossierNewTabFromSearch / _promptCacheChoice，识别「文档列表查询失败」
 *     或没有数据的标签页，允许重新查询。
 */
(function () {
  "use strict";

  function isDocListFailure(data) {
    if (!data || !Array.isArray(data.warnings)) return false;
    for (var i = 0; i < data.warnings.length; i++) {
      if (/文档列表查询失败/.test(String(data.warnings[i] || ""))) return true;
    }
    return false;
  }

  // 失败标签：没有查询结果，或上次查询明确失败在文档列表阶段。
  function isFailedTab(tab) {
    if (!tab) return false;
    if (!tab.currentData) return true;
    return isDocListFailure(tab.currentData);
  }

  function findFailedTab(key) {
    try {
      if (typeof _dossierTabs === "undefined" || !Array.isArray(_dossierTabs)) return null;
      for (var i = 0; i < _dossierTabs.length; i++) {
        if (_dossierTabs[i].key === key && isFailedTab(_dossierTabs[i])) return _dossierTabs[i];
      }
    } catch (_) {}
    return null;
  }

  function resolveTabKey(input) {
    try {
      if (typeof parsePatentNumber !== "function" || typeof _dossierMakeKey !== "function") return "";
      var pn = parsePatentNumber(input);
      if (!pn) return "";
      var rawPn = pn.raw || String(input).trim().toUpperCase().replace(/[\s\/]/g, "");
      if (typeof isJPPatent === "function" && isJPPatent(rawPn)) return "";
      if (typeof isCNPatent === "function" && isCNPatent(rawPn)) return "";
      return _dossierMakeKey(rawPn);
    } catch (_) {
      return "";
    }
  }

  // ── 1. 把查询失败的原生 confirm 变成自动消失的通知条 ──
  if (typeof window.doSearch === "function") {
    var originalDoSearch = window.doSearch;
    window.doSearch = async function (input, options) {
      var previousConfirm = window.confirm;
      window.confirm = function (message) {
        var text = String(message || "");
        // web-app.js 的查询失败提示：确认=重试。这里返回 false，转入 showError()，
        // 通知条 5 秒后自动消失，用户可直接再次点击查询。
        if (/查询失败/.test(text) && /重试/.test(text)) return false;
        return previousConfirm.apply(this, arguments);
      };
      try {
        return await originalDoSearch.call(this, input, options);
      } finally {
        window.confirm = previousConfirm;
      }
    };
  }

  // ── 2. 失败标签页允许重新查询 ──
  function installFailedTabRequery() {
    if (typeof window._dossierNewTabFromSearch !== "function") return;
    if (window._dossierNewTabFromSearch.__plFailedTabRequery) return;

    var originalNewTab = window._dossierNewTabFromSearch;
    var wrapped = function (input) {
      var key = resolveTabKey(input);
      if (key && findFailedTab(key)) {
        // 关闭失败标签（它没有可丢失的文档/标注），让原逻辑重新创建并查询。
        try {
          if (typeof window._dossierCloseTabByKey === "function") {
            window._dossierCloseTabByKey(key);
          } else if (typeof _dossierTabs !== "undefined") {
            var failed = findFailedTab(key);
            if (failed) _dossierTabs.splice(_dossierTabs.indexOf(failed), 1);
          }
        } catch (_) {}
      }
      return originalNewTab.apply(this, arguments);
    };
    wrapped.__plFailedTabRequery = true;
    window._dossierNewTabFromSearch = wrapped;
  }

  // 失败后的再次查询应直接走网络，而不是先弹「发现本地缓存」选择框。
  function installFailedTabCacheBypass() {
    if (typeof window._promptCacheChoice !== "function") return;
    if (window._promptCacheChoice.__plFailedTabBypass) return;

    var originalPrompt = window._promptCacheChoice;
    var wrapped = async function (cacheKey) {
      if (findFailedTab(cacheKey)) return { choice: "reload", entry: null };
      return originalPrompt.apply(this, arguments);
    };
    wrapped.__plFailedTabBypass = true;
    window._promptCacheChoice = wrapped;
  }

  function installDossierRequery() {
    installFailedTabRequery();
    installFailedTabCacheBypass();
  }

  // 等 cache-choice-dialog 等后续模块完成初始化后再包裹，避免被它们覆盖。
  function scheduleDossierRequery() {
    setTimeout(installDossierRequery, 0);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleDossierRequery, { once: true });
  } else {
    scheduleDossierRequery();
  }

  // ── 3. PDF 原文加载失败：保留重试按钮（只重试当前文档加载） ──
  if (typeof window.renderPdfView === "function") {
    var originalRenderPdfView = window.renderPdfView;
    window.renderPdfView = async function (idx) {
      var result = await originalRenderPdfView.call(this, idx);
      var container = document.getElementById("reader-pdf-container");
      var errorEl = container && container.querySelector(".pdf-error");
      if (!errorEl || errorEl.querySelector(".pdf-retry-btn")) return result;
      if (/未找到文档信息/.test(errorEl.textContent || "")) return result;
      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-secondary btn-small pdf-retry-btn";
      retryBtn.textContent = "重试加载";
      retryBtn.style.marginTop = "10px";
      retryBtn.addEventListener("click", function () {
        retryBtn.disabled = true;
        retryBtn.textContent = "重试中…";
        window.renderPdfView(idx);
      });
      errorEl.appendChild(document.createElement("br"));
      errorEl.appendChild(retryBtn);
      return result;
    };
  }
})();
