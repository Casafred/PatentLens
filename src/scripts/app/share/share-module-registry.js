/*!
 * PatentLens - 专利分享模块注册表
 *
 * 模块声明是唯一配置来源。渲染器只消费 resolved config，不执行用户提供的
 * HTML/JavaScript；后续研发洞察模块可以在此注册为可选模块。
 */
(function () {
  "use strict";

  var MODULES = [
    { id: "S1", label: "分享封面与目录", description: "项目标题、专利范围、生成时间和目录。", required: true, defaultMode: "full", category: "basic" },
    { id: "S2", label: "专利基础信息", description: "公开号、标题、申请人、发明人、日期、IPC/CPC分类号等字段。", required: true, defaultMode: "full", category: "basic" },
    { id: "S3", label: "技术摘要", description: "摘要和技术主题，缺失时保留来源缺失提示。", required: true, defaultMode: "full", category: "basic" },
    { id: "S4", label: "权利要求书", description: "按专利展示完整权利要求，包括独立/从属标识和引用关系。", required: true, defaultMode: "lite", category: "basic" },
    { id: "S5", label: "说明书", description: "专利说明书/具体实施方式内容。", required: false, defaultMode: "off", category: "basic" },
    { id: "S6", label: "来源与说明", description: "数据来源、抓取时间、审核状态和技术沟通声明。", required: true, defaultMode: "full", category: "basic" },
    { id: "R1", label: "研发问题-手段-效果", description: "AI自动生成或人工编辑的技术问题、技术方案、技术效果分析。", required: false, defaultMode: "full", category: "research" },
    { id: "R2", label: "技术要素与系统结构", description: "AI提取的核心部件、方法步骤、参数和接口关系结构化展示。", required: false, defaultMode: "off", category: "research" },
    { id: "R3", label: "关键参数与边界条件", description: "汇集数值范围、材料、工艺、性能指标及适用条件。", required: false, defaultMode: "off", category: "research" },
    { id: "R4", label: "实施例与验证证据", description: "归纳实施方式、对比实验、测试条件和结果。", required: false, defaultMode: "off", category: "research" },
    { id: "R5", label: "多专利技术路线对比", description: "对多篇专利按技术路线、关键要素、效果做矩阵对比。", required: false, defaultMode: "off", category: "research" },
    { id: "R6", label: "研发启发与待验证问题", description: "研发建议、待验证问题、技术空白点和后续实验项。", required: false, defaultMode: "full", category: "research" },
    { id: "R7", label: "OCR 原文摘录", description: "展示用户选择并 OCR 的 PDF 文本摘录，默认不对外分享。", required: false, defaultMode: "off", category: "appendix" },
    { id: "R8", label: "引证文献与背景", description: "展示专利的前后向引证文献列表和同族专利布局。", required: false, defaultMode: "off", category: "appendix" },
    { id: "R9", label: "同族与地域布局", description: "为研发和产品团队展示重点国家、状态和申请节奏。", required: false, defaultMode: "off", category: "appendix" },
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
    var categories = { basic: [], research: [], appendix: [] };
    MODULES.forEach(function (m) {
      var cat = m.category || "appendix";
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
  };
})();
