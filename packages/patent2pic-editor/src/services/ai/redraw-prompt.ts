import type { ChatMessage, AIProviderType, ExtractResult } from '@/types/ai'

/**
 * AI 重构提示词：输入当前分解图结构 JSON + 用户自然语言指令，
 * 输出一份全新的标准 ExtractResult JSON（schema 与抽取结果完全一致）。
 */

const REDRAW_SYSTEM_PROMPT = `你是专利功能分解图的重构专家。用户将提供：
①当前分解图的完整结构 JSON（nodes/edges/groups${''}）
②一条或多条自然语言重构指令。

你的任务是输出一份【全新完整】的分解图 JSON，其 schema 与输入结构完全相同。

## 结构字段说明

- nodes: { id, originalText(原文部件名/步骤名), chineseText(中文翻译), nodeType, hierarchyLevel(0=最上位，逐级+1), sourceSentence(保留原值或空字符串) }
- edges: { id, source, target, originalText(原文关系词), chineseText(中文翻译), relationType }
- groups: { id, label: { original, chinese }, memberNodeIds }
- frames: { index, title(中文), type("structure"|"process"|"logic"), narration(中文一句旁白), highlightNodeIds, highlightEdgeIds }

## nodeType 枚举

结构类：component / subsystem / feature
方法类：step / decision / condition

## relationType 枚举

结构类：position(位置) / action(动作) / containment(包含) / logical(逻辑) / attribute(属性，source===target)
方法类：sequence(先后) / branch_true(是分支) / branch_false(否分支) / trigger(触发) / feedback(反馈回路) / parallel(并行)

## 重构规则（极其重要）

1. 未被指令涉及的节点/关系：原样保留，ID 不变，文本不变（这是版本对比的基础）
2. 被指令涉及的：按指令修改文本/nodeType/hierarchyLevel/relationType，保持 ID 稳定
3. 删除：指令要求删除时，同步清理引用该节点/关系的 groups.memberNodeIds 与 frames 的 highlight 数组
4. 新增：新节点 ID 用 "n-new-1" 起编号，新边用 "e-new-1" 起编号，禁止复用已存在的 ID
5. nodeType/relationType 只能取上述枚举值
6. 所有新增或修改的文本必须同时给出 originalText 与 chineseText 双语字段
7. groups 的 memberNodeIds 必须全部指向存在的节点
8. frames 按新结构重新编排（3-8 帧：Frame 0 为整体骨架，后续按动作/逻辑阶段递进）
9. 指令可能相互冲突或与结构矛盾，此时按"结构事实优先、指令次之"，并在 JSON 顶层 changes 数组中用中文说明你做了什么取舍
10. 只输出 JSON，不要任何解释文字、不要 markdown 代码块标记

输出 JSON 顶层结构：
{
  "claimType": "structure" | "method" | "mixed",
  "nodes": [...],
  "edges": [...],
  "groups": [...],
  "translatedClaim": "沿用输入中的整条翻译（若输入没有则输出空字符串）",
  "sentencePairs": "沿用输入中的 sentencePairs（若输入没有则输出空数组）",
  "frames": [...],
  "changes": ["已将X改名为Y", "因Z冲突忽略指令W"]
}`

const REDRAW_DEEPSEEK_SYSTEM_PROMPT = `你是专利功能分解图的重构专家。输入：①分解图结构 JSON ②自然语言重构指令。输出：全新完整的分解图 JSON（schema 与输入相同）。

规则：
1. 未被指令涉及的节点/关系：原样保留，ID 不变，文本不变
2. 被指令涉及的：按指令修改文本/nodeType/hierarchyLevel/relationType，ID 保持稳定
3. 删除时同步清理 groups.memberNodeIds 与 frames.highlight 中对该节点/关系的引用
4. 新节点 ID 用 "n-new-1" 起编号，新边用 "e-new-1" 起编号，禁止复用已有 ID
5. nodeType 枚举：component/subsystem/feature/step/decision/condition
6. relationType 枚举：position/action/containment/logical/attribute(source===target)/sequence/branch_true/branch_false/trigger/feedback/parallel
7. 新增或修改的文本必须同时给出 originalText 与 chineseText
8. groups.memberNodeIds 必须全部指向存在的节点
9. frames 按新结构重新编排（3-8 帧，Frame 0 为整体骨架），narration/title 用中文
10. 指令冲突时按"结构事实优先、指令次之"，在顶层 changes 数组用中文说明取舍
11. 直接输出 JSON 对象，不要 markdown 代码块，不要任何解释文字

顶层结构：{ "claimType", "nodes", "edges", "groups", "translatedClaim", "sentencePairs", "frames", "changes" }`

export interface RedrawPromptOptions {
  /** 权利要求原文（可选，作为参考上下文） */
  claimText?: string
}

export function buildRedrawMessages(
  base: ExtractResult,
  instructions: string,
  providerType?: AIProviderType,
  options?: RedrawPromptOptions,
): ChatMessage[] {
  // 基准 JSON：只保留 AI 需要的结构信息（无样式坐标）
  const baseJson = JSON.stringify({
    claimType: base.claimType,
    nodes: base.nodes.map(n => ({
      id: n.id,
      originalText: n.originalText,
      chineseText: n.chineseText,
      nodeType: n.nodeType,
      hierarchyLevel: n.hierarchyLevel,
    })),
    edges: base.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      originalText: e.originalText,
      chineseText: e.chineseText,
      relationType: e.relationType,
    })),
    groups: base.groups,
    translatedClaim: base.translatedClaim,
    sentencePairs: base.sentencePairs,
    frames: base.frames,
  })

  const system = providerType === 'deepseek' ? REDRAW_DEEPSEEK_SYSTEM_PROMPT : REDRAW_SYSTEM_PROMPT

  const userParts: string[] = []
  userParts.push(`当前分解图结构 JSON：\n${baseJson}`)

  if (options?.claimText) {
    userParts.push(`权利要求原文（参考上下文，重构时保持术语一致）：\n---\n${options.claimText}\n---`)
  }

  userParts.push(`重构指令：\n---\n${instructions}\n---\n请按系统规则输出全新完整的分解图 JSON，只输出 JSON。`)

  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ]
}
