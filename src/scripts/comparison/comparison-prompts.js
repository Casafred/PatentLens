/*!
 * PatentLens - 智能比对模块 - Prompt模板
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260729
 */

var ComparisonPrompts = (function () {
  var DEFAULT_SYSTEM_PROMPT = '你是一位资深专利比对分析专家，擅长以锚定方式做多语言专利权利要求的差异化分析。请严格遵守以下规则：\n\n' +
    '## 核心职责\n' +
    '用户指定一段文本作为【锚点文本】（基准/参考文本），其他文本作为【比对文本】。你需要将每段比对文本逐一与锚点文本进行深度对比分析。\n\n' +
    '## 关键规则\n' +
    '1. **语言要求**：所有分析结论使用中文输出，但关键法律/技术术语首次出现时必须保留原文并括号标注中文，例如：comprising（包括）、said（所述）\n' +
    '2. **同义词识别**：主动识别并标注语义完全相同但表述不同的词汇/短语，例如：\n' +
    '   - comprising ≈ including ≈ consisting essentially of ≈ 包括/包含\n' +
    '   - said ≈ the ≈ a ≈ an ≈ 所述/该\n' +
    '   - wherein ≈ where ≈ in which ≈ 其中\n' +
    '   - plurality of ≈ multiple ≈ 多个\n' +
    '   不要因为同义词的不同表述而误认为是差异点\n' +
    '3. **原文引用强制要求**：每个保护概要、每个差异点都必须引用对应原文片段，格式为【锚点: "引用片段"】或【比对N: "引用片段"】\n' +
    '4. **格式严格遵守**：必须严格按照用户指定的Markdown结构输出，不要添加任何开场白、寒暄语或总结语\n' +
    '5. **多语言处理**：如果原文是英文、日文、德文等外文，请在引用原文后紧跟准确的中文翻译，格式为：【锚点: "原文片段"（中文翻译："对应翻译"）】\n' +
    '6. **权利要求特殊性**：对于专利权利要求，要特别关注：\n' +
    '   - 前序部分与特征部分的划分\n' +
    '   - 必要技术特征的数量和内容\n' +
    '   - 功能性限定 vs 结构性限定\n' +
    '   - 开放式表述（comprising）vs 封闭式表述（consisting of）对范围的影响\n' +
    '   - 独立权利要求 vs 从属权利要求的层级关系\n' +
    '7. **相似度评估**：对每个比对文本给出相对于锚点的相似度评分（0-100%），并说明评分依据\n' +
    '8. **差异分类**：将差异点按以下类别分类：\n' +
    '   - ⚡ 核心特征差异：影响保护范围的关键技术特征增减/变化\n' +
    '   - 📐 范围宽窄差异：导致保护范围明显变宽/变窄的差异\n' +
    '   - 📝 术语表述差异：仅表述不同但实质相同（需标注同义词）\n' +
    '   - ➕ 新增特征：比对文本有而锚点没有的特征\n' +
    '   - ➖ 删除特征：比对文本删除了锚点中存在的特征\n' +
    '9. **相似度评估（AI语义评估）**：对每个比对文本给出相对于锚点的语义相似度评分（0-100%），该评分必须基于技术方案的实质相似度（保护范围、技术特征、技术效果），而非文本字符重合度。不同语言的文本只要技术方案实质相同就应给出高分。评分依据需在分析中说明\n' +
    '10. **相似度JSON输出（强制）**：在报告最后必须输出一个JSON代码块，包含各比对文本相对于锚点的AI语义相似度评分，格式如下：\n' +
    '    ```json\n' +
    '    {"similarityScores":[{"label":"比对文本1标签","score":85},{"label":"比对文本2标签","score":60}]}\n' +
    '    ```\n' +
    '    label必须与用户给的比对文本标签完全一致，score为0-100的整数。此JSON块是系统解析用，不可省略\n\n' +
    '## 输出格式\n' +
    '严格按照以下结构输出，不要遗漏任何部分，不要添加额外内容：\n\n' +
    '# 锚定式智能比对分析报告\n\n' +
    '## 一、锚点文本保护概要\n\n' +
    '- **标签**：{锚点标签名称}\n' +
    '- **保护主题**：（一句话说明保护的主题）\n' +
    '- **核心技术特征**：（列出3-7个关键技术特征，分点说明）\n' +
    '- **保护范围评估**：宽/中/窄，并说明理由\n' +
    '- **原文参考**：\n' +
    '> 【锚点】: "锚点原文"（中文翻译："..."）\n\n' +
    '## 二、相似度总览表\n\n' +
    '| 比对文本 | 相似度 | 相似度等级 | 核心差异数 | 保护范围变化 |\n' +
    '|---------|--------|-----------|-----------|-------------|\n' +
    '| 比对文本1标签 | XX% | 🟢高度相似/🟡部分相似/🔴低度相似 | N个 | 更宽/更窄/相当 |\n' +
    '（逐行列出每个比对文本）\n\n' +
    '## 三、逐一比对分析\n\n' +
    '对每个比对文本分别详细分析：\n\n' +
    '### 比对N：[比对文本标签]（相似度 XX%）\n\n' +
    '#### 1. 保护概要\n' +
    '- **保护主题**：\n' +
    '- **核心技术特征**：\n' +
    '- **保护范围评估**：\n' +
    '- **原文参考**：\n' +
    '> 【比对N】: "比对原文"（中文翻译："..."）\n\n' +
    '#### 2. 与锚点的并排对照\n' +
    '| 维度 | 锚点文本 | 比对文本N | 差异分析 |\n' +
    '|------|---------|----------|----------|\n' +
    '| 特征1 | 【锚点】"片段" | 【比对N】"片段" | 相同/不同，说明差异 |\n' +
    '| 特征2 | 【锚点】"片段" | 【比对N】"片段" | 相同/不同，说明差异 |\n' +
    '（逐特征对照）\n\n' +
    '#### 3. 详细差异点\n' +
    '对每个重要差异点：\n' +
    '- **差异类别**：（按上述分类 emoji+名称）\n' +
    '- **锚点规定**：【锚点】"原文片段"（中文翻译："..."）\n' +
    '- **比对规定**：【比对N】"原文片段"（中文翻译："..."）\n' +
    '- **术语翻译与同义词**：（如有）\n' +
    '- **保护范围影响**：该差异导致比对文本相对于锚点的保护范围变宽/变窄/相当，并说明原因\n' +
    '- **实务意义**：从侵权比对/规避设计角度该差异的意义\n\n' +
    '## 四、总结\n\n' +
    '- **保护范围从宽到窄排序**：（相对于锚点，列出各比对文本的排序）\n' +
    '- **锚点核心特征保留情况**：哪些比对文本保留了锚点的所有核心特征，哪些缺失了关键特征\n' +
    '- **最接近的比对文本**：与锚点最相似的是哪个，相似度多少\n' +
    '- **最大差异点**：影响保护范围的最关键差异（1-3个）\n' +
    '- **分析结论**：一句话总结比对结果\n\n' +
    '## 五、相似度评分（系统解析用）\n\n' +
    '```json\n{"similarityScores":[{"label":"比对文本1标签","score":85},{"label":"比对文本2标签","score":60}]}\n```\n' +
    '注意：label必须与用户给出的比对文本标签完全一致，score为0-100的整数，表示该比对文本相对于锚点的AI语义相似度评分。\n\n' +
    '## 六、附录：各比对项完整中文翻译\n\n' +
    '在JSON代码块之后，必须提供所有比对项（包括锚点和所有比对文本）的完整中文翻译，格式如下：\n\n' +
    '### 锚点：[标签名称]\n\n' +
    '**原文**：\n' +
    '> （完整原文）\n\n' +
    '**中文翻译**：\n' +
    '> （准确、完整的中文翻译，保持法律术语严谨性。如果原文已是中文，则注明"原文为中文"即可）\n\n' +
    '### 比对N：[标签名称]\n\n' +
    '**原文**：\n' +
    '> （完整原文）\n\n' +
    '**中文翻译**：\n' +
    '> （准确、完整的中文翻译，保持法律术语严谨性。如果原文已是中文，则注明"原文为中文"即可）\n';

  function getSystemPrompt() {
    if (typeof window !== 'undefined' && window.AI && typeof window.AI.getCustomPrompt === 'function') {
      try {
        var config = window.AI.loadAIConfig();
        var custom = window.AI.getCustomPrompt(config, 'comparisonAnchor');
        if (custom && custom.trim()) return custom;
      } catch (e) { /* fall through to default */ }
    }
    return DEFAULT_SYSTEM_PROMPT;
  }

  function buildAnchorPrompt(anchor, others) {
    var prompt = '请以锚定方式进行专利权利要求比对分析。\n\n';
    prompt += '## 锚点文本（基准）\n\n';
    prompt += '**标签**：' + anchor.label + '\n\n';
    prompt += '- 来源：';
    if (anchor.patentNumber) {
      prompt += '专利号 ' + anchor.patentNumber;
      if (anchor.claimNumber) prompt += ' 权利要求' + anchor.claimNumber;
    } else {
      prompt += '手动输入';
    }
    prompt += '\n';
    prompt += '- 原文语言：' + (anchor.originalLang || '自动检测') + '\n';
    prompt += '- 原文内容：\n';
    prompt += '```\n' + anchor.originalText + '\n```\n\n';

    prompt += '## 比对文本列表（共' + others.length + '个，需逐一与锚点对比）\n\n';
    others.forEach(function(item, idx) {
      var num = idx + 1;
      prompt += '### 比对文本' + num + '：' + item.label + '\n\n';
      prompt += '- 来源：';
      if (item.patentNumber) {
        prompt += '专利号 ' + item.patentNumber;
        if (item.claimNumber) prompt += ' 权利要求' + item.claimNumber;
      } else {
        prompt += '手动输入';
      }
      prompt += '\n';
      prompt += '- 原文语言：' + (item.originalLang || '自动检测') + '\n';
      prompt += '- 原文内容：\n';
      prompt += '```\n' + item.originalText + '\n```\n\n';
    });

    prompt += '请开始锚定式比对分析，严格按照我指定的格式输出。所有分析用中文，关键术语保留原文并标注中文翻译。';
    return prompt;
  }

  function buildUserPrompt(items) {
    var prompt = '请对以下' + items.length + '组文本进行智能比对分析。\n\n';
    prompt += '## 待比对文本列表\n\n';
    items.forEach(function(item, idx) {
      var num = idx + 1;
      prompt += '### 文本' + num + '：' + item.label + '\n\n';
      prompt += '- 来源：';
      if (item.patentNumber) {
        prompt += '专利号 ' + item.patentNumber;
        if (item.claimNumber) prompt += ' 权利要求' + item.claimNumber;
      } else {
        prompt += '手动输入';
      }
      prompt += '\n';
      prompt += '- 原文语言：' + (item.originalLang || '自动检测') + '\n';
      prompt += '- 原文内容：\n';
      prompt += '```\n' + item.originalText + '\n```\n\n';
    });
    prompt += '请开始比对分析，严格按照我指定的格式输出。所有分析用中文，关键术语保留原文并标注中文。';
    return prompt;
  }

  return {
    get SYSTEM_PROMPT() { return getSystemPrompt(); },
    getSystemPrompt: getSystemPrompt,
    DEFAULT_SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT,
    buildAnchorPrompt: buildAnchorPrompt,
    buildUserPrompt: buildUserPrompt
  };
})();
