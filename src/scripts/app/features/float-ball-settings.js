/*!
 * PatentLens - 悬浮球入口开关
 *
 * 允许在设置中关闭智能助手悬浮球与成图工作台悬浮球。
 * 设置即时生效并保存在本机，默认开启。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var AI_KEY = "patentlens_ai_float_ball_enabled";
  var P2P_KEY = "patentlens_patent2pic_float_ball_enabled";

  function isEnabled(key) {
    try { return window.localStorage.getItem(key) !== "false"; } catch (_) { return true; }
  }

  function setEnabled(key, enabled) {
    try { window.localStorage.setItem(key, enabled ? "true" : "false"); } catch (_) {}
  }

  function apply(aiEnabled, p2pEnabled) {
    document.body.classList.toggle("pl-hide-ai-float", !aiEnabled);
    document.body.classList.toggle("pl-hide-p2p-float", !p2pEnabled);
  }

  function syncCheckboxes() {
    var ai = document.getElementById("toggle-ai-float-ball");
    var p2p = document.getElementById("toggle-patent2pic-float-ball");
    if (ai) ai.checked = isEnabled(AI_KEY);
    if (p2p) p2p.checked = isEnabled(P2P_KEY);
  }

  function init() {
    apply(isEnabled(AI_KEY), isEnabled(P2P_KEY));
    syncCheckboxes();
    document.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.id) return;
      if (target.id === "toggle-ai-float-ball") {
        setEnabled(AI_KEY, !!target.checked);
      } else if (target.id === "toggle-patent2pic-float-ball") {
        setEnabled(P2P_KEY, !!target.checked);
      } else {
        return;
      }
      apply(isEnabled(AI_KEY), isEnabled(P2P_KEY));
    });
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.closest && (target.closest("#ai-settings-btn") || target.closest('[data-settings-tab="reading"]'))) {
        setTimeout(syncCheckboxes, 0);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
