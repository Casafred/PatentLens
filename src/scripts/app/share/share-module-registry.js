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

  // 加工字段预设模板：用户可一键添加，每个模板自带提示词约束
  var FIELD_PRESETS = [
    { label: "技术问题", prompt: "请用2-4句话精炼概括本专利要解决的核心技术问题，以及现有技术存在的主要痛点。直接输出结论，不要标题和编号。", type: "text" },
    { label: "技术方案", prompt: "请用3-6个要点概括本专利的核心技术方案，每个要点说明采用了什么结构/步骤及其作用。直接输出要点列表，不要总标题。", type: "list" },
    { label: "技术效果", prompt: "请对应技术方案，用3-5个要点说明本专利带来的具体技术效果或优势，尽可能量化。直接输出要点列表，不要总标题。", type: "list" },
    { label: "核心创新点", prompt: "请提炼本专利最值得研发关注的1-3个核心创新点，每个创新点一句话说明。直接输出列表，不要总标题。", type: "list" },
    { label: "权利要求保护范围", prompt: "请分析独立权利要求的必要技术特征，判断保护范围是宽/中/窄并说明理由，2-3句话。直接输出结论。", type: "text" },
    { label: "研发启发", prompt: "请总结该专利对研发团队的3-5点启示，包括可借鉴思路、值得关注的技术点和可能的设计绕开方向。直接输出要点列表。", type: "list" },
    { label: "实施例要点", prompt: "请从说明书中提取2-3个关键实施例，每个实施例说明其构成、工作原理和验证的效果。直接输出要点列表。", type: "list" },
    { label: "风险与规避", prompt: "请分析该专利可能带来的技术风险（侵权/自由实施），以及建议的规避方向。3-5个要点，仅作技术讨论。直接输出列表。", type: "list" },
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function defaultConfig() {
    var modules = {};
    MODULES.forEach(function (module) { modules[module.id] = module.defaultMode; });
    return { preset: "research-basic", modules: modules, patentOverrides: {} };
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
    return config;
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
    fieldPresets: function () { return clone(FIELD_PRESETS); },
  };
})();
