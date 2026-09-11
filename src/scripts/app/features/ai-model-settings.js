/* PatentLens - persistent custom model controls for the settings dialog. */
(function () {
  "use strict";
  function refresh() {
    var input = document.getElementById("ai-model-select"), provider = document.getElementById("ai-provider-select");
    var list = document.getElementById("ai-model-select-datalist"), models;
    if (!input || !provider || !list || !window.AI) return;
    models = window.AI.getAvailableModels(provider.value);
    list.innerHTML = "";
    models.forEach(function (model) { var option = document.createElement("option"); option.value = model.value; list.appendChild(option); });
    var host = input.closest(".form-group"); if (!host) return;
    var chips = host.querySelector(".custom-model-list");
    if (!chips) { chips = document.createElement("div"); chips.className = "custom-model-list"; host.appendChild(chips); }
    var config = window.AI.loadAIConfig(), custom = config.customModels && config.customModels[provider.value] || [];
    chips.textContent = custom.length ? "已添加：" + custom.join(" · ") : "可直接输入模型名后保存，或添加到常用模型。";
  }
  function enhance() {
    var input = document.getElementById("ai-model-select"), provider = document.getElementById("ai-provider-select");
    if (!input || !provider || input.dataset.customModelReady) return;
    input.dataset.customModelReady = "1";
    var host = input.closest(".form-group"), add = document.createElement("button");
    add.type = "button"; add.className = "custom-model-add"; add.textContent = "添加到常用模型"; add.title = "保存当前输入的模型名称，之后可从建议列表选择";
    host.appendChild(add);
    add.addEventListener("click", function () {
      var config = window.AI.loadAIConfig();
      if (!window.AI.addCustomModel(config, provider.value, input.value)) return;
      window.AI.saveAIConfig(config); refresh();
    });
    var save = document.getElementById("ai-save-btn"), settings = document.getElementById("ai-settings-btn");
    if (save) save.addEventListener("click", function () {
      var config = window.AI.loadAIConfig();
      if (window.AI.addCustomModel(config, provider.value, input.value)) window.AI.saveAIConfig(config);
    });
    if (settings) settings.addEventListener("click", function () { setTimeout(refresh, 0); });
    provider.addEventListener("change", function () { setTimeout(refresh, 0); });
    input.addEventListener("change", function () { refresh(); });
    refresh();
  }
  var observer = typeof MutationObserver === "function" ? new MutationObserver(enhance) : null;
  if (typeof document !== "undefined") {
    if (observer) observer.observe(document.body, { childList: true, subtree: true });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance); else enhance();
  }
})();
