import { parseExtractResult } from './extractor'
import type { ExtractResult } from '@/types/ai'

/** Strict boundary for external returns; never silently drop broken graph references. */
export function validateAgentGraph(payload: Record<string, unknown>, claimText: string): ExtractResult {
  if (!['structure', 'method', 'mixed'].includes(String(payload.claimType))) throw new Error('claimType 必须是 structure、method 或 mixed')
  if (!Array.isArray(payload.nodes) || !payload.nodes.length) throw new Error('返回结果没有可成图的节点')
  if (payload.nodes.length > 300 || !Array.isArray(payload.edges) || payload.edges.length > 600) throw new Error('节点或关系格式无效，或结果规模过大，请拆分权项后重试')
  const result = parseExtractResult(JSON.stringify(payload))
  const norm = (text: string) => text.normalize('NFKC').replace(/\s+/g, '')
  const original = norm(claimText)
  for (const node of result.nodes) {
    if (!node.sourceSentence.trim() || !original.includes(norm(node.sourceSentence)) || !original.includes(norm(node.originalText))) {
      throw new Error(`节点「${node.chineseText}」缺少可核对的原文，请让 Agent 修正 sourceSentence / originalText`)
    }
  }
  for (const edge of result.edges) {
    if (!original.includes(norm(edge.originalText))) throw new Error(`关系「${edge.chineseText}」无法在权项原文中定位，请让 Agent 保留原文关系表述`)
  }
  const allIds = [...result.nodes, ...result.edges, ...result.groups].map(item => item.id)
  if (new Set(allIds).size !== allIds.length) throw new Error('节点、关系或分组 ID 重复，请让 Agent 使用唯一编号')
  const nodeIds = new Set(result.nodes.map(node => node.id)), edgeIds = new Set(result.edges.map(edge => edge.id))
  if (Array.isArray(payload.groups)) {
    if (payload.groups.length > 300) throw new Error('分组过多，请分批返回')
    for (const raw of payload.groups) {
      const group = raw as Record<string, unknown>
      if (!Array.isArray(group.memberNodeIds) || !group.memberNodeIds.length || group.memberNodeIds.some(id => !nodeIds.has(String(id)))) {
        throw new Error('分组引用了不存在的节点或缺少成员，请让 Agent 修正 groups')
      }
    }
  }
  const rawNodes = payload.nodes as Record<string, unknown>[], rawEdges = payload.edges as Record<string, unknown>[]
  if (result.nodes.some((node, index) => node.nodeType !== rawNodes[index].nodeType)
    || result.edges.some((edge, index) => edge.relationType !== rawEdges[index].relationType && edge.source !== edge.target)) {
    throw new Error('节点或关系类型不符合当前图类型，请让 Agent 按任务中的枚举返回')
  }
  if (Array.isArray(payload.frames)) {
    if (payload.frames.length > 300) throw new Error('分步展示过多，请分批返回')
    for (const raw of payload.frames) {
      const frame = raw as Record<string, unknown>
      const nodes = frame.highlightNodeIds, edges = frame.highlightEdgeIds
      if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.some(id => !nodeIds.has(String(id))) || edges.some(id => !edgeIds.has(String(id)))) {
        throw new Error('分步展示引用了不存在的节点或关系，请让 Agent 修正 frames')
      }
    }
  }
  if (Array.isArray(payload.sentencePairs) && result.sentencePairs.length !== payload.sentencePairs.length) throw new Error('原译文对照格式不完整，请修正 sentencePairs')
  if (result.sentencePairs.length && norm(result.sentencePairs.map(pair => pair.original).join('')) !== original) {
    throw new Error('原译文对照未完整覆盖输入权项，或改变了原文顺序，请修正 sentencePairs')
  }
  return result
}
