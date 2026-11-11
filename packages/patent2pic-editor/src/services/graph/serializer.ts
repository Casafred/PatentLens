import type { GraphJSON, NodeData, EdgeData, GroupData } from '@/types/graph'

export function serializeGraph(
  nodes: NodeData[],
  edges: EdgeData[],
  groups: GroupData[],
  claimId: string,
  viewport?: { x: number; y: number; zoom: number },
): GraphJSON {
  return {
    version: '1.0.0',
    claimId,
    nodes,
    edges,
    groups,
    viewport: viewport ?? { x: 0, y: 0, zoom: 1 },
  }
}

export function deserializeGraph(json: GraphJSON): {
  nodes: NodeData[]
  edges: EdgeData[]
  groups: GroupData[]
  claimId: string
  viewport: { x: number; y: number; zoom: number }
} {
  if (!json.version) {
    throw new Error('无效的项目文件：缺少版本号')
  }
  return {
    nodes: json.nodes,
    edges: json.edges,
    groups: json.groups,
    claimId: json.claimId,
    viewport: json.viewport,
  }
}
