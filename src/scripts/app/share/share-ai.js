/*!
 * PatentLens - 专利分享AI加工模块
 *
 * 提供专利内容的AI自动分析能力，包括技术问题-方案-效果提取、
 * 技术要素归纳、关键参数提取、多专利对比分析等。
 */
(function () {
  "use strict";

  var SHARE_AI_PROMPTS = {
    patentSummary: '你是一位资深专利分析师，擅长将专利内容整理为研发团队易读的技术分享材料。请根据提供的专利信息，从以下维度进行结构化分析，输出Markdown格式。\n\n## 一、技术问题\n本专利要解决的**具体技术问题**是什么？现有技术存在哪些痛点、缺陷或不足？请基于摘要、权利要求和说明书内容，总结2-4个核心技术问题。\n\n## 二、技术方案\n为解决上述问题，本专利采用了哪些**核心技术手段/技术特征**？请归纳为3-7个要点，每个要点清晰说明：\n- 采用了什么结构/步骤/模块\n- 各组成部分如何连接/配合\n- 关键技术特征是什么\n\n## 三、技术效果\n这些技术手段带来了哪些**具体的技术效果或优势**？请对应技术方案分点说明效果，尽可能量化或明确效果产生的原因。\n\n## 四、权利要求保护范围分析\n基于独立权利要求，分析：\n- 独立权利要求的必要技术特征有哪些\n- 哪些特征是关键限定（决定保护范围宽窄）\n- 从属权利要求进一步限定了哪些内容\n- 初步判断保护范围是宽/中/窄，说明理由\n\n## 五、研发启发\n基于该专利，对研发团队的启示：\n- 该方案解决问题的思路有何借鉴价值\n- 哪些技术点值得关注\n- 可能的设计绕开方向（仅作技术讨论，不构成法律意见）\n\n要求：\n- 语言精炼准确，适合研发人员阅读\n- 所有结论必须基于提供的专利内容，不要编造未给出的细节\n- 使用中文输出，专业术语可保留英文原文\n- Markdown格式清晰，适当使用列表和小标题',

    technicalElements: '你是一位专利技术要素提取专家。请从提供的专利中提取**结构化技术要素**，输出为JSON格式（不要输出其他说明文字）：\n\n```json\n{\n  "components": [\n    {\n      "name": "部件/模块名称",\n      "role": "在方案中的作用",\n      "keyFeatures": ["关键特征1", "关键特征2"]\n    }\n  ],\n  "steps": [\n    {\n      "order": 1,\n      "action": "步骤描述",\n      "input": "输入",\n      "output": "输出",\n      "keyParams": ["关键参数/条件"]\n    }\n  ],\n  "parameters": [\n    {\n      "name": "参数名称",\n      "range": "数值范围/取值",\n      "unit": "单位",\n      "effect": "该参数的作用/对效果的影响"\n    }\n  ],\n  "interfaces": ["关键接口/连接关系1", "关键接口/连接关系2"],\n  "materials": ["涉及的材料/物质1", "涉及的材料/物质2"]\n}\n```\n\n请只输出符合上述格式的JSON，不要输出Markdown代码块标记以外的任何文字。',

    multiPatentComparison: '你是一位专利组合分析专家。请对以下多篇专利进行**技术路线对比分析**，帮助研发团队理解不同方案的异同和演进方向。\n\n输出Markdown格式，包含：\n\n## 一、专利组合概览\n- 涉及的技术领域\n- 各专利解决的问题侧重\n- 整体技术演进脉络\n\n## 二、技术路线对比矩阵\n以表格形式对比各专利的关键维度：\n| 维度 | 专利1 | 专利2 | ... |\n|------|-------|-------|-----|\n| 核心问题 | | | |\n| 技术路线 | | | |\n| 关键特征 | | | |\n| 主要效果 | | | |\n| 保护范围 | | | |\n\n## 三、核心差异分析\n- 各方案的本质区别是什么\n- 技术路线的演进方向\n- 不同方案的适用场景\n\n## 四、研发启示\n- 技术发展趋势总结\n- 关键技术空白点\n- 值得重点关注的专利\n\n要求：分析客观，基于提供的专利内容，不编造信息；使用中文输出。'
  };

  function getActiveAIProvider() {
    if (!window.AI) return null;
    try {
      var config = window.AI.loadAIConfig();
      return window.AI.getCurrentProvider(config);
    } catch (e) {
      return null;
    }
  }

  function buildPatentContext(patent) {
    var parts = [];
    parts.push("【专利号】" + (patent.patentNumber || "未知"));
    parts.push("【标题】" + (patent.title || "未提供"));
    if (patent.fields && patent.fields.abstract && patent.fields.abstract.value) {
      parts.push("\n【摘要】\n" + patent.fields.abstract.value);
    }
    if (patent.fields && patent.fields.assignees && patent.fields.assignees.value) {
      parts.push("\n【申请人】" + patent.fields.assignees.value);
    }
    if (patent.fields && patent.fields.inventors && patent.fields.inventors.value) {
      parts.push("\n【发明人】" + patent.fields.inventors.value);
    }
    if (patent.description) {
      var desc = patent.description;
      if (desc.length > 8000) desc = desc.slice(0, 8000) + "...(内容过长，已截断)";
      parts.push("\n【说明书】\n" + desc);
    }
    if (patent.claims && patent.claims.length) {
      parts.push("\n【权利要求书】");
      var claimsText = patent.claims.map(function (c) {
        return (c.number ? c.number + ". " : "") + (c.text || "");
      }).join("\n\n");
      if (claimsText.length > 12000) claimsText = claimsText.slice(0, 12000) + "...(内容过长，已截断)";
      parts.push(claimsText);
    }
    return parts.join("\n");
  }

  function buildMultiPatentContext(patents) {
    return patents.map(function (p, idx) {
      return "===== 专利" + (idx + 1) + " =====\n" + buildPatentContext(p);
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

  async function generatePatentSummary(patent) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      var context = buildPatentContext(patent);
      var messages = [
        { role: "system", content: SHARE_AI_PROMPTS.patentSummary },
        { role: "user", content: "请分析以下专利：\n\n" + context }
      ];
      var result = await callAI(messages);
      return {
        ok: true,
        content: result.content,
        reasoning: result.reasoning,
        model: result.model,
        generatedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function generateTechnicalElements(patent) {
    try {
      if (!patent || typeof patent !== "object") throw new Error("无效的专利数据");
      var context = buildPatentContext(patent);
      var messages = [
        { role: "system", content: SHARE_AI_PROMPTS.technicalElements },
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
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function generateMultiPatentComparison(patents) {
    try {
      if (!patents || !patents.length) throw new Error("未选择要对比的专利");
      var patentList = Array.isArray(patents) ? patents : [patents];
      if (patentList.length < 2) throw new Error("需要至少2篇专利才能进行对比分析");
      var context = buildMultiPatentContext(patentList);
      var messages = [
        { role: "system", content: SHARE_AI_PROMPTS.multiPatentComparison },
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
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  window.PatentShareAI = {
    getActiveAIProvider: getActiveAIProvider,
    generatePatentSummary: generatePatentSummary,
    generateTechnicalElements: generateTechnicalElements,
    generateMultiPatentComparison: generateMultiPatentComparison,
    buildPatentContext: buildPatentContext,
  };
})();
