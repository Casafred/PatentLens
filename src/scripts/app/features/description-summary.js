/*!
 * PatentLens - 说明书实施例总结快捷按钮
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260822
 *
 * web-app.js 已冻结，本模块通过 DOM 增强方式在专利详情页（detail 主页面
 * 与 popup 弹层共用同一面板结构）实现：
 *   1. 说明书面板操作区（.pd-panel-actions）注入「实施例总结」按钮
 *   2. 点击后将说明书内容送入 AI，总结：
 *      - 说明书整体结构各主要部分摘要（技术领域/背景/发明内容/实施方式…）
 *      - 是否有多个并列实施例，如有则逐个总结
 *   3. 结果呈现在说明书顶部区域（.pd-desc-summary-panel，可折叠/关闭）
 *   4. 溯源：AI 输出中的段落号引用 [00XX] 自动转为可点击标签，
 *      点击跳转滚动到说明书对应段落并高亮闪烁印证
 *   5. 结果按公开号缓存到 localStorage
 */
var DescriptionSummary = (function () {
  "use strict";

  var _observer = null;
  var _scheduled = false;
  var _running = {};      // scope → bool，防止重复触发
  var CACHE_PREFIX = "patentlens-desc-summary-";
  var MAX_DESC_CHARS = 80000;

  // ── 工具 ─────────────────────────────────────────────────

  function esc(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function getScopeRoot(scope) {
    return scope === "popup"
      ? document.querySelector("#ppv-content")
      : document.querySelector("#patent-detail-content");
  }

  function getScopeOfEl(el) {
    return el && el.closest("#ppv-content") ? "popup" : "detail";
  }

  function getPatentData(scope) {
    return scope === "popup" ? window._patentPopupData : window._currentPatentData;
  }

  function cacheKey(pn) {
    return CACHE_PREFIX + (pn || "unknown");
  }

  function loadCache(pn) {
    try {
      var raw = localStorage.getItem(cacheKey(pn));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && obj.content && obj.ts) return obj;
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveCache(pn, content) {
    try {
      localStorage.setItem(cacheKey(pn), JSON.stringify({ ts: Date.now(), content: content }));
    } catch (e) { /* ignore */ }
  }

  // ── DOM 注入（按钮 + 结果面板容器） ──────────────────────

  function enhance() {
    document.querySelectorAll('.pd-tab-panel[data-panel="description"]').forEach(function (panel) {
      var actions = panel.querySelector(".pd-panel-header .pd-panel-actions");
      if (!actions || actions.querySelector(".pd-desc-summary-btn")) return;

      var scope = getScopeOfEl(panel);
      var btn = document.createElement("button");
      btn.className = "pd-desc-summary-btn";
      btn.dataset.scope = scope;
      btn.title = "AI 总结说明书整体结构、各部分摘要与并列实施例，结果可溯源跳转到对应段落";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;">' +
        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>实施例总结';
      btn.addEventListener("click", function () { run(scope, false); });
      actions.insertBefore(btn, actions.firstChild);
    });
  }

  function _scheduleEnhance() {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(function () {
      _scheduled = false;
      try { enhance(); } catch (e) { console.warn("[DescriptionSummary] enhance failed:", e); }
    });
  }

  // ── 结果面板 ─────────────────────────────────────────────

  function ensurePanel(scope) {
    var root = getScopeRoot(scope);
    if (!root) return null;
    var body = root.querySelector('.pd-tab-panel[data-panel="description"] .pd-tab-panel-body');
    if (!body) return null;

    var panel = body.querySelector(".pd-desc-summary-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "pd-desc-summary-panel";
      panel.dataset.scope = scope;
      panel.innerHTML =
        '<div class="pd-desc-summary-header">' +
        '  <span class="pd-desc-summary-title">' +
        '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="16" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg>' +
        '    说明书结构总结' +
        '  </span>' +
        '  <span class="pd-desc-summary-badge"></span>' +
        '  <div class="pd-desc-summary-actions">' +
        '    <button class="pd-desc-summary-refresh" title="忽略缓存重新总结">重新总结</button>' +
        '    <button class="pd-desc-summary-collapse" title="收起/展开">收起</button>' +
        '    <button class="pd-desc-summary-close" title="关闭">&times;</button>' +
        '  </div>' +
        '</div>' +
        '<div class="pd-desc-summary-body"></div>' +
        '<div class="pd-desc-summary-foot">点击段落号（如 [0025]）可跳转至对应说明书段落印证</div>';

      body.insertBefore(panel, body.firstChild);

      panel.querySelector(".pd-desc-summary-close").addEventListener("click", function () {
        panel.remove();
      });
      panel.querySelector(".pd-desc-summary-collapse").addEventListener("click", function () {
        var collapsed = panel.classList.toggle("collapsed");
        this.textContent = collapsed ? "展开" : "收起";
      });
      panel.querySelector(".pd-desc-summary-refresh").addEventListener("click", function () {
        run(scope, true);
      });
      panel.addEventListener("click", function (e) {
        var ref = e.target.closest(".pd-desc-ref");
        if (ref) jumpToPara(scope, ref.dataset.para);
      });
    }
    return panel;
  }

  // ── 段落溯源：[00XX] → 跳转高亮 ─────────────────────────

  function paraNumExists(root, num) {
    var target = "[" + num + "]";
    var els = root.querySelectorAll('.pd-tab-panel-body[data-panel-body="description"] .pd-para-num');
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent.trim() === target) return true;
    }
    return false;
  }

  function jumpToPara(scope, num) {
    var root = getScopeRoot(scope);
    if (!root || !num) return;
    var target = "[" + num + "]";
    var els = root.querySelectorAll('.pd-tab-panel-body[data-panel-body="description"] .pd-para-num');
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent.trim() === target) {
        var p = els[i].closest("p");
        if (p) {
          p.scrollIntoView({ behavior: "smooth", block: "center" });
          p.classList.remove("pd-desc-ref-flash");
          void p.offsetWidth; // 重启闪烁动画
          p.classList.add("pd-desc-ref-flash");
          setTimeout(function () { p.classList.remove("pd-desc-ref-flash"); }, 2400);
        }
        return;
      }
    }
  }

  // 渲染完成的 HTML：把 [00XX]（含 [00XX]-[00YY] 范围）转为可点击溯源标签
  function linkifyRefs(html, root) {
    return html.replace(/\[(\d{3,5})\](\s*[-–]\s*\[(\d{3,5})\])?/g, function (m, a, _sep, b) {
      var ok = paraNumExists(root, a) && (!b || paraNumExists(root, b));
      return '<a class="pd-desc-ref' + (ok ? "" : " missing") + '" data-para="' + a + '"' +
        (b ? ' data-para-end="' + b + '"' : "") + ' title="' +
        (ok ? "跳转到段落 " + m : "说明书中未找到该段落号") + '">' + m + "</a>";
    });
  }

  // ── AI 总结 ──────────────────────────────────────────────

  var SYSTEM_PROMPT =
    "你是资深专利分析师。请对用户提供的专利说明书进行结构化总结，要求：\n" +
    "1. 【整体结构】按说明书实际章节（技术领域、背景技术、发明内容、附图说明、具体实施方式等）概括各主要部分的内容要点，每部分标注对应的段落号范围（如 [0004]-[0010]）；\n" +
    "2. 【并列实施例】识别说明书中是否存在多个并列实施例（如\"实施例1/实施例2\"、不同变形方案、多个具体示例）：如有，逐个总结每个实施例的核心内容、与其他实施例的区别，并标注段落号；如只有一个实施例或无法区分，请明确说明；\n" +
    "3. 【关键信息】如有，简要指出最优选/重点强调的方案；\n" +
    "4. 所有结论必须附带段落号引用（格式 [00XX] 或 [00XX]-[00YY]），便于溯源定位，不得编造不存在的段落号；\n" +
    "输出使用 Markdown，结构清晰、简明扼要。";

  async function run(scope, forceRefresh) {
    if (_running[scope]) return;
    var data = getPatentData(scope);
    if (!data) { alert("暂无专利数据"); return; }
    var pn = data.patent_number || data.publication_number || "";
    var description = data.description || "";
    if (!description || !description.trim()) { alert("本篇专利暂无说明书数据，无法总结"); return; }

    var config = window.AI.loadAIConfig();
    var provider = window.AI.getCurrentProvider(config);
    if (!provider) { alert("请先在「设置」中配置 AI 服务"); return; }

    var panel = ensurePanel(scope);
    if (!panel) { alert("未找到说明书面板"); return; }
    var bodyEl = panel.querySelector(".pd-desc-summary-body");
    var badge = panel.querySelector(".pd-desc-summary-badge");
    var refreshBtn = panel.querySelector(".pd-desc-summary-refresh");
    panel.classList.remove("collapsed");

    // 缓存命中直接展示
    if (!forceRefresh) {
      var cached = loadCache(pn);
      if (cached) {
        renderDone(scope, bodyEl, cached.content, true);
        if (badge) badge.textContent = "缓存 " + new Date(cached.ts).toLocaleDateString();
        return;
      }
    }

    _running[scope] = true;
    if (refreshBtn) refreshBtn.disabled = true;
    if (badge) badge.textContent = "";
    bodyEl.innerHTML = '<p class="pd-desc-summary-hint">AI 正在总结说明书结构与实施例…</p>';

    var descText = description;
    if (descText.length > MAX_DESC_CHARS) {
      descText = descText.substring(0, MAX_DESC_CHARS) + "\n…（说明书过长已截断）";
    }
    var userMessage =
      "【专利号】" + pn + "\n\n【说明书全文】\n" + descText;

    var acc = "";
    try {
      var stream = window.AI.streamChat(provider.type, provider.apiKey, provider.baseUrl, {
        model: provider.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
        maxTokens: 4096
      });

      var contentStarted = false;
      var renderRaf = null;
      for await (var chunk of stream) {
        if (chunk.content) {
          contentStarted = true;
          acc += chunk.content;
          if (!renderRaf) {
            renderRaf = requestAnimationFrame(function () {
              renderRaf = null;
              bodyEl.innerHTML =
                (window.renderMarkdown ? window.renderMarkdown(acc) : "<pre>" + esc(acc) + "</pre>") ||
                '<p class="pd-desc-summary-hint">…</p>';
            });
          }
        }
      }
      if (!contentStarted) {
        bodyEl.innerHTML = '<p class="pd-desc-summary-hint">未返回内容</p>';
      } else {
        renderDone(scope, bodyEl, acc, false);
        saveCache(pn, acc);
        if (badge) badge.textContent = "已完成";
      }
    } catch (e) {
      bodyEl.innerHTML =
        '<p class="pd-desc-summary-hint">总结失败：' +
        esc(e && e.message ? e.message : String(e)) + "</p>";
    } finally {
      _running[scope] = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  // 完成态渲染：markdown + 段落号溯源链接
  function renderDone(scope, bodyEl, content, isCached) {
    var root = getScopeRoot(scope);
    var html = window.renderMarkdown ? window.renderMarkdown(content) : "<pre>" + esc(content) + "</pre>";
    if (root) html = linkifyRefs(html, root);
    bodyEl.innerHTML =
      html +
      (isCached ? '<p class="pd-desc-summary-cachetag">（已缓存结果，可点击「重新总结」刷新）</p>' : "");
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
    run: run
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", DescriptionSummary.init);
} else {
  DescriptionSummary.init();
}
