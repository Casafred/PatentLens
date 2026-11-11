export type ClaimType = 'structure' | 'method' | 'mixed'

export type RelationType =
  // 结构类专属
  | 'position' | 'action' | 'containment'
  // 方法类专属
  | 'sequence' | 'branch_true' | 'branch_false' | 'trigger' | 'feedback' | 'parallel'
  // 共用
  | 'logical' | 'attribute'

export type NodeType =
  // 结构类
  | 'component' | 'subsystem' | 'feature'
  // 方法类
  | 'step' | 'decision' | 'condition'
export type ArrowType = 'solid-triangle' | 'hollow-triangle' | 'diamond' | 'circle' | 'none' | 'both'
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot'

export interface NodeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  strokeDasharray: string | null
  fontSize: number
  fontFamily: string
  fontColor: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  width: number
  height: number
  borderRadius: number
}

export interface EdgeStyle {
  stroke: string
  strokeWidth: number
  strokeDasharray: string | null
  arrowType: ArrowType
  fontSize: number
  fontFamily: string
  fontColor: string
  labelBgColor: string
  labelBgPadding: number
}

export interface NodeData {
  id: string
  originalText: string
  chineseText: string
  nodeType: NodeType
  hierarchyLevel: number
  style: NodeStyle
  x?: number
  y?: number
}

export interface EdgeData {
  id: string
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
  originalText: string
  chineseText: string
  relationType: RelationType
  style: EdgeStyle
}

export interface GroupData {
  id: string
  label: { original: string; chinese: string }
  memberNodeIds: string[]
  detached: boolean
  style: {
    stroke: string
    strokeDasharray: string | null
    fill: string
    borderRadius: number
  }
}

export interface GraphJSON {
  version: string
  claimId: string
  claimType?: ClaimType
  nodes: NodeData[]
  edges: EdgeData[]
  groups: GroupData[]
  viewport: { x: number; y: number; zoom: number }
}
