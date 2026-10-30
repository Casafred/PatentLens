/*!
 * PatentLens - 审查文档查询失败重试提示
 *
 * 目的：
 *   审查文档列表查询因网络波动、EPO 限流/人机验证等原因失败时，
 *   在结果区顶部显示一条可操作提示，并提供「重试一次」按钮。
 *   多数情况下立即重试即可成功，避免用户只能手动重新输入专利号查询。
 *
 * 实现方式：
 *   web-app.js 中的 doSearch 为经典脚本全局函数，本模块在其加载后包裹一层，
 *   查询完成后检查新 currentData.warnings 中是否包含「文档列表查询失败」。
 *   不向 web-app.js 增加任何代码（该文件已冻结）。
 */
(function () {
  "use strict";

  if (typeof window.doSearch !== "function") return;

  var originalDoSearch = window.doSearch;
  var retryInput = "";
  var retrying = false;

  function ensureBanner() {
    var main = document.querySelector(".result-main");
    if (!main) return null;
    var banner = document.getElementById("search-retry-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "search-retry-banner";
      banner.className = "search-retry-banner hidden";
      banner.innerHTML =
        '<div class="search-retry-text"></div>' +
        '<div class="search-retry-actions">' +
          '<button type="button" class="btn-primary btn-small search-retry-btn">重试一次</button>' +
          '<button type="button" class="search-retry-dismiss" title="关闭提示">&times;</button>' +
        '</div>';
      main.insertBefore(banner, main.firstChild);
    }
    return banner;
  }

  function hideBanner() {
    var banner = document.getElementById("search-retry-banner");
    if (banner) banner.classList.add("hidden");
  }

  function bindBannerActions(banner) {
    if (banner._retryBound) return;
    banner._retryBound = true;
    var retryBtn = banner.querySelector(".search-retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        if (retrying || !retryInput) return;
        retrying = true;
        retryBtn.disabled = true;
        retryBtn.textContent = "重试中…";
        hideBanner();
        // 直接复用当前查询流程，保留标签页与输入框内容
        window.doSearch(retryInput);
      });
    }
    var dismissBtn = banner.querySelector(".search-retry-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", hideBanner);
    }
  }

  function showBanner(message, input) {
    var banner = ensureBanner();
    if (!banner) return;
    retryInput = input || retryInput;
    bindBannerActions(banner);
    var textEl = banner.querySelector(".search-retry-text");
    if (textEl) textEl.textContent = message;
    var retryBtn = banner.querySelector(".search-retry-btn");
    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.textContent = "重试一次";
    }
    banner.classList.remove("hidden");
  }

  function getDocListFailure(data) {
    if (!data || !Array.isArray(data.warnings)) return "";
    for (var i = 0; i < data.warnings.length; i++) {
      var w = String(data.warnings[i] || "");
      if (/文档列表查询失败/.test(w)) {
        return w.replace(/^文档列表查询失败\s*[:：]\s*/, "");
      }
    }
    return "";
  }

  window.doSearch = async function (input, options) {
    var silent = !!(options && options.silent);
    hideBanner();
    retrying = false;
    var prevData = (typeof currentData !== "undefined") ? currentData : null;
    try {
      await originalDoSearch.call(this, input, options);
    } finally {
      retrying = false;
      var btn = document.querySelector("#search-retry-banner .search-retry-btn");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重试一次";
      }
    }
    if (silent) return;
    var nextData = (typeof currentData !== "undefined") ? currentData : null;
    // 只有本次查询生成了新的 currentData 才检查，避免沿用上一次的旧警告
    if (!nextData || nextData === prevData) return;
    var reason = getDocListFailure(nextData);
    if (!reason) return;
    showBanner("审查文档获取失败：" + reason + "。请点击右侧按钮重试一次。", input);
  };

  // PDF 原文加载失败（网络抖动 / EPO documentView 限流等）同样给出重试按钮。
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
