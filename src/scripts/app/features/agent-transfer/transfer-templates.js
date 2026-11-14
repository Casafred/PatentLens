/*!
 * PatentLens - Agent 转移模式 · 指令模板库
 *
 * 职责：
 *   1. 提供三个高频场景的系统预置提示词（时间轴 / 审查文档 / 专利原文）
 *   2. 用户自定义内容存 localStorage，可一键恢复预置
 *   3. 纯数据模块，不依赖 DOM 与 web-app.js 全局，可在 Node vm 中单测
 *
 * 对外暴露 window.TransferTemplates
 */
var TransferTemplates = (function () {
  "use strict";

  var STORAGE_KEY = "patentlens_transfer_prompts_v1";
  var VERSION = 1;

  // 通用底线条款：所有模板共用，保证交接出去的指令口径一致
  var BOTTOM_RULES = [
    "",
    "## 通用要求",
    "1. 仅依据上方提供的材料作答，材料中没有的信息明确写「材料未提供」，禁止编造专利号、日期、法条或事实；",
    "2. 每个结论尽量标注来源（文档名 / 权项号 / 段落 / 页码）；",
    "3. 使用中文输出，结构清晰，表格与标题使用 Markdown；",
    "4. 如材料之间存在矛盾或 OCR 疑似错误，单独列出并说明，不要自行择一采信。",
  ].join("\n");

  var PRESETS = {
    timeline: {
      label: "时间轴 / 审查概要",
      body: [
        "你是一位资深专利审查分析师。下面是 PatentLens 交接的专利审查时间轴与概要信息。",
        "请基于材料完成：",
        "1. 用 3-5 句话概括本案审查历程与当前法律状态；",
        "2. 按时间顺序梳理关键审查节点（审查意见、答复、授权通知等），指出每轮交锋的重点；",
        "3. 识别当前待处理事项与潜在风险（如尚未答复的意见、长期停滞节点）；",
        "4. 给出下一步建议的核查清单。",
      ].join("\n"),
    },
    dossier: {
      label: "审查文档分析（OCR 材料）",
      body: [
        "你是一位资深专利审查分析师。下面是 PatentLens 交接的审查文档清单与 OCR 识别文本。",
        "请基于材料完成：",
        "1. 逐篇概述文档要点（文档类型、日期、核心主张或答复内容）；",
        "2. 梳理审查员引用的对比文件及其针对的权项，区分 X / Y / A 类引用（材料未注明类别时不要臆断）；",
        "3. 梳理申请人的答辩策略与权利要求修改脉络；",
        "4. 输出争议焦点清单，并对每个焦点标注支撑材料的来源位置；",
        "5. 指出 OCR 文本中疑似识别错误、影响理解的位置。",
      ].join("\n"),
    },
    fulltext: {
      label: "专利原文分析",
      body: [
        "你是一位资深专利分析师。下面是 PatentLens 交接的专利原文材料（基础信息、摘要、权利要求、说明书、引证等）。",
        "请基于材料完成：",
        "1. 概括本专利要解决的技术问题、核心技术方案与声称的技术效果；",
        "2. 拆解独立权利要求的必要技术特征，说明从属权利要求的附加特征布局；",
        "3. 梳理说明书中的实施例与附图对应关系；",
        "4. 分析引证专利与本方案的关联，指出值得进一步核查的对比文件；",
        "5. 如需深入某个方向（如侵权比对、无效思路、翻译），在结尾列出可继续追问的问题。",
      ].join("\n"),
    },
  };

  function hasStorage() {
    try {
      return typeof localStorage !== "undefined" && !!localStorage;
    } catch (e) {
      return false;
    }
  }

  function readStore() {
    if (!hasStorage()) return {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(store) {
    if (!hasStorage()) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      return false;
    }
  }

  function list() {
    var custom = readStore();
    return Object.keys(PRESETS).map(function (id) {
      return {
        id: id,
        label: PRESETS[id].label,
        customized: Object.prototype.hasOwnProperty.call(custom, id) && typeof custom[id] === "string",
      };
    });
  }

  // 返回当前生效提示词（自定义优先），并标记是否为自定义版本
  function get(id) {
    if (!PRESETS[id]) return null;
    var custom = readStore();
    if (Object.prototype.hasOwnProperty.call(custom, id) && typeof custom[id] === "string" && custom[id].trim()) {
      return { id: id, label: PRESETS[id].label, body: custom[id], customized: true };
    }
    return { id: id, label: PRESETS[id].label, body: PRESETS[id].body, customized: false };
  }

  // 渲染为最终复制文本中的指令段（含通用底线条款）
  function render(id) {
    var tpl = get(id);
    if (!tpl) return "";
    return tpl.body.replace(/\s+$/, "") + "\n" + BOTTOM_RULES;
  }

  // 用面板中可能被用户编辑过的正文组装完整指令段
  function compose(id, bodyOverride) {
    var body = (typeof bodyOverride === "string" && bodyOverride.trim())
      ? bodyOverride
      : (get(id) ? get(id).body : "");
    return body.replace(/\s+$/, "") + "\n" + BOTTOM_RULES;
  }

  function presetBody(id) {
    return PRESETS[id] ? PRESETS[id].body : "";
  }

  function saveCustom(id, text) {
    if (!PRESETS[id] || typeof text !== "string" || !text.trim()) return false;
    var store = readStore();
    store[id] = text;
    return writeStore(store);
  }

  function reset(id) {
    var store = readStore();
    if (!Object.prototype.hasOwnProperty.call(store, id)) return true;
    delete store[id];
    return writeStore(store);
  }

  function isCustom(id) {
    var tpl = get(id);
    return !!(tpl && tpl.customized);
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    list: list,
    get: get,
    render: render,
    compose: compose,
    presetBody: presetBody,
    saveCustom: saveCustom,
    reset: reset,
    isCustom: isCustom,
  };
})();

if (typeof window !== "undefined") {
  window.TransferTemplates = TransferTemplates;
}
