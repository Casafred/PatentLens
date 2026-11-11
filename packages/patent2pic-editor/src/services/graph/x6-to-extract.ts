import type { ExtractResult, ExtractNode, ExtractEdge, ExtractGroup, ExtractFrame, SentencePair } from '@/types/ai'

/**
 * 基准转换器：把 X6 画布 JSON 转换为标准 ExtractResult，
 * 作为 AI 重构的基准输入（含用户手动编辑后的节点文字与关系）。
 *
 * 过滤规则（与 engine.ts 的渲染规则对应）：
 * - isForkNode 分叉伪节点 → 剔除（其承载的边由 branch 边还原）
 * - isAttributeTag 属性标签 → 还原为 source===target 的 attribute 边
 * - isGroup 组合框节点 → 还原为 ExtractGroup
 * - isTrunk/isAttributeStem 边 → 剔除（真实信息在 branch 边 / 属性标签上）
 * - 丢弃样式与坐标（AI 重构不需要）
 */

interface X6Cell {
  id: string
  shape?: string
  source?: { cell?: string }
  target?: { cell?: string }
  data?: Record<string, unknown>
}

const METHOD_NODE_TYPES = new Set(['step', 'decision', 'condition'])
const STRUCTURE_NODE_TYPES = new Set(['component', 'subsystem', 'feature'])

function isNodeCell(cell: X6Cell): boolean {
  const data = cell.data
  // 边标记优先：trunk/branch/stem 边即使缺少 source/target 字段也不应被当作节点
  if (data?.isTrunk || data?.isBranch || data?.isAttributeStem) return false
  return !cell.source && !cell.target
}

export interface X6ToExtractOptions {
  /** 原始抽取结果的 frames（保留原图动画帧时嵌入基准） */
  frames?: ExtractFrame[]
  /** 原始抽取结果的整条翻译（作为基准上下文） */
  translatedClaim?: string
  /** 原始抽取结果的句子对照（作为基准上下文） */
  sentencePairs?: SentencePair[]
}

export function x6ToExtractResult(json: Record<string, unknown>, options?: X6ToExtractOptions): ExtractResult {
  const cells = (Array.isArray(json.cells) ? json.cells : []) as X6Cell[]

  const nodes: ExtractNode[] = []
  const edges: ExtractEdge[] = []
  const groups: ExtractGroup[] = []

  // forkNodeId → realSourceId（来自 trunk 边），branch 边用它还原真实 source
  const trunkSourceByFork = new Map<string, string>()

  for (const cell of cells) {
    const data = cell.data
    if (data?.isTrunk && typeof data.forkNodeId === 'string' && typeof data.realSourceId === 'string') {
      trunkSourceByFork.set(data.forkNodeId, data.realSourceId)
    }
  }

  for (const cell of cells) {
    const data = cell.data

    if (isNodeCell(cell)) {
      if (data?.isForkNode) continue

      // 属性标签：还原为 source===target 的 attribute 边
      if (data?.isAttributeTag) {
        const sourceNodeId = String(data.sourceNodeId || '')
        if (sourceNodeId) {
          edges.push({
            id: String(data.attributeEdgeId || `attr-${cell.id}`),
            source: sourceNodeId,
            target: sourceNodeId,
            originalText: String(data.originalText || ''),
            chineseText: String(data.chineseText || ''),
            relationType: 'attribute',
          })
        }
        continue
      }

      // 组合框：还原为 ExtractGroup
      if (data?.isGroup) {
        const label = (data.label as ExtractGroup['label']) || { original: '', chinese: '' }
        const memberNodeIds = Array.isArray(data.memberNodeIds)
          ? (data.memberNodeIds as unknown[]).map(id => String(id))
          : []
        groups.push({ id: cell.id, label, memberNodeIds })
        continue
      }

      // 普通节点（用户手动改过的文字存在 data 中，优先进入基准）
      nodes.push({
        id: cell.id,
        originalText: String(data?.originalText || ''),
        chineseText: String(data?.chineseText || ''),
        nodeType: normalizeNodeType(data?.nodeType),
        hierarchyLevel: typeof data?.hierarchyLevel === 'number' ? data.hierarchyLevel : 0,
        sourceSentence: '',
      })
      continue
    }

    // ===== 边 =====
    if (data?.isAttributeStem) continue
    if (data?.isTrunk) continue

    if (data?.isBranch) {
      const forkNodeId = String(data.forkNodeId || '')
      edges.push({
        id: String(data.originalEdgeId || cell.id),
        source: trunkSourceByFork.get(forkNodeId) || '',
        target: String(data.realTargetId || cell.target?.cell || ''),
        originalText: String(data.originalText || ''),
        chineseText: String(data.chineseText || ''),
        relationType: normalizeRelationType(data.relationType),
      })
      continue
    }

    // 普通边：_origSourceId/_origTargetId 记录了合并前的真实端点，优先使用
    edges.push({
      id: cell.id,
      source: String(data?._origSourceId || cell.source?.cell || ''),
      target: String(data?._origTargetId || cell.target?.cell || ''),
      originalText: String(data?.originalText || ''),
      chineseText: String(data?.chineseText || ''),
      relationType: normalizeRelationType(data?.relationType),
    })
  }

  // 清理：端点不存在的边、成员不存在的组
  const nodeIds = new Set(nodes.map(n => n.id))
  const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
  const validGroups = groups
    .map(g => ({ ...g, memberNodeIds: g.memberNodeIds.filter(id => nodeIds.has(id)) }))
    .filter(g => g.memberNodeIds.length > 0)

  return {
    claimType: deriveClaimType(nodes),
    claimId: '',
    nodes,
    edges: validEdges,
    groups: validGroups,
    translatedClaim: options?.translatedClaim || '',
    sentencePairs: options?.sentencePairs || [],
    frames: options?.frames,
  }
}

function normalizeNodeType(raw: unknown): ExtractNode['nodeType'] {
  const t = String(raw || '')
  if (METHOD_NODE_TYPES.has(t)) return t as ExtractNode['nodeType']
  return STRUCTURE_NODE_TYPES.has(t) ? (t as ExtractNode['nodeType']) : 'component'
}

function normalizeRelationType(raw: unknown): ExtractEdge['relationType'] {
  const t = String(raw || '')
  const valid = new Set(['position', 'action', 'containment', 'logical', 'attribute',
    'sequence', 'branch_true', 'branch_false', 'trigger', 'feedback', 'parallel'])
  return valid.has(t) ? (t as ExtractEdge['relationType']) : 'position'
}

function deriveClaimType(nodes: ExtractNode[]): ExtractResult['claimType'] {
  const hasMethod = nodes.some(n => METHOD_NODE_TYPES.has(n.nodeType))
  const hasStructure = nodes.some(n => STRUCTURE_NODE_TYPES.has(n.nodeType))
  if (hasMethod && hasStructure) return 'mixed'
  if (hasMethod) return 'method'
  return 'structure'
}
