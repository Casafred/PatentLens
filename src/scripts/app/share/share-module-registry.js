/*!
 * PatentLens - 专利分享模块注册表
 *
 * 模块声明是唯一配置来源。渲染器只消费 resolved config，不执行用户提供的
 * HTML/JavaScript；后续研发洞察模块可以在此注册为可选模块。
 */
(function () {
  "use strict";

  var MODULES = [
    { id: "S1", label: "分享封面与目录", description: "项目标题、专利范围、生成时间和目录。", required: true, defaultMode: "full" },
    { id: "S2", label: "专利基础信息", description: "公开号、标题、申请人、发明人和日期字段。", required: true, defaultMode: "full" },
    { id: "S3", label: "技术摘要", description: "摘要和技术主题，缺失时保留来源缺失提示。", required: true, defaultMode: "full" },
    { id: "S4", label: "权利要求", description: "按专利展示已导入的权利要求文本。", required: true, defaultMode: "lite" },
    { id: "S5", label: "来源与说明", description: "来源、抓取时间、审核状态和技术沟通声明。", required: true, defaultMode: "full" },
    { id: "R1", label: "研发问题-手段-效果", description: "为后续人工或 AI 研发解读预留的可选模块。", required: false, defaultMode: "off" },
    { id: "R7", label: "OCR 原文摘录", description: "展示用户选择并 OCR 的 PDF 文本摘录，默认不对外分享。", required: false, defaultMode: "off" },
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
    if (MODULES.find(function (module) { return module.id === moduleId; }).required && mode === "off") return null;
    config.modules[moduleId] = mode;
    return config;
  }

  function getModule(moduleId) {
    var found = MODULES.find(function (module) { return module.id === moduleId; });
    return found ? clone(found) : null;
  }

  window.PatentShareModules = {
    list: function () { return clone(MODULES); },
    get: getModule,
    defaultConfig: defaultConfig,
    resolveConfig: resolveConfig,
    setModuleMode: setModuleMode,
  };
})();
