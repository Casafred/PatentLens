import type { ExtractResult, ExtractNode, ExtractEdge, ExtractGroup, SentencePair, ExtractFrame } from '@/types/ai'

export function parseExtractResult(raw: string): ExtractResult {
  const jsonStr = extractJSON(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    const repaired = tryRepairJSON(jsonStr)
    if (repaired) {
      parsed = JSON.parse(repaired)
    } else {
      throw new Error(`JSON 解析失败，原始响应长度: ${raw.length} 字符。响应可能被截断，请尝试增大 max_tokens`)
    }
  }
  return validateExtractResult(parsed)
}

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    return braceMatch[0]
  }

  const partialBraceMatch = text.match(/\{[\s\S]*/)
  if (partialBraceMatch) {
    return partialBraceMatch[0]
  }

  throw new Error('无法从 AI 响应中提取 JSON')
}

function tryRepairJSON(jsonStr: string): string | null {
  let str = jsonStr.trim()

  try {
    JSON.parse(str)
    return str
  } catch {}

  for (let i = 0; i < 3; i++) {
    str = str.replace(/,\s*([}\]])/g, '$1')
    try {
      JSON.parse(str)
      return str
    } catch {}
  }

  let depth = 0
  let inStr = false
  let escape = false
  for (const ch of str) {
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
  }

  if (inStr) str += '"'

  while (depth > 0) {
    str += '}'
    depth--
  }

  try {
    JSON.parse(str)
    return str
  } catch {}

  return null
}

function validateExtractResult(data: unknown): ExtractResult {
  if (!data || typeof data !== 'object') {
    throw new Error('抽取结果不是有效的对象')
  }

  const result = data as Record<string, unknown>

  const claimType = result.claimType === 'method' ? 'method' as const
    : result.claimType === 'mixed' ? 'mixed' as const
    : 'structure' as const
  const nodes = validateNodes(result.nodes, claimType)
  const edges = validateEdges(result.edges, nodes, claimType)
  const groups = validateGroups(result.groups, nodes)
  let frames = validateFrames(result.frames, nodes, edges)

  if (frames.length === 0) {
    frames = generateDefaultFrames(nodes, edges, claimType)
  }

  return {
    claimType,
    claimId: '',
    nodes,
    edges,
    groups,
    translatedClaim: String(result.translatedClaim || ''),
    sentencePairs: validateSentencePairs(result.sentencePairs),
    frames,
    // AI 重构摘要：容忍并透传（普通抽取不产出该字段）
    changes: Array.isArray(result.changes)
      ? result.changes.map(c => String(c)).filter(c => c.length > 0)
      : undefined,
  }
}

function validateFrames(raw: unknown, nodes: ExtractNode[], edges: ExtractEdge[]): ExtractFrame[] {
  if (!raw || !Array.isArray(raw)) return []
  const nodeIds = new Set(nodes.map(n => n.id))
  const edgeIds = new Set(edges.map(e => e.id))

  return raw
    .filter((item: unknown): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      const f = item as Record<string, unknown>
      return typeof f.title === 'string'
    })
    .map((item: Record<string, unknown>, index: number) => {
      const highlightNodeIdsRaw = Array.isArray(item.highlightNodeIds) ? item.highlightNodeIds as unknown[] : []
      const highlightEdgeIdsRaw = Array.isArray(item.highlightEdgeIds) ? item.highlightEdgeIds as unknown[] : []

      const highlightNodeIds = highlightNodeIdsRaw
        .map(id => String(id))
        .filter(id => nodeIds.has(id))

      const highlightEdgeIds = highlightEdgeIdsRaw
        .map(id => String(id))
        .filter(id => edgeIds.has(id))

      const frameTypeRaw = String(item.type || 'structure')
      const frameType: 'structure' | 'process' | 'logic' =
        frameTypeRaw === 'process' ? 'process'
        : frameTypeRaw === 'logic' ? 'logic'
        : 'structure'

      return {
        index: typeof item.index === 'number' ? item.index : index,
        title: String(item.title),
        type: frameType,
        narration: item.narration ? String(item.narration) : undefined,
        highlightNodeIds,
        highlightEdgeIds,
        claimSpan: Array.isArray(item.claimSpan) && item.claimSpan.length === 2
          ? [Number(item.claimSpan[0]), Number(item.claimSpan[1])] as [number, number]
          : undefined,
      }
    })
    .filter(f => f.highlightNodeIds.length > 0 || f.highlightEdgeIds.length > 0)
    .sort((a, b) => a.index - b.index)
    .map((f, i) => ({ ...f, index: i }))
}

function generateDefaultFrames(
  nodes: ExtractNode[],
  edges: ExtractEdge[],
  claimType: 'structure' | 'method' | 'mixed'
): ExtractFrame[] {
  if (nodes.length <= 5) {
    return []
  }

  const frames: ExtractFrame[] = []
  const minLevel = Math.min(...nodes.map(n => n.hierarchyLevel))
  const coreNodes = nodes.filter(n => n.hierarchyLevel === minLevel)

  const coreNodeIds = new Set(coreNodes.map(n => n.id))
  const coreEdgeIds = edges
    .filter(e => coreNodeIds.has(e.source) && coreNodeIds.has(e.target))
    .map(e => e.id)

  frames.push({
    index: 0,
    title: '整体结构',
    type: 'structure',
    narration: '展示核心部件及其主要连接关系',
    highlightNodeIds: coreNodes.map(n => n.id),
    highlightEdgeIds: coreEdgeIds,
  })

  if (claimType === 'method' || claimType === 'mixed') {
    const stepNodes = nodes.filter(n => n.nodeType === 'step' || n.nodeType === 'decision' || n.nodeType === 'condition')
    if (stepNodes.length >= 3) {
      const mid = Math.ceil(stepNodes.length / 2)
      const firstHalf = stepNodes.slice(0, mid)
      const secondHalf = stepNodes.slice(mid)

      const firstHalfIds = new Set(firstHalf.map(n => n.id))
      const secondHalfIds = new Set(secondHalf.map(n => n.id))

      frames.push({
        index: 1,
        title: '流程阶段一',
        type: 'process',
        narration: '展示前半部分处理步骤',
        highlightNodeIds: [...coreNodes.map(n => n.id), ...firstHalf.map(n => n.id)],
        highlightEdgeIds: edges.filter(e =>
          firstHalfIds.has(e.source) || firstHalfIds.has(e.target)
        ).map(e => e.id),
      })

      frames.push({
        index: 2,
        title: '流程阶段二',
        type: 'process',
        narration: '展示后半部分处理步骤',
        highlightNodeIds: [...coreNodes.map(n => n.id), ...secondHalf.map(n => n.id)],
        highlightEdgeIds: edges.filter(e =>
          secondHalfIds.has(e.source) || secondHalfIds.has(e.target)
        ).map(e => e.id),
      })
    }
  }

  return frames.length >= 2 ? frames : []
}

