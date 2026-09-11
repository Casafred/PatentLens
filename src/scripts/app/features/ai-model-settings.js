/* PatentLens - persistent custom model controls for the settings dialog. */
(function () {
  "use strict";
  var PROTOCOLS = [
    ["openai-chat", "OpenAI Chat Completions 兼容"],
    ["openai-responses", "OpenAI Responses API"],
    ["anthropic", "Anthropic Messages API"],
    ["gemini", "Gemini GenerateContent API"]
  ];
  function isCustom(provider) { return provider && provider.value === "custom"; }
  function customConfig() { return window.AI.loadAIConfig().custom || {}; }
  function ensureCustomOption(provider) {
    if (!provider || provider.querySelector('option[value="custom"]')) return;
    var option = document.createElement("option"); option.value = "custom"; option.textContent = "自定义供应商"; provider.appendChild(option);
  }
  function ensureCustomControls(input) {
    var host = input && input.closest(".form-group"), apiGroup = document.getElementById("ai-api-key-input") && document.getElementById("ai-api-key-input").closest(".form-group");
    if (!host || !apiGroup) return null;
    var existing = document.getElementById("custom-provider-options"); if (existing) return existing;
    var box = document.createElement("div"); box.id = "custom-provider-options"; box.className = "custom-provider-options";
    box.innerHTML = '<div class="form-group"><label>供应商名称</label><input type="text" id="custom-provider-name" placeholder="例如：公司模型网关"></div><div class="form-group"><label>接口协议</label><select id="custom-provider-protocol"></select></div><div class="form-group"><label>推理强度</label><select id="custom-provider-reasoning"><option value="off">关闭 / 由模型默认决定</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div><p class="custom-provider-hint">服务地址填写协议根地址：Chat 使用 /chat/completions，Responses 使用 /responses，Anthropic 使用 /v1/messages，Gemini 使用 /v1beta/models/{模型}:generateContent。</p>';
    var protocol = box.querySelector("#custom-provider-protocol");
    PROTOCOLS.forEach(function (item) { var option = document.createElement("option"); option.value = item[0]; option.textContent = item[1]; protocol.appendChild(option); });
    apiGroup.parentNode.insertBefore(box, apiGroup);
    return box;
  }
  function syncCustomForm() {
    var config = customConfig(), name = document.getElementById("custom-provider-name"), protocol = document.getElementById("custom-provider-protocol"), reasoning = document.getElementById("custom-provider-reasoning");
    if (name) name.value = config.name || "";
    if (protocol) protocol.value = config.protocol || "openai-chat";
    if (reasoning) reasoning.value = config.reasoningEffort || "off";
  }
  function persistCustomForm() {
    var input = document.getElementById("ai-model-select"), provider = document.getElementById("ai-provider-select"), key = document.getElementById("ai-api-key-input"), url = document.getElementById("ai-base-url-input");
    if (!isCustom(provider) || !window.AI) return;
    var config = window.AI.loadAIConfig(), custom = config.custom || (config.custom = {}), name = document.getElementById("custom-provider-name"), protocol = document.getElementById("custom-provider-protocol"), reasoning = document.getElementById("custom-provider-reasoning");
    custom.type = "custom"; custom.name = name ? name.value.trim() : ""; custom.protocol = protocol ? protocol.value : "openai-chat"; custom.reasoningEffort = reasoning ? reasoning.value : "off";
    custom.apiKey = key ? key.value.trim() : custom.apiKey || ""; custom.baseUrl = url ? url.value.trim() : custom.baseUrl || ""; custom.model = input ? input.value.trim() : custom.model || "";
    if (custom.model) window.AI.addCustomModel(config, "custom", custom.model);
    window.AI.setCurrentProvider(config, "custom"); window.AI.saveAIConfig(config);
  }
  function toggleCustomControls(provider) {
    var box = document.getElementById("custom-provider-options"); if (box) box.hidden = !isCustom(provider);
  }
  function restoreCustomProvider() {
    var provider = document.getElementById("ai-provider-select"), input = document.getElementById("ai-model-select"), key = document.getElementById("ai-api-key-input"), url = document.getElementById("ai-base-url-input"), config = window.AI.loadAIConfig(), custom = config.custom || {};
    ensureCustomOption(provider);
    if (config.currentProvider !== "custom") { toggleCustomControls(provider); return; }
    provider.value = "custom"; if (input) input.value = custom.model || ""; if (key) key.value = custom.apiKey || ""; if (url) url.value = custom.baseUrl || "";
    syncCustomForm(); toggleCustomControls(provider); refresh();
  }
  function refresh() {
    var input = document.getElementById("ai-model-select"), provider = document.getElementById("ai-provider-select");
    var list = document.getElementById("ai-model-select-datalist"), models;
    if (!input || !provider || !list || !window.AI) return;
    ensureCustomOption(provider); models = window.AI.getAvailableModels(provider.value);
    list.innerHTML = "";
    models.forEach(function (model) { var option = document.createElement("option"); option.value = model.value; list.appendChild(option); });
    var host = input.closest(".form-group"); if (!host) return;
    var chips = host.querySelector(".custom-model-list");
    if (!chips) { chips = document.createElement("div"); chips.className = "custom-model-list"; host.appendChild(chips); }
    var config = window.AI.loadAIConfig(), custom = config.customModels && config.customModels[provider.value] || [];
    chips.textContent = custom.length ? "已添加：" + custom.join(" · ") : "可直接输入模型名后保存，或添加到常用模型。";
    toggleCustomControls(provider);
  }
  function enhance() {
    var input = document.getElementById("ai-model-select"), provider = document.getElementById("ai-provider-select");
    if (!input || !provider || input.dataset.customModelReady) return;
    input.dataset.customModelReady = "1";
    ensureCustomOption(provider); ensureCustomControls(input); syncCustomForm(); toggleCustomControls(provider);
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
      persistCustomForm();
      var config = window.AI.loadAIConfig();
      if (window.AI.addCustomModel(config, provider.value, input.value)) window.AI.saveAIConfig(config);
    });
    if (settings) settings.addEventListener("click", function () { setTimeout(restoreCustomProvider, 0); });
    provider.addEventListener("change", function () { if (isCustom(provider)) syncCustomForm(); setTimeout(refresh, 0); });
    input.addEventListener("change", function () { refresh(); });
    var test = document.getElementById("ai-test-btn");
    if (test) test.addEventListener("click", function () { persistCustomForm(); }, true);
    refresh();
  }
  var observer = typeof MutationObserver === "function" ? new MutationObserver(enhance) : null;
  if (typeof document !== "undefined") {
    if (observer) observer.observe(document.body, { childList: true, subtree: true });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance); else enhance();
  }
})();
