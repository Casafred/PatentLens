/*!
 * PatentLens - 专利分享AI加工模块
 *
 * 提供专利内容的AI自动分析能力，包括技术问题-方案-效果提取、
 * 技术要素归纳、关键参数提取、多专利对比分析等。
 */
(function () {
  "use strict";

  var PROMPT_VERSION = "share-rnd-v2";
  var SHARE_AI_PROMPTS = {
    patentSummary: '你是一位专利技术信息分析师，任务是制作供研发团队讨论的技术分享草稿，不提供法律意见。请根据输入输出Markdown。\n\n## 技术问题\n概括专利明确要解决的具体技术问题。\n\n## 核心方案\n用3-6个要点说明结构、步骤、材料或模块及其关系。\n\n## 技术效果与证据\n区分“专利主张的效果”和“实施例或测试已验证的效果”；未公开验证数据时必须明确说明，禁止补充数值。\n\n## 研发待确认事项\n仅列值得进一步查证、实验或讨论的信息缺口，不给出侵权、自由实施、无效或规避结论。\n\n要求：\n- 每个要点末尾用括号标注来源，例如（来源：权利要求1）或（来源：说明书）。没有可定位依据时写“来源：待核验”\n- 仅使用输入材料，不能推测未披露的实现细节\n- 使用中文，语言精炼；所有结果均为“待人工审核”的分享草稿',

    technicalElements: '你是一位专利技术要素提取专家。请从提供的专利中提取**结构化技术要素**，输出为JSON格式（不要输出其他说明文字）：\n\n```json\n{\n  "components": [\n    {\n      "name": "部件/模块名称",\n      "role": "在方案中的作用",\n      "keyFeatures": ["关键特征1", "关键特征2"]\n    }\n  ],\n  "steps": [\n    {\n      "order": 1,\n      "action": "步骤描述",\n      "input": "输入",\n      "output": "输出",\n      "keyParams": ["关键参数/条件"]\n    }\n  ],\n  "parameters": [\n    {\n      "name": "参数名称",\n      "range": "数值范围/取值",\n      "unit": "单位",\n      "effect": "该参数的作用/对效果的影响"\n    }\n  ],\n  "interfaces": ["关键接口/连接关系1", "关键接口/连接关系2"],\n  "materials": ["涉及的材料/物质1", "涉及的材料/物质2"]\n}\n```\n\n请只输出符合上述格式的JSON，不要输出Markdown代码块标记以外的任何文字。',

    multiPatentComparison: '你是一位专利组合分析专家。请对以下多篇专利进行**技术路线对比分析**，帮助研发团队理解不同方案的异同和演进方向。\n\n输出Markdown格式，包含：\n\n## 一、专利组合概览\n- 涉及的技术领域\n- 各专利解决的问题侧重\n- 整体技术演进脉络\n\n## 二、技术路线对比矩阵\n以表格形式对比各专利的关键维度：\n| 维度 | 专利1 | 专利2 | ... |\n|------|-------|-------|-----|\n| 核心问题 | | | |\n| 技术路线 | | | |\n| 关键特征 | | | |\n| 主要效果 | | | |\n| 保护范围 | | | |\n\n## 三、核心差异分析\n- 各方案的本质区别是什么\n- 技术路线的演进方向\n- 不同方案的适用场景\n\n## 四、研发启示\n- 技术发展趋势总结\n- 关键技术空白点\n- 值得重点关注的专利\n\n要求：分析客观，基于提供的专利内容，不编造信息；使用中文输出。',

    embodiments: '你是一位专利技术分析专家。请从提供的专利说明书中提取和归纳**实施例及验证证据**，输出Markdown格式。\n\n## 一、实施例概览\n列出专利中提到的所有实施例/实施方式，简要说明每个实施例的核心内容。\n\n## 二、关键实施方式\n选取最重要的2-3个实施例，详细说明：\n- 实施例的构成和配置\n- 工作原理/流程步骤\n- 与其他实施例的区别\n\n## 三、对比实验与数据\n如果专利中包含对比实验或测试数据：\n- 实验条件是什么\n- 对比对象是什么（现有技术/对照组）\n- 测试结果和性能数据\n- 效果提升幅度\n\n## 四、验证要点\n- 该实施例验证了哪些技术效果\n- 参数选择对效果的影响\n- 可推广性评估\n\n要求：\n- 严格基于说明书内容，不要编造未提及的实验或数据\n- 如果专利未公开具体实验数据，请明确说明"该专利未公开具体对比实验数据"\n- 使用中文输出，保留原始技术术语'
  };

  // 组合判断四类内置提示词的中文标题，供 UI 展示与编辑。
  var AI_PROMPT_META = {
    summary: { label: "技术解读", description: "单篇专利的技术问题、核心方案、技术效果与待确认事项。" },
    elements: { label: "技术要素", description: "结构化提取部件、步骤、参数与接口关系。" },
    embodiments: { label: "实施例与验证草稿", description: "从说明书归纳实施例、对比实验与验证证据。" },
    comparison: { label: "多专利技术路线对比", description: "多篇专利的技术路线矩阵对比与研发启示。" },
  };

  function defaultContextScope() {
    return { abstract: true, claims: true, description: true, annotations: true };
  }

  // 读取项目级 AI 原文范围（store 是唯一持久化来源；share-ai 在 store 之后加载）。
  function getProjectContextScope() {
    var store = window.PatentShareStore;
    if (store && typeof store.getAIContextScope === "function") {
      try { return store.getAIContextScope(); } catch (e) {}
    }
    return defaultContextScope();
  }

  // 组合判断内置提示词的 key 与 SHARE_AI_PROMPTS 中常量名的映射。
  var AI_PROMPT_DEFAULT_KEY = {
    summary: "patentSummary",
    elements: "technicalElements",
    embodiments: "embodiments",
    comparison: "multiPatentComparison",
  };

  // 读取组合判断内置提示词的当前有效值：优先项目级覆盖，否则内置默认。
  function getAIPrompt(key) {
    var store = window.PatentShareStore;
    if (store && typeof store.getPromptOverrides === "function") {
      try {
        var overrides = store.getPromptOverrides();
        if (overrides && overrides.ai && overrides.ai[key]) return overrides.ai[key];
      } catch (e) {}
    }
    var defaultKey = AI_PROMPT_DEFAULT_KEY[key] || key;
    return SHARE_AI_PROMPTS[defaultKey] || "";
  }

  function getPromptDefaults() {
    return {
      summary: SHARE_AI_PROMPTS.patentSummary,
      elements: SHARE_AI_PROMPTS.technicalElements,
      embodiments: SHARE_AI_PROMPTS.embodiments,
      comparison: SHARE_AI_PROMPTS.multiPatentComparison,
    };
  }

  function getActiveAIProvider() {
    if (!window.AI) return null;
    try {
      var config = window.AI.loadAIConfig();
      return window.AI.getCurrentProvider(config);
    } catch (e) {
      return null;
    }
  }

  function buildPatentContext(patent, brief, scope) {
    var s = scope && typeof scope === "object" ? scope : defaultContextScope();
    var parts = [];
    if (brief && typeof brief === "object") {
      parts.push("【分享任务】面向" + (brief.audience || "研发团队") + "的" + (brief.purpose || "技术分享") + "。关注重点：" + (brief.focus || "未指定"));
    }
    parts.push("【专利号】" + (patent.patentNumber || "未知"));
    parts.push("【标题】" + (patent.title || "未提供"));
    if (s.abstract && patent.fields && patent.fields.abstract && patent.fields.abstract.value) {
      parts.push("\n【摘要】\n" + patent.fields.abstract.value);
    }
    if (patent.fields && patent.fields.assignees && patent.fields.assignees.value) {
      parts.push("\n【申请人】" + patent.fields.assignees.value);
    }
    if (patent.fields && patent.fields.inventors && patent.fields.inventors.value) {
      parts.push("\n【发明人】" + patent.fields.inventors.value);
    }
    if (s.description && patent.description) {
      var desc = patent.description;
      if (desc.length > 8000) desc = desc.slice(0, 8000) + "...(内容过长，已截断)";
      parts.push("\n【说明书】\n" + desc);
    }
    if (s.claims && patent.claims && patent.claims.length) {
      parts.push("\n【权利要求书】");
      var claimsText = patent.claims.map(function (c) {
        return "【权利要求" + (c.number || "未编号") + "】" + (c.text || "");
      }).join("\n\n");
      if (claimsText.length > 12000) claimsText = claimsText.slice(0, 12000) + "...(内容过长，已截断)";
      parts.push(claimsText);
    }
    if (s.annotations) {
      var annotationEvidence = [];
      (patent.claimsAnnotations || []).forEach(function (annotation) {
        if (!annotation || !annotation.text) return;
        annotationEvidence.push("权利要求" + (annotation.key || "") + "：" + annotation.text + (annotation.comment ? "（IPR注释：" + annotation.comment + "）" : ""));
      });
      (patent.descriptionAnnotations || []).forEach(function (annotation) {
        if (!annotation || !annotation.text) return;
        annotationEvidence.push("说明书：" + annotation.text + (annotation.comment ? "（IPR注释：" + annotation.comment + "）" : ""));
      });
      if (annotationEvidence.length) parts.push("\n【IPR 标注摘录】\n" + annotationEvidence.join("\n"));
    }
    if (!s.abstract && !s.claims && !s.description && !s.annotations) {
      parts.push("\n【提示】本次未勾选任何原文范围，AI 仅能基于标题与著录项进行分析，结论可能受限。");
    }
    return parts.join("\n");
  }

  function buildMultiPatentContext(patents, brief, scope) {
    return patents.map(function (p, idx) {
      return "===== 专利" + (idx + 1) + " =====\n" + buildPatentContext(p, brief, scope);
    }).join("\n\n");
  }

  async function callAI(messages) {
    var provider = getActiveAIProvider();
    if (!provider) throw new Error("请先在 AI 设置中配置有效的 API Key");
    if (!window.AI || !window.AI.streamChat) throw new Error("AI 模块未就绪");
    var fullContent = "";
    var fullReasoning = "";
    try {
      var stream = window.AI.streamChat(
        provider.type,
        provider.apiKey,
        provider.baseUrl,
        { model: provider.model, messages: messages, temperature: 0.2, maxTokens: 32768 }
      );
      for await (var chunk of stream) {
        if (chunk.content) fullContent += chunk.content;
        if (chunk.reasoningContent) fullReasoning += chunk.reasoningContent;
      }
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
    return { content: fullContent, reasoning: fullReasoning, model: provider.model };
  }

  async function generatePatentSummary(patent, brief, scope) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      var context = buildPatentContext(patent, brief, scope || getProjectContextScope());
      var messages = [
        { role: "system", content: getAIPrompt("summary") },
        { role: "user", content: "请分析以下专利：\n\n" + context }
      ];
      var result = await callAI(messages);
      return {
        ok: true,
        content: result.content,
        reasoning: result.reasoning,
        model: result.model,
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function generateTechnicalElements(patent, brief, scope) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      var context = buildPatentContext(patent, brief, scope || getProjectContextScope());
      var messages = [
        { role: "system", content: getAIPrompt("elements") },
        { role: "user", content: "请提取以下专利的技术要素：\n\n" + context }
      ];
      var result = await callAI(messages);
      var parsed = null;
      try {
        var jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[1]);
        else parsed = JSON.parse(result.content);
      } catch (e) { parsed = null; }
      return {
        ok: true,
        content: result.content,
        parsed: parsed,
        reasoning: result.reasoning,
        model: result.model,
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function generateMultiPatentComparison(patents, brief, scope) {
    try {
      if (!patents || !patents.length) throw new Error("未选择要对比的专利");
      var patentList = Array.isArray(patents) ? patents : [patents];
      if (patentList.length < 2) throw new Error("需要至少2篇专利才能进行对比分析");
      var context = buildMultiPatentContext(patentList, brief, scope || getProjectContextScope());
      var messages = [
        { role: "system", content: getAIPrompt("comparison") },
        { role: "user", content: "请对比分析以下多篇专利：\n\n" + context }
      ];
      var result = await callAI(messages);
      return {
        ok: true,
        content: result.content,
        reasoning: result.reasoning,
        model: result.model,
        patentIds: patentList.map(function(p) { return p.id; }),
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function generateEmbodiments(patent, brief, scope) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      if (!patent.description) throw new Error("该专利缺少说明书内容，无法提取实施例");
      var context = buildPatentContext(patent, brief, scope || getProjectContextScope());
      var messages = [
        { role: "system", content: getAIPrompt("embodiments") },
        { role: "user", content: "请从以下专利中提取实施例及验证证据：\n\n" + context }
      ];
      var result = await callAI(messages);
      return {
        ok: true,
        content: result.content,
        reasoning: result.reasoning,
        model: result.model,
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // 加工字段抽取：基于用户自定义提示词，抽取一个聚焦的结构化字段值。
  // 字段级 contextScope 为 null 时继承项目级 aiContextScope。
  async function generateProcessedField(patent, field, brief) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      if (!field || typeof field !== "object") throw new Error("无效的加工字段");
      var prompt = cleanText(field.prompt);
      var label = cleanText(field.label) || "加工字段";
      if (!prompt) throw new Error("该字段未配置提示词，无法进行AI抽取");
      var fieldScope = field.contextScope && typeof field.contextScope === "object" ? field.contextScope : getProjectContextScope();
      var context = buildPatentContext(patent, brief, fieldScope);
      var systemPrompt = '你是一位专利技术信息分析师。请严格根据提供的专利内容回答问题，不提供侵权、自由实施、无效或规避结论。\n\n要求：\n- 结论必须基于提供的专利内容，不要编造未给出的细节\n- 没有明确依据时写“未找到明确依据”\n- 语言精炼准确，适合研发人员阅读\n- 使用中文输出，专业术语可保留英文原文\n- 直接输出结论内容，不要添加标题或引导语\n- 如果是列表，用 "- " 开头每行一个要点';
      var userPrompt = "【抽取任务】" + label + "\n\n【抽取要求】\n" + prompt + "\n\n【专利内容】\n" + context;
      var messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ];
      var result = await callAI(messages);
      return {
        ok: true,
        value: result.content,
        model: result.model,
        reasoning: result.reasoning,
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // 调用翻译模型将权利要求/说明书翻译为中文。kind: "claims" | "description"
  // 优先使用翻译专用 provider（getTranslateProvider），回退到当前 provider。
  async function translatePatentText(text, kind) {
    try {
      var content = cleanText(text);
      if (!content) throw new Error("没有可翻译的内容");
      if (!window.AI || !window.AI.streamChat) throw new Error("AI 模块未就绪");
      var config = window.AI.loadAIConfig();
      var tp = window.AI.getTranslateProvider ? window.AI.getTranslateProvider(config) : getActiveAIProvider();
      if (!tp || !tp.apiKey) throw new Error("请先在 AI 设置中配置有效的 API Key");
      var kindLabel = kind === "claims" ? "权利要求" : (kind === "description" ? "说明书" : "专利文本");
      var systemPrompt = '你是一位专业的专利文献翻译专家。请将以下' + kindLabel + '文本翻译为中文。要求：\n- 保持专利术语的准确性，专业术语可在括号内保留英文原文\n- 保留所有权利要求编号、附图标记和数字标记\n- 翻译要流畅自然，符合中文技术文档表达习惯\n- 只返回翻译结果，不要添加解释、注释或引导语\n- 若原文已是中文，原样返回';
      var messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: content }
      ];
      var fullContent = "";
      var stream = window.AI.streamChat(
        tp.type,
        tp.apiKey,
        tp.baseUrl,
        { model: tp.model, messages: messages, temperature: 0.3, maxTokens: 32768 }
      );
      for await (var chunk of stream) {
        if (chunk.content) fullContent += chunk.content;
      }
      return {
        ok: true,
        content: fullContent,
        model: tp.model,
        generatedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }

  window.PatentShareAI = {
    getActiveAIProvider: getActiveAIProvider,
    generatePatentSummary: generatePatentSummary,
    generateTechnicalElements: generateTechnicalElements,
    generateEmbodiments: generateEmbodiments,
    generateMultiPatentComparison: generateMultiPatentComparison,
    generateProcessedField: generateProcessedField,
    translatePatentText: translatePatentText,
    buildPatentContext: buildPatentContext,
    getAIPrompt: getAIPrompt,
    getPromptDefaults: getPromptDefaults,
    getProjectContextScope: getProjectContextScope,
    defaultContextScope: defaultContextScope,
    promptMeta: function () { return AI_PROMPT_META; },
    promptVersion: PROMPT_VERSION,
  };
})();