function validateNodes(raw: unknown, claimType: 'structure' | 'method' | 'mixed'): ExtractNode[] {
  if (!Array.isArray(raw)) throw new Error('nodes 必须是数组')
  const ids = new Set<string>()

  const structureTypes = ['component', 'subsystem', 'feature']
  const methodTypes = ['step', 'decision', 'condition']
  // mixed 类型允许所有节点类型
  const validTypes = claimType === 'method' ? methodTypes
    : claimType === 'mixed' ? [...structureTypes, ...methodTypes]
    : structureTypes

  return raw.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error(`nodes[${index}] 不是有效对象`)
    const node = item as Record<string, unknown>

    const id = String(node.id || `n${index + 1}`)
    if (ids.has(id)) throw new Error(`节点 ID 重复: ${id}`)
    ids.add(id)

    if (!node.originalText) throw new Error(`nodes[${index}] 缺少 originalText`)
    if (!node.chineseText) throw new Error(`nodes[${index}] 缺少 chineseText`)

    const nodeType = validTypes.includes(node.nodeType as string)
      ? node.nodeType as ExtractNode['nodeType']
      : (claimType === 'method' ? 'step' : 'component')

    return {
      id,
      originalText: String(node.originalText),
      chineseText: String(node.chineseText),
      nodeType,
      hierarchyLevel: typeof node.hierarchyLevel === 'number' ? node.hierarchyLevel : 0,
      sourceSentence: String(node.sourceSentence || ''),
    }
  })
}

function validateEdges(raw: unknown, nodes: ExtractNode[], claimType: 'structure' | 'method' | 'mixed'): ExtractEdge[] {
  if (!Array.isArray(raw)) throw new Error('edges 必须是数组')
  const nodeIds = new Set(nodes.map(n => n.id))

  const structureTypes = ['position', 'action', 'containment', 'logical', 'attribute']
  const methodTypes = ['sequence', 'branch_true', 'branch_false', 'trigger', 'feedback', 'parallel', 'attribute']
  // mixed 类型允许所有边类型
  const validTypes = claimType === 'method' ? methodTypes
    : claimType === 'mixed' ? [...structureTypes, ...methodTypes]
    : structureTypes

  return raw.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error(`edges[${index}] 不是有效对象`)
    const edge = item as Record<string, unknown>

    const source = String(edge.source)
    const target = String(edge.target)
    if (!nodeIds.has(source)) throw new Error(`edges[${index}] source "${source}" 不存在于节点中`)
    if (!nodeIds.has(target)) throw new Error(`edges[${index}] target "${target}" 不存在于节点中`)

    let relationType = validTypes.includes(edge.relationType as string)
      ? edge.relationType as ExtractEdge['relationType']
      : (claimType === 'method' ? 'sequence' : 'position')

    // 自环边（source 与 target 相同，如"彼此可滑动地连接"）按属性处理，
    // 渲染为节点属性标签，避免校验报错导致无法绘制
    if (source === target && relationType !== 'attribute') {
      relationType = 'attribute'
    }

    if (!edge.originalText) throw new Error(`edges[${index}] 缺少 originalText`)
    if (!edge.chineseText) throw new Error(`edges[${index}] 缺少 chineseText`)

    return {
      id: String(edge.id || `e${index + 1}`),
      source,
      target,
      originalText: String(edge.originalText),
      chineseText: String(edge.chineseText),
      relationType,
    }
  })
}

function validateGroups(raw: unknown, nodes: ExtractNode[]): ExtractGroup[] {
  if (!raw) return []
  if (!Array.isArray(raw)) throw new Error('groups 必须是数组')
  const nodeIds = new Set(nodes.map(n => n.id))

  return raw.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error(`groups[${index}] 不是有效对象`)
    const group = item as Record<string, unknown>

    const label = group.label as { original?: string; chinese?: string } | undefined
    const memberNodeIds = Array.isArray(group.memberNodeIds)
      ? (group.memberNodeIds as string[]).filter(id => nodeIds.has(id))
      : []

    return {
      id: String(group.id || `g${index + 1}`),
      label: {
        original: label?.original || '',
        chinese: label?.chinese || '',
      },
      memberNodeIds,
    }
  })
}

function validateSentencePairs(raw: unknown): SentencePair[] {
  if (!raw || !Array.isArray(raw)) return []

  return raw
    .filter((item: unknown): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      const pair = item as Record<string, unknown>
      return typeof pair.original === 'string' && typeof pair.translation === 'string'
    })
    .map((pair: Record<string, unknown>) => ({
      original: String(pair.original),
      translation: String(pair.translation),
    }))
}
