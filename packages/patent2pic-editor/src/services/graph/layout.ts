import ELK from 'elkjs/lib/elk.bundled.js'
import type { NodeData, EdgeData } from '@/types/graph'

export interface ElkLayoutOptions {
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL'
  nodesep?: number
  ranksep?: number
  align?: 'UL' | 'UR' | 'DL' | 'DR'
}

interface ElkNode {
  id: string
  width: number
  height: number
  layoutOptions?: Record<string, string>
  x?: number
  y?: number
}

interface ElkLabel {
  text: string
  width: number
  height: number
  layoutOptions?: Record<string, string>
}

interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
  labels?: ElkLabel[]
}

const elk = new ELK()

function directionToElk(rankdir: string): string {
  switch (rankdir) {
    case 'BT': return 'UP'
    case 'LR': return 'RIGHT'
    case 'RL': return 'LEFT'
    default: return 'DOWN'
  }
}

function estimateLabelSize(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split('\n')
  const maxLineLength = Math.max(...lines.map(l => l.length))
  const charWidth = fontSize * 0.65
  const lineHeight = fontSize * 1.6
  const width = Math.max(60, maxLineLength * charWidth * 1.5)
  const height = Math.max(20, lines.length * lineHeight * 1.5)
  return { width, height }
}

function inferDirection(nodes: NodeData[], _edges: EdgeData[]): 'LR' | 'TB' {
  const levelSet = new Set(nodes.map(n => n.hierarchyLevel ?? 0))
  const numLevels = levelSet.size

  const totalNodeWidth = nodes.reduce((sum, n) => sum + n.style.width, 0)
  const totalNodeHeight = nodes.reduce((sum, n) => sum + n.style.height, 0)
  const avgNodeWidth = totalNodeWidth / nodes.length
  const avgNodeHeight = totalNodeHeight / nodes.length

  const maxLevel = Math.max(...nodes.map(n => n.hierarchyLevel ?? 0))
  const nodesPerLevel = new Map<number, number>()
  for (const n of nodes) {
    const level = n.hierarchyLevel ?? 0
    nodesPerLevel.set(level, (nodesPerLevel.get(level) || 0) + 1)
  }
  const maxNodesPerLevel = Math.max(...nodesPerLevel.values(), 1)

  const estimatedLayerWidth = maxNodesPerLevel * (avgNodeWidth + 40)
  const estimatedLayerHeight = numLevels * (avgNodeHeight + 60)

  if (estimatedLayerWidth > estimatedLayerHeight * 1.5) {
    return 'TB'
  }

  if (numLevels <= 3 && maxNodesPerLevel > 3) {
    return 'TB'
  }

  if (maxLevel > 3 && maxNodesPerLevel <= 3) {
    return 'LR'
  }

  return 'LR'
}

export async function applyElkLayout(
  nodes: NodeData[],
  edges: EdgeData[],
  options?: ElkLayoutOptions,
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map()

  const avgNodeWidth = nodes.reduce((s, n) => s + n.style.width, 0) / nodes.length
  const avgNodeHeight = nodes.reduce((s, n) => s + n.style.height, 0) / nodes.length

  const direction = options?.rankdir ?? inferDirection(nodes, edges)

  const nodesep = options?.nodesep ?? Math.max(40, avgNodeHeight * 0.8)
  const ranksep = options?.ranksep ?? Math.max(60, avgNodeWidth * 0.5)

  const elkNodes: ElkNode[] = nodes.map(n => {
    const level = n.hierarchyLevel ?? 0
    return {
      id: n.id,
      width: n.style.width,
      height: n.style.height,
      layoutOptions: {
        'elk.layered.layering.layerId': String(level),
      },
    }
  })

  const elkEdges: ElkEdge[] = edges.map(e => {
    const labelText = e.chineseText || e.originalText
    const fontSize = 12
    const labelSize = estimateLabelSize(labelText, fontSize)

    return {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      labels: [{
        text: labelText,
        width: labelSize.width,
        height: labelSize.height,
        layoutOptions: {
          'elk.edgeLabels.placement': 'CENTER',
          'elk.edgeLabels.inline': 'true',
        },
      }],
    }
  })

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionToElk(direction),
      'elk.spacing.nodeNode': String(nodesep),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(ranksep),
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',

      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.sweepStrategy': 'CAREFUL',

      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',

      'elk.edgeRouting.orthogonalEdges': 'true',
      'elk.spacing.edgeNode': String(Math.max(30, avgNodeHeight * 0.6)),
      'elk.spacing.edgeEdge': String(Math.max(20, avgNodeHeight * 0.4)),

      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',

      'elk.layered.cycleBreaking.strategy': 'GREEDY',

      'elk.layered.edgeSpacing.factor': '1.5',

      'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT',
      'elk.layered.compaction.connectedComponents': 'true',

      'elk.layered.layering.strategy': 'LONGEST_PATH',
    },
    children: elkNodes,
    edges: elkEdges,
  }

  const layouted = await elk.layout(graph)
  const children = (layouted.children ?? []) as ElkNode[]

  const positions = new Map<string, { x: number; y: number }>()
  for (const child of children) {
    if (child.x !== undefined && child.y !== undefined) {
      positions.set(child.id, { x: child.x, y: child.y })
    }
  }

  return positions
}
