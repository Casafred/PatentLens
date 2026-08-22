/*!
 * PatentLens - DeepSeek 思考强度选择（AI 问一问）
 *
 * 背景：DeepSeek V4 起思考模式默认开启，思维链计入 max_tokens 预算，
 * 导致 AI 问一问 / AI 解读在小 max_tokens 下思考耗尽预算、最终回答为空。
 * 修复与参数说明见 web-ai.js 的 streamChat DeepSeek 分支：
 *   - 开关：thinking: {type: "enabled"|"disabled"}
 *   - 强度：reasoning_effort: "high"|"max"（low/medium 会被映射为 high）
 *   参考 https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 *
 * 本模块职责（web-app.js 已冻结，UI 与状态一律放在 app/features/**）：
 *   1. AI 问一问弹窗头部渲染思考强度选择器（仅 DeepSeek 服务商时显示）
 *   2. 选择结果持久化到 localStorage，下次打开自动恢复
 *   3. 流式期间把当前偏好通过 window.DeepSeekAskThinking.getActiveThinking()
 *      提供给 web-ai.js 的 streamChat 注入请求参数
 *
 * 流式期间判定：sendPatentAsk（web-app.js）发送时会禁用 #patent-ask-send-btn，
 * 结束/中止时恢复。用 MutationObserver 监听该按钮的 disabled 属性即可覆盖
 * 「点击发送」与「回车发送」两条路径，无需改动 web-app.js。
 * 注意：ask 流式进行中若有其他 DeepSeek 请求并发，也会读到该偏好（可接受，
 * 偏好本身对 DeepSeek 请求语义正确，仅强度/开关不同）。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "patentlens-deepseek-ask-thinking";
  // ask 流式期间生效的思考偏好：{type:"enabled",effort} / {type:"disabled"} / null
  var _activeThinking = null;

  function getSelect() { return document.getElementById("patent-ask-thinking-select"); }
  function getProviderSelect() { return document.getElementById("patent-ask-provider-select"); }
  function getSendBtn() { return document.getElementById("patent-ask-send-btn"); }
  function getModal() { return document.getElementById("patent-ask-modal"); }

  function loadPref() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "default" || raw === "high" || raw === "max" || raw === "off") return raw;
    } catch (e) { /* ignore */ }
    return "default";
  }

  function savePref(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* ignore */ }
  }

  // 选择器取值 → streamChat 的 thinking 参数；null 表示跟随 API 默认（思考开、high）
  function prefToThinking(value) {
    if (value === "high") return { type: "enabled", effort: "high" };
    if (value === "max") return { type: "enabled", effort: "max" };
    if (value === "off") return { type: "disabled" };
    return null;
  }

  function isDeepSeekProvider() {
    var sel = getProviderSelect();
    return !!(sel && sel.value === "deepseek");
  }

  function syncVisibility() {
    var sel = getSelect();
    if (!sel) return;
    if (isDeepSeekProvider()) sel.classList.remove("hidden");
    else sel.classList.add("hidden");
  }

  function init() {
    var sel = getSelect();
    if (!sel) return;

    sel.value = loadPref();
    sel.addEventListener("change", function () {
      savePref(sel.value);
    });

    var providerSel = getProviderSelect();
    if (providerSel) providerSel.addEventListener("change", syncVisibility);
    syncVisibility();

    // 弹窗每次打开时重新同步显隐：AI 设置保存后
    // refreshAllChatProviderSelects 会程序化重设 provider select 的值（不触发
    // change 事件），在打开时机补一次同步可避免显示状态过期。
    var modal = getModal();
    if (modal && typeof MutationObserver === "function") {
      var modalObserver = new MutationObserver(syncVisibility);
      modalObserver.observe(modal, { attributes: true, attributeFilter: ["class"] });
    }

    // 流式开始（按钮禁用）时锁定当前偏好；结束/中止（按钮恢复）时清除。
    var sendBtn = getSendBtn();
    if (sendBtn && typeof MutationObserver === "function") {
      var sendObserver = new MutationObserver(function () {
        if (sendBtn.disabled) {
          _activeThinking = isDeepSeekProvider() ? prefToThinking(sel.value) : null;
        } else {
          _activeThinking = null;
        }
      });
      sendObserver.observe(sendBtn, { attributes: true, attributeFilter: ["disabled"] });
    }
  }

  // web-ai.js 的 streamChat 在 DeepSeek 请求且调用方未显式传 thinking 时咨询本 API
  window.DeepSeekAskThinking = {
    getActiveThinking: function () { return _activeThinking; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
