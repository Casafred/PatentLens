/*!
 * PatentLens - 专利分享模块注册表
 *
 * 仅分两类：基础信息（从来源提取+人工校核）与加工信息（AI抽取/手工录入的字段）。
 * 模块声明是唯一配置来源；渲染器只消费 resolved config，不执行用户 HTML/JS。
 */
(function () {
  "use strict";

  var MODULES = [
    // ===== 基础信息：从 GP / Excel / OCR 等来源提取，可人工编辑校核 =====
    { id: "S1", label: "封面与目录", description: "项目标题、专利范围、生成时间和目录导航。", required: true, defaultMode: "full", category: "basic" },
    { id: "S2", label: "专利基础信息", description: "公开号、标题、申请人、发明人、日期、IPC/CPC 分类号及自定义字段。", required: true, defaultMode: "full", category: "basic" },
    { id: "S3", label: "技术摘要", description: "专利摘要和技术主题概述。", required: true, defaultMode: "full", category: "basic" },
    { id: "S4", label: "权利要求书", description: "完整权利要求，含独立/从属标识与引用关系。", required: true, defaultMode: "lite", category: "basic" },
    { id: "S5", label: "说明书", description: "专利说明书/具体实施方式全文。", required: false, defaultMode: "off", category: "basic" },
    { id: "S7", label: "附图", description: "专利附图、流程图或用户上传的图片。", required: false, defaultMode: "full", category: "basic" },
    { id: "S6", label: "来源与声明", description: "数据来源、抓取时间、审核状态和技术沟通声明。", required: true, defaultMode: "full", category: "basic" },
    // ===== 加工信息：AI 抽取或手工录入的结构化字段 =====
    { id: "R1", label: "技术问题-方案-效果", description: "AI 抽取或人工编辑的技术问题、技术方案、技术效果三要素。", required: false, defaultMode: "off", category: "processed" },
    { id: "R2", label: "技术要素提取", description: "AI 提取的核心部件、方法步骤、参数和接口关系。", required: false, defaultMode: "off", category: "processed" },
    { id: "R3", label: "关键参数与边界", description: "数值范围、材料、工艺、性能指标及适用条件。", required: false, defaultMode: "off", category: "processed" },
    { id: "R4", label: "实施例与验证", description: "实施方式、对比实验、测试条件和结果归纳。", required: false, defaultMode: "off", category: "processed" },
    { id: "R5", label: "多专利对比", description: "多篇专利按技术路线、关键要素、效果做矩阵对比。", required: false, defaultMode: "off", category: "processed" },
    { id: "R6", label: "研发启发与待验证", description: "研发建议、待验证问题、技术空白点和后续实验项。", required: false, defaultMode: "off", category: "processed" },
    { id: "R7", label: "OCR 原文摘录", description: "PDF OCR 文本摘录，默认不对外分享。", required: false, defaultMode: "off", category: "processed" },
    { id: "R8", label: "引证文献", description: "前后向引证文献列表。", required: false, defaultMode: "off", category: "processed" },
    { id: "R9", label: "同族与地域", description: "同族专利布局、重点国家与申请节奏。", required: false, defaultMode: "off", category: "processed" },
  ];

  // 加工字段预设模板：面向研发沟通，不默认输出侵权、FTO 或规避结论。
  var FIELD_PRESETS = [
    { label: "一句话技术结论", prompt: "用一句不超过60字的话说明该专利的核心技术思路和适用对象。没有明确依据时写“未找到明确依据”。", type: "text" },
    { label: "技术问题", prompt: "用2-4句话概括本专利要解决的具体技术问题和现有技术痛点。每个判断必须能对应摘要、权利要求或说明书；无法确认时明确说明。", type: "text" },
    { label: "核心方案", prompt: "用3-6个要点概括核心结构、步骤或模块及其作用。不要推断专利未披露的实现细节。", type: "list" },
    { label: "关键要素与参数", prompt: "列出研发复现或评审最需要关注的部件、材料、步骤、数值范围和边界条件；仅列专利明确披露的内容。", type: "list" },
    { label: "技术效果与证据", prompt: "区分“专利主张的效果”和“实施例或测试已验证的效果”。没有实验数据时明确写“未见公开验证数据”，不要补充数值。", type: "list" },
    { label: "独立权项必要特征", prompt: "仅列出独立权利要求中明确出现的必要技术特征，不判断保护范围宽窄，不给出侵权、FTO 或规避结论。", type: "list" },
    { label: "研发相关性与待验证", prompt: "从技术讨论角度列出值得内部研发验证的假设、实验条件或信息缺口。不得给出侵权、自由实施或规避结论。", type: "list" },
    { label: "实施例与验证要点", prompt: "提取公开实施例、对比条件和验证结果；专利未公开具体数据时明确说明。", type: "list" },
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function defaultConfig() {
    var modules = {};
    MODULES.forEach(function (module) { modules[module.id] = module.defaultMode; });
    return { preset: "research-basic", modules: modules, patentOverrides: {}, moduleOrder: { processed: MODULES.filter(function (m) { return m.category === "processed"; }).map(function (m) { return m.id; }) } };
  }

  function resolveConfig(projectConfig) {
    var config = defaultConfig();
    var input = projectConfig && typeof projectConfig === "object" ? projectConfig : {};
    if (typeof input.preset === "string") config.preset = input.preset;
    var incoming = input.modules && typeof input.modules === "object" ? input.modules : {};
    Object.keys(incoming).forEach(function (id) {
      if (config.modules[id] && ["full", "lite", "off"].indexOf(incoming[id]) >= 0) config.modules[id] = incoming[id];
    });
    config.patentOverrides = input.patentOverrides && typeof input.patentOverrides === "object" ? clone(input.patentOverrides) : {};
    var processedIds = MODULES.filter(function (m) { return m.category === "processed"; }).map(function (m) { return m.id; });
    var requestedOrder = input.moduleOrder && Array.isArray(input.moduleOrder.processed) ? input.moduleOrder.processed : [];
    var seen = {};
    config.moduleOrder = { processed: requestedOrder.filter(function (id) {
      if (processedIds.indexOf(id) < 0 || seen[id]) return false;
      seen[id] = true;
      return true;
    }) };
    processedIds.forEach(function (id) { if (!seen[id]) config.moduleOrder.processed.push(id); });
    return config;
  }

  function orderByConfig(modules, config, zone) {
    var list = Array.isArray(modules) ? modules.slice() : [];
    var requested = config && config.moduleOrder && Array.isArray(config.moduleOrder[zone]) ? config.moduleOrder[zone] : [];
    if (!requested.length) return list;
    var position = {};
    requested.forEach(function (id, index) { position[id] = index; });
    return list.sort(function (a, b) {
      var left = Object.prototype.hasOwnProperty.call(position, a.id) ? position[a.id] : Number.MAX_SAFE_INTEGER;
      var right = Object.prototype.hasOwnProperty.call(position, b.id) ? position[b.id] : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  }

  function setModuleMode(projectConfig, moduleId, mode) {
    var config = resolveConfig(projectConfig);
    if (!config.modules[moduleId] || ["full", "lite", "off"].indexOf(mode) < 0) return null;
    var module = MODULES.find(function (m) { return m.id === moduleId; });
    if (module && module.required && mode === "off") return null;
    config.modules[moduleId] = mode;
    return config;
  }

  function getModule(moduleId) {
    var found = MODULES.find(function (module) { return module.id === moduleId; });
    return found ? clone(found) : null;
  }

  function listByCategory() {
    var categories = { basic: [], processed: [] };
    MODULES.forEach(function (m) {
      var cat = m.category || "processed";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(clone(m));
    });
    return categories;
  }

  window.PatentShareModules = {
    list: function () { return clone(MODULES); },
    listByCategory: listByCategory,
    get: getModule,
    defaultConfig: defaultConfig,
    resolveConfig: resolveConfig,
    setModuleMode: setModuleMode,
    orderByConfig: orderByConfig,
    fieldPresets: function () { return clone(FIELD_PRESETS); },
  };
})();
