import { Graph } from '@antv/x6'
import { Selection } from '@antv/x6-plugin-selection'
import { Snapline } from '@antv/x6-plugin-snapline'
import { History } from '@antv/x6-plugin-history'
import { Clipboard } from '@antv/x6-plugin-clipboard'
import { MiniMap } from '@antv/x6-plugin-minimap'
import { Export } from '@antv/x6-plugin-export'
import { Transform } from '@antv/x6-plugin-transform'
import type { NodeData, EdgeData, ClaimType } from '@/types/graph'
import type { ExtractResult, ExtractGroup, ExtractFrame } from '@/types/ai'
import { buildNode, updateNodeStyle, calculateNodeSize } from './node-builder'
import { buildEdge, buildTrunkEdge, buildBranchEdge, updateEdgeStyle } from './edge-builder'
import { applyElkLayout, type ElkLayoutOptions } from './layout'
import { getDefaultNodeStyle, getDefaultEdgeStyle, getHierarchyNodeStyle, arrowTypeToMarker } from './style-registry'
import { setupCustomEdge, EdgeViewWithGap } from './custom-edge'
import { registerMethodShapes } from './shapes'
import { timingStart, timingEnd } from '@/utils/timing'

export class GraphEngine {
  private graph: Graph | null = null
  private initialGraphJSON: Record<string, unknown> | null = null
  private frames: ExtractFrame[] = []
  private currentFrameIndex = -1
  private originalNodeStyles = new Map<string, { opacity: number; stroke: string; strokeWidth: number; fill: string }>()
  private originalEdgeStyles = new Map<string, { opacity: number; stroke: string; strokeWidth: number; strokeDasharray: string }>()

  init(container: HTMLElement): void {
    setupCustomEdge()
    registerMethodShapes()

    this.graph = new Graph({
      container,
      autoResize: true,
      background: { color: '#f5f7fa' },
      grid: {
        visible: true,
        type: 'dot',
        args: { color: '#ddd', thickness: 1 },
      },
      panning: { enabled: true, eventTypes: ['leftMouseDown'] },
      mousewheel: { enabled: true, zoomAtMousePosition: true, modifiers: null, minScale: 0.1, maxScale: 3 },
      connecting: {
        router: { name: 'perpendicularManhattan', args: { padding: 20, step: 10 } },
        connector: { name: 'rounded', args: { radius: 8 } },
        anchor: 'center',
        connectionPoint: 'perpendicularBoundary',
        allowBlank: false,
        allowLoop: true,
        allowMulti: true,
        snap: { radius: 30 },
        createEdge() {
          this.startBatch('edge-connect')
          return this.createEdge({
            shape: 'edge-with-gap',
            view: 'edge-with-gap-view',
            router: { name: 'perpendicularManhattan', args: { padding: 20, step: 10 } },
            connector: { name: 'rounded', args: { radius: 8 } },
            attrs: {
              line: {
                stroke: '#a2b1c3',
                strokeWidth: 4.5,
                targetMarker: { name: 'block', width: 12, height: 8 },
              },
            },
            labels: [
              {
                markup: [
                  { tagName: 'rect', selector: 'bg' },
                  { tagName: 'text', selector: 'labelText' },
                ],
                attrs: {
                  bg: {
                    ref: 'labelText',
                    refWidth: 1.2,
                    refHeight: 1.4,
                    refX: -0.1,
                    refY: -0.2,
                    fill: 'transparent',
                    stroke: 'none',
                    strokeWidth: 0,
                    rx: 4,
                    ry: 4,
                    cursor: 'move',
                    pointerEvents: 'all',
                  },
                  labelText: {
                    text: '',
                    fontSize: 12,
                    fill: '#666',
                    fontWeight: 'bold',
                    textAnchor: 'middle',
                    textVerticalAnchor: 'middle',
                    lineHeight: 19,
                    stroke: '#ffffff',
                    strokeWidth: 6,
                    paintOrder: 'stroke fill',
                    strokeLinejoin: 'round',
                    pointerEvents: 'none',
                  },
                },
                position: {
                  distance: 0.5,
                  offset: { x: 0, y: 0 },
                },
              },
            ],
            data: {
              originalText: '',
              chineseText: '',
              relationType: 'position',
              style: getDefaultEdgeStyle('position'),
              labelDetached: false,
            },
            zIndex: 10,
          })
        },
        validateConnection({ edge, sourceCell, targetCell, type }) {
          if (!sourceCell || !targetCell) return false

          if (edge) {
            const edgeData = edge.getData() as Record<string, unknown> | undefined

            if (edgeData?.isTrunk) {
              const realSourceId = edgeData.realSourceId as string
              const forkNodeId = edgeData.forkNodeId as string
              if (type === 'source') {
                return sourceCell.id === realSourceId && targetCell.id === forkNodeId
              }
              return sourceCell.id === realSourceId && targetCell.id === forkNodeId
            }

            if (edgeData?.isBranch) {
              const forkNodeId = edgeData.forkNodeId as string
              const realTargetId = edgeData.realTargetId as string
              if (type === 'source') {
                return sourceCell.id === forkNodeId && targetCell.id === realTargetId
              }
              return sourceCell.id === forkNodeId && targetCell.id === realTargetId
            }

            // Only validate against stored original IDs for existing edges
            // that have both originalText and _origSourceId/_origTargetId set.
            // Newly created edges (originalText is empty) should allow connection.
            if (edgeData?.originalText !== undefined && edgeData?.originalText !== '') {
              const origSourceId = (edgeData._origSourceId as string) || edge.getSourceCellId()
              const origTargetId = (edgeData._origTargetId as string) || edge.getTargetCellId()
              return sourceCell.id === origSourceId && targetCell.id === origTargetId
            }
          }

          return true
        },
        validateEdge({ edge, type, previous }) {
          const edgeData = edge.getData() as Record<string, unknown> | undefined
          // Only validate for existing edges with non-empty originalText
          if (edgeData?.originalText !== undefined && edgeData?.originalText !== '') {
            const prevTerminal = previous as unknown as Record<string, unknown>
            const prevCellId = prevTerminal?.cell as string | undefined
            if (type === 'source') {
              const origSourceId = (edgeData._origSourceId as string) || prevCellId
              if (edge.getSourceCellId() !== origSourceId) return false
            } else {
              const origTargetId = (edgeData._origTargetId as string) || prevCellId
              if (edge.getTargetCellId() !== origTargetId) return false
            }
            // Update stored IDs with the new port info (port may have changed)
            const currentSource = edge.getSource() as unknown as Record<string, unknown>
            const currentTarget = edge.getTarget() as unknown as Record<string, unknown>
            edge.setData({
              ...edgeData,
              _origSourceId: currentSource?.cell as string || edgeData._origSourceId,
              _origTargetId: currentTarget?.cell as string || edgeData._origTargetId,
            })
          }
          return true
        },
      },
      interacting: {
        nodeMovable: true,
        edgeMovable: true,
        edgeLabelMovable: true,
        arrowheadMovable: true,
        vertexMovable: false,
        vertexAddable: false,
        vertexDeletable: false,
      },
      highlighting: {
        magnetAdsorbed: {
          name: 'stroke',
          args: { attrs: { fill: '#1890FF', stroke: '#1890FF' } },
        },
      },
    })

    this.graph.on('edge:mouseenter', ({ edge }: { edge: any }) => {
      edge.addTools([
        { name: 'source-arrowhead', args: { attrs: { fill: '#e63946', stroke: '#e63946' } } },
        { name: 'target-arrowhead', args: { attrs: { fill: '#e63946', stroke: '#e63946' } } },
      ])
    })

    this.graph.on('edge:mouseleave', ({ edge }: { edge: any }) => {
      edge.removeTools()
    })

    // Batch arrowhead drag operations so they appear as a single undo step
    // snapArrowhead calls setTerminal() on every mousemove, which creates
    // multiple history entries without batching
    let arrowheadDragging = false
    let labelDragging = false
    this.graph.on('cell:mousedown', ({ e, cell }: { e: MouseEvent; cell: any }) => {
      if (!cell || !cell.isEdge()) return
      const target = e.target as HTMLElement
      if (target && target.getAttribute('data-terminal')) {
        arrowheadDragging = true
        this.graph!.startBatch('arrowhead-drag')
      }
      // Check if the target is inside an edge label
      if (target && target.closest('.x6-edge-label')) {
        labelDragging = true
        this.graph!.startBatch('label-drag')
      }
    })
    this.graph.on('cell:mouseup', () => {
      if (arrowheadDragging) {
        arrowheadDragging = false
        this.graph!.stopBatch('arrowhead-drag')
      }
      if (labelDragging) {
        labelDragging = false
        this.graph!.stopBatch('label-drag')
      }
    })

    // Batch new edge creation so it appears as a single undo step
    this.graph.on('edge:connected', () => {
      this.graph!.stopBatch('edge-connect')
    })

    this.graph.on('blank:click', () => {
      this.clearHighlight()
    })

    this.graph.use(new Selection({
      enabled: true,
      rubberband: true,
      showNodeSelectionBox: true,
      modifiers: ['shift'],
      filter(this: Graph, cell) {
        if (cell.isNode()) {
          const data = cell.getData()
          if (data?.hidden || data?.isForkNode) return false
        }
        return true
      },
    }))
    this.graph.use(new Snapline({ enabled: true }))
    this.graph.use(new History({
      enabled: true,
      beforeAddCommand: () => {
        if (this.shouldSkipHistory()) return false
      },
    }))
    this.graph.use(new Clipboard({ enabled: true }))
    this.graph.use(new MiniMap({ width: 160, height: 100, padding: 10 }))
    this.graph.use(new Export())
    this.graph.use(new Transform({
      resizing: {
        enabled: true,
        preserveAspectRatio: false,
        allowReverse: false,
      },
    }))

    // Create a shared labels layer so edge labels render above ALL edge lines
    this.setupLabelsLayer()
  }

  destroy(): void {
    if (this.graph) {
      this.graph.dispose()
      this.graph = null
    }
  }

  /**
   * Create a shared SVG group for edge labels, positioned after all edges
   * but before nodes. This ensures all edge labels render above all edge
   * lines, fixing the issue where one edge's line covers another edge's label.
   */
  private setupLabelsLayer(): void {
    if (!this.graph) return
    const container = this.graph.container
    const viewport = (container.querySelector('.x6-graph-svg-stage') || container.querySelector('.x6-graph-svg-viewport')) as SVGElement | null
    if (!viewport) return

    const labelsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    labelsLayer.setAttribute('class', 'edge-labels-layer')
    // Insert before the first node container, or at the end if no nodes
    const firstNode = viewport.querySelector('.x6-node')
    if (firstNode) {
      viewport.insertBefore(labelsLayer, firstNode)
    } else {
      viewport.appendChild(labelsLayer)
    }
    EdgeViewWithGap.setLabelsLayer(labelsLayer)

    // When edges are removed, reorganize labels to clean up
    this.graph.on('edge:removed', () => {
      EdgeViewWithGap.scheduleLabelsReorganize()
    })
  }

  getGraph(): Graph | null {
    return this.graph
  }

  async batchBuild(result: ExtractResult, layoutOptions?: ElkLayoutOptions, isChinese: boolean = false): Promise<void> {
    if (!this.graph) return

    const claimType = result.claimType || 'structure'
    const isMethod = claimType === 'method'
    const isMixed = claimType === 'mixed'
    const timingKey = `    │  图谱 batchBuild (${claimType})`
    timingStart(timingKey)

    this.graph.startBatch('build')

    this.graph.clearCells()

    const nodeDataList: NodeData[] = result.nodes.map(n => {
      const baseStyle = getDefaultNodeStyle(n.nodeType)
      const hierarchyStyle = getHierarchyNodeStyle(n.hierarchyLevel ?? 0, n.nodeType)
      const mergedStyle = { ...baseStyle, ...hierarchyStyle }
      const size = calculateNodeSize(n.originalText, n.chineseText, isChinese, mergedStyle.fontSize, mergedStyle.fontFamily, mergedStyle.fontWeight, mergedStyle.width, mergedStyle.height)
      return {
        id: n.id,
        originalText: n.originalText,
        chineseText: n.chineseText,
        nodeType: n.nodeType,
        hierarchyLevel: n.hierarchyLevel ?? 0,
        style: { ...mergedStyle, width: size.width, height: size.height },
      }
    })

    const edgeDataList: EdgeData[] = result.edges
      .filter(e => {
        if (e.relationType === 'attribute' && e.source === e.target) return false
        // 方法类：feedback 边布局时单独处理
        if ((isMethod || isMixed) && e.relationType === 'feedback') return false
        return true
      })
      .map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        originalText: e.originalText,
        chineseText: e.chineseText,
        relationType: e.relationType,
        style: getDefaultEdgeStyle(e.relationType),
      }))

    // 方法类/混合类 feedback 边（布局后手动添加）
    const feedbackEdgeList: EdgeData[] = (isMethod || isMixed)
      ? result.edges
        .filter(e => e.relationType === 'feedback')
        .map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          originalText: e.originalText,
          chineseText: e.chineseText,
          relationType: e.relationType,
          style: getDefaultEdgeStyle(e.relationType),
        }))
      : []

    const attributeEdgeList: EdgeData[] = result.edges
      .filter(e => e.relationType === 'attribute' && e.source === e.target)
      .map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        originalText: e.originalText,
        chineseText: e.chineseText,
        relationType: e.relationType,
        style: getDefaultEdgeStyle(e.relationType),
      }))

    // Find the minimum hierarchy level (level 0 = topmost/root level)
    let minHierarchyLevel = Infinity
    for (const nodeData of nodeDataList) {
      if ((nodeData.hierarchyLevel ?? 0) < minHierarchyLevel) {
        minHierarchyLevel = nodeData.hierarchyLevel ?? 0
      }
    }
    const nodeHierarchyMap = new Map<string, number>()
    for (const nodeData of nodeDataList) {
      nodeHierarchyMap.set(nodeData.id, nodeData.hierarchyLevel ?? 0)
    }

    const autoGroupInfoMap = new Map<string, { memberNodeIds: string[]; isContainmentGroup?: boolean }>()
    const outgoingInfoMap = new Map<string, {
      containmentTargets: Set<string>
      hasOtherOutgoing: boolean
    }>()
    for (const edgeData of edgeDataList) {
      const existing = outgoingInfoMap.get(edgeData.source)
      if (edgeData.relationType === 'containment') {
        if (existing) {
          existing.containmentTargets.add(edgeData.target)
        } else {
          outgoingInfoMap.set(edgeData.source, {
            containmentTargets: new Set([edgeData.target]),
            hasOtherOutgoing: false,
          })
        }
      } else {
        if (existing) {
          existing.hasOtherOutgoing = true
        } else {
          outgoingInfoMap.set(edgeData.source, {
            containmentTargets: new Set(),
            hasOtherOutgoing: true,
          })
        }
      }
    }
    for (const [nodeId, info] of outgoingInfoMap) {
      const nodeLevel = nodeHierarchyMap.get(nodeId) ?? 0
      if (nodeLevel <= minHierarchyLevel && info.containmentTargets.size >= 1) {
        // Topmost hierarchy level nodes become group boxes themselves
        autoGroupInfoMap.set(nodeId, {
          memberNodeIds: [...info.containmentTargets],
        })
      } else if (info.containmentTargets.size >= 1) {
        // Non-topmost level nodes: keep the node, create a group box for children,
        // and replace multiple containment edges with a single edge to the group box
        autoGroupInfoMap.set(nodeId, {
          memberNodeIds: [...info.containmentTargets],
          isContainmentGroup: true,
        })
      }
    }

    timingStart(`    │    布局计算 (ELK)`)
    const methodLayoutOptions: ElkLayoutOptions | undefined = isMethod
      ? { rankdir: 'LR', nodesep: 60, ranksep: 100 }
      : layoutOptions
    const positions = await applyElkLayout(nodeDataList, edgeDataList, methodLayoutOptions)
    timingEnd(`    │    布局计算 (ELK)`)
    for (const nodeData of nodeDataList) {
      const pos = positions.get(nodeData.id)
      if (pos) {
        nodeData.x = pos.x
        nodeData.y = pos.y
      }
    }

    timingStart(`    │    添加节点和边`)
    for (const nodeData of nodeDataList) {
      const config = buildNode(nodeData, isChinese)
      this.graph.addNode(config)
    }

    if (isMethod) {
      // 方法类：直接添加所有边，不使用 fork/trunk/branch 合并
      for (const edgeData of edgeDataList) {
        const config = buildEdge(edgeData, isChinese)
        this.graph.addEdge(config)
      }

      // 方法类：添加 feedback 边（带手动路由 vertices）
      for (const feedbackEdge of feedbackEdgeList) {
        const config = buildEdge(feedbackEdge, isChinese)
        // 添加 feedback 边的绕行 vertices
        const sourceCell = this.graph.getCellById(feedbackEdge.source)
        const targetCell = this.graph.getCellById(feedbackEdge.target)
        if (sourceCell && targetCell && sourceCell.isNode() && targetCell.isNode()) {
          const sourceNode = sourceCell as unknown as { getPosition: () => { x: number; y: number }; getSize: () => { width: number; height: number } }
          const targetNode = targetCell as unknown as { getPosition: () => { x: number; y: number }; getSize: () => { width: number; height: number } }
          const sPos = sourceNode.getPosition()
          const sSize = sourceNode.getSize()
          const tPos = targetNode.getPosition()
          const tSize = targetNode.getSize()

          const bottomY = Math.max(sPos.y + sSize.height, tPos.y + tSize.height) + 60
          config.vertices = [
            { x: sPos.x + sSize.width / 2, y: bottomY },
            { x: tPos.x + tSize.width / 2, y: bottomY },
          ]
        }
        this.graph.addEdge(config)
      }
    } else if (isMixed) {
      // 混合类：结构类边使用 fork/trunk/branch 合并，方法类边直接添加
      const methodRelationTypes = ['sequence', 'branch_true', 'branch_false', 'trigger', 'feedback', 'parallel']
      const structureEdges = edgeDataList.filter(e => !methodRelationTypes.includes(e.relationType))
      const methodEdges = edgeDataList.filter(e => methodRelationTypes.includes(e.relationType))

      // 结构类边：使用 fork/trunk/branch 合并
      const mergeGroupMap = new Map<string, EdgeData[]>()
      for (const edgeData of structureEdges) {
        const key = `${edgeData.source}||${edgeData.originalText}`
        if (!mergeGroupMap.has(key)) {
          mergeGroupMap.set(key, [])
        }
        mergeGroupMap.get(key)!.push(edgeData)
      }

      const mergedEdgeIds = new Set<string>()
      for (const [, groupEdges] of mergeGroupMap) {
        const uniqueTargets = new Set(groupEdges.map(e => e.target))
        if (groupEdges.length >= 2 && uniqueTargets.size >= 2) {
          for (const edgeData of groupEdges) {
            mergedEdgeIds.add(edgeData.id)
          }
        }
      }

      const nonMergedEdges = structureEdges.filter(e => !mergedEdgeIds.has(e.id))
      const edgeDistanceMap = new Map<string, number>()
      for (const edgeData of nonMergedEdges) {
        const key = `${edgeData.source}->${edgeData.target}`
        const count = edgeDistanceMap.get(key) || 0
        edgeDistanceMap.set(key, count + 1)
      }

      const edgeIndexMap = new Map<string, number>()

      let forkGroupIndex = 0
      for (const [, groupEdges] of mergeGroupMap) {
        const uniqueTargets = new Set(groupEdges.map(e => e.target))
        if (groupEdges.length >= 2 && uniqueTargets.size >= 2) {
          const sourceId = groupEdges[0].source
          const targetIds = [...new Set(groupEdges.map(e => e.target))]
          const forkNodeId = `fork-${sourceId}-${forkGroupIndex}`
          forkGroupIndex++

          const forkPos = this.calculateForkPosition(sourceId, targetIds)

          this.graph.addNode({
            id: forkNodeId,
            x: forkPos.x,
            y: forkPos.y,
            width: 1,
            height: 1,
            shape: 'rect',
            zIndex: -10,
            attrs: {
              body: {
                fill: 'transparent',
                stroke: 'transparent',
                strokeWidth: 0,
              },
            },
            data: {
              isForkNode: true,
              sourceId,
              targetIds,
            },
          })

          const mergedIds = groupEdges.map(e => e.id)
          const trunkConfig = buildTrunkEdge(groupEdges[0], forkNodeId, mergedIds, isChinese)
          this.graph.addEdge(trunkConfig)

          for (const edgeData of groupEdges) {
            const branchConfig = buildBranchEdge(edgeData, forkNodeId)
            this.graph.addEdge(branchConfig)
          }
        }
      }

      for (const edgeData of nonMergedEdges) {
        const key = `${edgeData.source}->${edgeData.target}`
        const totalCount = edgeDistanceMap.get(key) || 1
        const currentIndex = edgeIndexMap.get(key) || 0
        edgeIndexMap.set(key, currentIndex + 1)

        const config = buildEdge(edgeData, isChinese)
        if (totalCount > 1) {
          const step = 1 / (totalCount + 1)
          const distance = step * (currentIndex + 1)
          const labels = config.labels as Record<string, unknown>[]
          if (labels && labels.length > 0) {
            const label = labels[0] as Record<string, unknown>
            label.position = { distance }
          }
        }
        this.graph.addEdge(config)
      }

      // 方法类边：直接添加
      for (const edgeData of methodEdges) {
        const config = buildEdge(edgeData, isChinese)
        this.graph.addEdge(config)
      }

      // 混合类：添加 feedback 边
      for (const feedbackEdge of feedbackEdgeList) {
        const config = buildEdge(feedbackEdge, isChinese)
        const sourceCell = this.graph.getCellById(feedbackEdge.source)
        const targetCell = this.graph.getCellById(feedbackEdge.target)
        if (sourceCell && targetCell && sourceCell.isNode() && targetCell.isNode()) {
          const sourceNode = sourceCell as unknown as { getPosition: () => { x: number; y: number }; getSize: () => { width: number; height: number } }
          const targetNode = targetCell as unknown as { getPosition: () => { x: number; y: number }; getSize: () => { width: number; height: number } }
          const sPos = sourceNode.getPosition()
          const sSize = sourceNode.getSize()
          const tPos = targetNode.getPosition()
          const tSize = targetNode.getSize()

          const bottomY = Math.max(sPos.y + sSize.height, tPos.y + tSize.height) + 60
          config.vertices = [
            { x: sPos.x + sSize.width / 2, y: bottomY },
            { x: tPos.x + tSize.width / 2, y: bottomY },
          ]
        }
        this.graph.addEdge(config)
      }
    } else {
      // 结构类：使用 fork/trunk/branch 合并同源多目标边
      const mergeGroupMap = new Map<string, EdgeData[]>()
    for (const edgeData of edgeDataList) {
      const key = `${edgeData.source}||${edgeData.originalText}`
      if (!mergeGroupMap.has(key)) {
        mergeGroupMap.set(key, [])
      }
      mergeGroupMap.get(key)!.push(edgeData)
    }

    const mergedEdgeIds = new Set<string>()
    for (const [, groupEdges] of mergeGroupMap) {
      const uniqueTargets = new Set(groupEdges.map(e => e.target))
      if (groupEdges.length >= 2 && uniqueTargets.size >= 2) {
        for (const edgeData of groupEdges) {
          mergedEdgeIds.add(edgeData.id)
        }
      }
    }

    const nonMergedEdges = edgeDataList.filter(e => !mergedEdgeIds.has(e.id))
    const edgeDistanceMap = new Map<string, number>()
    for (const edgeData of nonMergedEdges) {
      const key = `${edgeData.source}->${edgeData.target}`
      const count = edgeDistanceMap.get(key) || 0
      edgeDistanceMap.set(key, count + 1)
    }

    const edgeIndexMap = new Map<string, number>()

    let forkGroupIndex = 0
    for (const [, groupEdges] of mergeGroupMap) {
      const uniqueTargets = new Set(groupEdges.map(e => e.target))
      if (groupEdges.length >= 2 && uniqueTargets.size >= 2) {
        const sourceId = groupEdges[0].source
        const targetIds = [...new Set(groupEdges.map(e => e.target))]
        const forkNodeId = `fork-${sourceId}-${forkGroupIndex}`
        forkGroupIndex++

        const forkPos = this.calculateForkPosition(sourceId, targetIds)

        this.graph.addNode({
          id: forkNodeId,
          x: forkPos.x,
          y: forkPos.y,
          width: 1,
          height: 1,
          shape: 'rect',
          zIndex: -10,
          attrs: {
            body: {
              fill: 'transparent',
              stroke: 'transparent',
              strokeWidth: 0,
            },
          },
          data: {
            isForkNode: true,
            sourceId,
            targetIds,
          },
        })

        const mergedIds = groupEdges.map(e => e.id)
        const trunkConfig = buildTrunkEdge(groupEdges[0], forkNodeId, mergedIds, isChinese)
        this.graph.addEdge(trunkConfig)

        for (const edgeData of groupEdges) {
          const branchConfig = buildBranchEdge(edgeData, forkNodeId)
          this.graph.addEdge(branchConfig)
        }
      }
    }

    for (const edgeData of nonMergedEdges) {
      const key = `${edgeData.source}->${edgeData.target}`
      const totalCount = edgeDistanceMap.get(key) || 1
      const currentIndex = edgeIndexMap.get(key) || 0
      edgeIndexMap.set(key, currentIndex + 1)

      const config = buildEdge(edgeData, isChinese)
      if (totalCount > 1) {
        const step = 1 / (totalCount + 1)
        const distance = step * (currentIndex + 1)
        const labels = config.labels as Record<string, unknown>[]
        if (labels && labels.length > 0) {
          const label = labels[0] as Record<string, unknown>
          label.position = { distance }
        }
      }
      this.graph.addEdge(config)
    }
    } // end of else (structure type)

    timingEnd(`    │    添加节点和边`)

    // Render attribute edges as property tags
    if (attributeEdgeList.length > 0) {
      this.renderAttributeTags(attributeEdgeList, isChinese, claimType)
    }

    if (autoGroupInfoMap.size > 0) {
      this.convertAutoGroupNodes(autoGroupInfoMap, isChinese)
    }

    if (result.groups && result.groups.length > 0) {
      const autoGroupMemberSets: Set<string>[] = []
      const autoGroupSourceIds = new Set<string>()
      for (const [sourceId, info] of autoGroupInfoMap) {
        autoGroupMemberSets.push(new Set(info.memberNodeIds))
        autoGroupSourceIds.add(sourceId)
      }

      const filteredGroups = result.groups.filter(group => {
        if (isMethod) return true  // 方法类直接渲染所有 group
        const groupMemberSet = new Set(group.memberNodeIds)

        for (const autoMemberSet of autoGroupMemberSets) {
          const overlapCount = group.memberNodeIds.filter(id => autoMemberSet.has(id)).length
          if (overlapCount >= Math.min(groupMemberSet.size, autoMemberSet.size) * 0.5) {
            return false
          }
        }

        if (group.memberNodeIds.some(id => autoGroupSourceIds.has(id))) {
          return false
        }

        return true
      })

      if (filteredGroups.length > 0) {
        timingStart(`    │    渲染分组`)
        this.renderGroups(filteredGroups, isChinese, claimType)
        timingEnd(`    │    渲染分组`)
      }
    }

    this.graph.stopBatch('build')

    this.initialGraphJSON = this.graph.toJSON()

    this.captureOriginalStyles()

    if (result.frames && result.frames.length > 0) {
      this.frames = result.frames
      this.applyFrame(0, false)
    } else {
      this.frames = []
      this.currentFrameIndex = -1
    }

    setTimeout(() => this.fitView(), 100)

    timingEnd(timingKey)
  }

  private renderGroups(groups: ExtractGroup[], isChinese: boolean = false, claimType: ClaimType = 'structure'): void {
    if (!this.graph) return
    const isMethod = claimType === 'method'
    const isMixed = claimType === 'mixed'

    for (const group of groups) {
      if (group.memberNodeIds.length === 0) continue

      const memberNodes = group.memberNodeIds
        .map(id => this.graph!.getCellById(id))
        .filter(cell => cell && cell.isNode())

      if (memberNodes.length === 0) continue

      const bounds = this.getNodesBounds(memberNodes)

      const padding = 25
      const labelSpace = 36
      const groupLabel = isChinese
        ? (group.label.chinese || group.label.original)
        : `${group.label.original}\n${group.label.chinese}`

      // 方法类组合框使用蓝色样式，结构类使用橙色样式
      const groupStroke = (isMethod || isMixed) ? '#1890FF' : '#fa8c16'
      const groupFill = (isMethod || isMixed) ? '#f0f5ff' : '#fafafa'
      const groupFontColor = (isMethod || isMixed) ? '#1890FF' : '#fa8c16'

      this.graph.addNode({
        id: group.id,
        x: bounds.minX - padding,
        y: bounds.minY - padding - labelSpace,
        width: bounds.maxX - bounds.minX + padding * 2,
        height: bounds.maxY - bounds.minY + padding * 2 + labelSpace,
        shape: 'rect',
        zIndex: -1,
        attrs: {
          body: {
            fill: groupFill,
            fillOpacity: 0.5,
            stroke: groupStroke,
            strokeWidth: 1.5,
            strokeDasharray: '6 3',
            rx: 8,
            ry: 8,
            pointerEvents: 'stroke',
          },
          label: {
            text: groupLabel,
            fontSize: 20,
            fill: groupFontColor,
            fontWeight: 'bold',
            textAnchor: 'left',
            textVerticalAnchor: 'top',
            refX: 12,
            refY: 8,
            pointerEvents: 'none',
          },
        },
        data: {
          isGroup: true,
          label: group.label,
          memberNodeIds: group.memberNodeIds,
          detached: false,
        },
      })
    }

    this.bindGroupTracking()
  }

  private renderAttributeTags(attributeEdges: EdgeData[], isChinese: boolean, claimType: ClaimType = 'structure'): void {
    if (!this.graph) return
    const isMethod = claimType === 'method'
    const isMixed = claimType === 'mixed'

    // Group attribute edges by source node
    const nodeAttributesMap = new Map<string, EdgeData[]>()
    for (const attrEdge of attributeEdges) {
      const existing = nodeAttributesMap.get(attrEdge.source)
      if (existing) {
        existing.push(attrEdge)
      } else {
        nodeAttributesMap.set(attrEdge.source, [attrEdge])
      }
    }

    for (const [nodeId, attrs] of nodeAttributesMap) {
      const sourceCell = this.graph.getCellById(nodeId)
      if (!sourceCell || !sourceCell.isNode()) continue

      const sourceNode = sourceCell as unknown as {
        getPosition: () => { x: number; y: number }
        getSize: () => { width: number; height: number }
      }
      const pos = sourceNode.getPosition()
      const size = sourceNode.getSize()

      const attrStyle = getDefaultEdgeStyle('attribute')
      const tagFontSize = 12
      const tagLineHeight = tagFontSize * 1.4
      const tagPaddingH = 8
      const tagPaddingV = 4
      const tagGap = 6
      const stemLength = 16

      // 方法类：标签在节点上方；结构类：标签在节点下方
      const isAbove = isMethod || isMixed

      // Calculate starting Y position
      let currentY = isAbove
        ? pos.y - stemLength  // 上方：从节点顶部向上
        : pos.y + size.height + stemLength  // 下方：从节点底部向下

      const tagMaxTextWidth = 200

      for (let i = 0; i < attrs.length; i++) {
        const attrEdge = attrs[i]
        const labelText = isChinese
          ? (attrEdge.chineseText || attrEdge.originalText)
          : `${attrEdge.originalText}\n${attrEdge.chineseText}`

        // Wrap long text so the tag doesn't stretch too wide horizontally
        const lines = this.wrapTagText(labelText, tagMaxTextWidth, tagFontSize, attrStyle.fontFamily)
        let maxTextWidth = 0
        for (const line of lines) {
          const width = this.measureTextWidth(line, tagFontSize, attrStyle.fontFamily)
          if (width > maxTextWidth) maxTextWidth = width
        }
        const tagWidth = maxTextWidth + tagPaddingH * 2
        const tagHeight = lines.length * tagLineHeight + tagPaddingV * 2

        const tagX = pos.x + size.width / 2 - tagWidth / 2
        const tagY = isAbove ? currentY - tagHeight : currentY

        // Create the tag label node FIRST (stem edge references it as target)
        this.graph.addNode({
          id: `attr-tag-${attrEdge.id}`,
          x: tagX,
          y: tagY,
          width: tagWidth,
          height: tagHeight,
          shape: 'rect',
          attrs: {
            body: {
              fill: '#e6fffb',
              fillOpacity: 0.9,
              stroke: attrStyle.stroke,
              strokeWidth: 1.5,
              strokeDasharray: '',
              rx: 4,
              ry: 4,
            },
            label: {
              text: lines.join('\n'),
              fontSize: tagFontSize,
              fontFamily: attrStyle.fontFamily,
              fill: '#08979c',
              fontWeight: 'normal',
              textAnchor: 'middle',
              textVerticalAnchor: 'middle',
              lineHeight: tagLineHeight,
            },
          },
          data: {
            isAttributeTag: true,
            attributeEdgeId: attrEdge.id,
            sourceNodeId: nodeId,
            originalText: attrEdge.originalText,
            chineseText: attrEdge.chineseText,
            relationType: 'attribute',
            style: attrStyle,
          },
          zIndex: 5,
        })

        // Create stem edge AFTER the tag node exists
        this.graph.addEdge({
          id: `attr-stem-${attrEdge.id}`,
          shape: 'edge',
          source: { cell: nodeId, anchor: { name: isAbove ? 'top' : 'bottom' } },
          target: { cell: `attr-tag-${attrEdge.id}`, anchor: { name: isAbove ? 'bottom' : 'top' } },
          connector: { name: 'normal' },
          attrs: {
            line: {
              stroke: attrStyle.stroke,
              strokeWidth: 2,
              strokeDasharray: '3 3',
              sourceMarker: '',
              targetMarker: '',
            },
          },
          data: {
            isAttributeStem: true,
            attributeEdgeId: attrEdge.id,
            sourceNodeId: nodeId,
          },
          zIndex: 5,
        })

        currentY = isAbove ? tagY - tagGap : tagY + tagHeight + tagGap
      }
    }
  }

  /**
   * 将文本按最大宽度自动换行：优先在空格处断行，超长单词/中文按字符断行。
   * 保留原有的显式换行（\n）。
   */
  private wrapTagText(text: string, maxWidth: number, fontSize: number, fontFamily: string): string[] {
    const result: string[] = []
    for (const rawLine of text.split('\n')) {
      if (this.measureTextWidth(rawLine, fontSize, fontFamily) <= maxWidth) {
        result.push(rawLine)
        continue
      }
      const tokens = rawLine.split(/(\s+)/).filter(t => t.length > 0)
      let current = ''
      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          current += token
          continue
        }
        if (this.measureTextWidth(current + token, fontSize, fontFamily) <= maxWidth) {
          current += token
          continue
        }
        if (current.trim().length > 0) {
          result.push(current.trimEnd())
          current = ''
        }
        if (this.measureTextWidth(token, fontSize, fontFamily) <= maxWidth) {
          current = token
        } else {
          // 单个 token 超过最大宽度：按字符硬换行
          for (const ch of token) {
            if (current && this.measureTextWidth(current + ch, fontSize, fontFamily) > maxWidth) {
              result.push(current)
              current = ''
            }
            current += ch
          }
        }
      }
      if (current.trim().length > 0) {
        result.push(current.trimEnd())
      }
    }
    return result.length > 0 ? result : ['']
  }

  private measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return text.length * fontSize * 0.6
    ctx.font = `normal ${fontSize}px ${fontFamily}`
    return ctx.measureText(text).width
  }

  private getNodesBounds(nodes: unknown[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      const n = node as { getPosition: () => { x: number; y: number }; getSize: () => { width: number; height: number } }
      const pos = n.getPosition()
      const size = n.getSize()
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + size.width)
      maxY = Math.max(maxY, pos.y + size.height)
    }

    return { minX, minY, maxX, maxY }
  }

  private bindGroupTracking(): void {
    if (!this.graph) return

    let isUpdatingGroup = false

    // Side effects (group bounds, fork positions, attribute tag positions) are
    // derived from node positions, so they should NOT be recorded in history.
    // When a node is moved (or undone), node:change:position fires and
    // re-derives the side effects, keeping them consistent.
    this.graph.on('node:moved', ({ node }: { node: { id: string; getData: () => Record<string, unknown> | undefined; attr: (path: string, value?: unknown) => unknown } }) => {
      if (isUpdatingGroup) return
      const data = node.getData()
      if (data?.isForkNode || data?.isAttributeTag) return
      if (data?.isGroup) {
        this.startSkipHistory()
        try {
          this.restoreGroupVisibility(node)
        } finally {
          this.stopSkipHistory()
        }
        return
      }
      isUpdatingGroup = true
      this.startSkipHistory()
      try {
        this.updateGroupBoundsForMember(node.id)
        this.updateForkNodePositions()
        this.updateAttributeTagPositions(node.id)
      } finally {
        this.stopSkipHistory()
        isUpdatingGroup = false
      }
    })

    this.graph.on('node:change:position', ({ node }: { node: { id: string; getData: () => Record<string, unknown> | undefined; attr: (path: string, value?: unknown) => unknown } }) => {
      if (isUpdatingGroup) return
      const data = node.getData()
      if (data?.isForkNode || data?.isAttributeTag) return
      if (data?.isGroup) {
        this.startSkipHistory()
        try {
          this.restoreGroupVisibility(node)
        } finally {
          this.stopSkipHistory()
        }
        return
      }
      isUpdatingGroup = true
      this.startSkipHistory()
      try {
        this.updateGroupBoundsForMember(node.id)
        this.updateForkNodePositions()
        this.updateAttributeTagPositions(node.id)
      } finally {
        this.stopSkipHistory()
        isUpdatingGroup = false
      }
    })
  }

  private restoreGroupVisibility(node: { getData: () => Record<string, unknown> | undefined; attr: (path: string, value?: unknown) => unknown }): void {
    const data = node.getData()
    if (!data?.isGroup) return
    if (data.hidden) {
      node.attr('root/pointerEvents', 'none')
      node.attr('body/stroke', 'transparent')
      node.attr('body/fill', 'transparent')
      node.attr('body/fillOpacity', 0)
      node.attr('body/strokeWidth', 0)
      node.attr('body/pointerEvents', 'none')
      node.attr('label/fill', 'transparent')
      node.attr('label/pointerEvents', 'none')
    } else {
      node.attr('root/pointerEvents', '')
      node.attr('body/stroke', data.detached ? '#999' : '#fa8c16')
      node.attr('body/fill', data.detached ? '#f5f5f5' : '#fafafa')
      node.attr('body/fillOpacity', 0.5)
      node.attr('body/strokeWidth', 1.5)
      node.attr('body/pointerEvents', 'stroke')
      node.attr('label/fill', data.detached ? '#999' : '#fa8c16')
      node.attr('label/pointerEvents', 'none')
    }
  }

  private convertAutoGroupNodes(
    autoGroupInfoMap: Map<string, { memberNodeIds: string[]; isContainmentGroup?: boolean }>,
    isChinese: boolean,
  ): void {
    if (!this.graph) return

    this.graph.startBatch('autoGroup')

    for (const [nodeId, info] of autoGroupInfoMap) {
      const cell = this.graph.getCellById(nodeId)
      if (!cell || !cell.isNode()) continue

      const edgesToRemove: unknown[] = []
      const forkNodeIdsToRemove = new Set<string>()

      for (const edge of this.graph.getEdges()) {
        const data = edge.getData() as Record<string, unknown> | undefined
        if (!data) continue

        if (data.relationType === 'containment' && !data.isTrunk && !data.isBranch && edge.getSourceCellId() === nodeId) {
          edgesToRemove.push(edge)
          continue
        }

        if (data.isTrunk && data.realSourceId === nodeId) {
          edgesToRemove.push(edge)
          forkNodeIdsToRemove.add(data.forkNodeId as string)
          continue
        }
      }

      for (const forkNodeId of forkNodeIdsToRemove) {
        for (const edge of this.graph.getEdges()) {
          const data = edge.getData() as Record<string, unknown> | undefined
          if (data?.isBranch && data.forkNodeId === forkNodeId) {
            if (!edgesToRemove.includes(edge)) {
              edgesToRemove.push(edge)
            }
          }
        }
      }

      for (const edge of edgesToRemove) {
        ;(edge as { remove: () => void }).remove()
      }

      for (const forkNodeId of forkNodeIdsToRemove) {
        const forkCell = this.graph.getCellById(forkNodeId)
        if (forkCell) forkCell.remove()
      }

      const memberNodes = info.memberNodeIds
        .map(id => this.graph!.getCellById(id))
        .filter(c => c && c.isNode())

      if (memberNodes.length === 0) continue

      const bounds = this.getNodesBounds(memberNodes)
      const padding = 25
      const labelSpace = 36

      const nodeData = cell.getData() as Record<string, unknown>
      const groupLabel = isChinese
        ? ((nodeData?.chineseText as string) || (nodeData?.originalText as string) || '')
        : `${nodeData?.originalText || ''}\n${nodeData?.chineseText || ''}`

      if (info.isContainmentGroup) {
        // Non-topmost level: keep the original node, create a new group box for children,
        // and add a single containment edge from the original node to the group box
        const groupBoxId = `containment-group-${nodeId}`

        this.graph.addNode({
          id: groupBoxId,
          x: bounds.minX - padding,
          y: bounds.minY - padding - labelSpace,
          width: bounds.maxX - bounds.minX + padding * 2,
          height: bounds.maxY - bounds.minY + padding * 2 + labelSpace,
          shape: 'rect',
          zIndex: -1,
          attrs: {
            body: {
              fill: '#fafafa',
              fillOpacity: 0.5,
              stroke: '#fa8c16',
              strokeWidth: 1.5,
              strokeDasharray: '6 3',
              rx: 8,
              ry: 8,
              pointerEvents: 'stroke',
            },
            label: {
              text: groupLabel,
              fontSize: 20,
              fill: '#fa8c16',
              fontWeight: 'bold',
              textAnchor: 'left',
              textVerticalAnchor: 'top',
              refX: 12,
              refY: 8,
              pointerEvents: 'none',
            },
          },
          data: {
            isGroup: true,
            isAutoGroup: true,
            isContainmentGroup: true,
            label: { original: nodeData?.originalText || '', chinese: nodeData?.chineseText || '' },
            memberNodeIds: info.memberNodeIds,
            sourceNodeId: nodeId,
            detached: false,
          },
        })

        // Create a single containment edge from the original node to the group box
        const containmentStyle = getDefaultEdgeStyle('containment')
        const containmentLabel = isChinese ? '包含' : '包含\ncontainment'

        this.graph.addEdge({
          id: `containment-edge-${nodeId}`,
          shape: 'edge-with-gap',
          view: 'edge-with-gap-view',
          source: { cell: nodeId, connectionPoint: 'perpendicularBoundary' },
          target: { cell: groupBoxId, connectionPoint: 'perpendicularBoundary' },
          router: { name: 'perpendicularManhattan', args: { padding: 20, step: 10 } },
          connector: { name: 'rounded', args: { radius: 8 } },
          attrs: {
            line: {
              stroke: containmentStyle.stroke,
              strokeWidth: containmentStyle.strokeWidth,
              strokeDasharray: containmentStyle.strokeDasharray ?? '',
              sourceMarker: undefined,
              targetMarker: { name: arrowTypeToMarker(containmentStyle.arrowType) || '' },
            },
          },
          labels: [
            {
              markup: [
                { tagName: 'rect', selector: 'bg' },
                { tagName: 'text', selector: 'labelText' },
              ],
              attrs: {
                bg: {
                  ref: 'labelText',
                  refWidth: 1.2,
                  refHeight: 1.4,
                  refX: -0.1,
                  refY: -0.2,
                  fill: 'transparent',
                  stroke: 'none',
                  strokeWidth: 0,
                  rx: 4,
                  ry: 4,
                  cursor: 'move',
                  pointerEvents: 'all',
                },
                labelText: {
                  text: containmentLabel,
                  fontSize: containmentStyle.fontSize,
                  fontFamily: containmentStyle.fontFamily,
                  fill: containmentStyle.fontColor,
                  fontWeight: 'bold',
                  textAnchor: 'middle',
                  textVerticalAnchor: 'middle',
                  lineHeight: containmentStyle.fontSize * 1.6,
                  stroke: '#ffffff',
                  strokeWidth: 6,
                  paintOrder: 'stroke fill',
                  strokeLinejoin: 'round',
                  pointerEvents: 'none',
                },
              },
              position: {
                distance: 0.5,
                offset: { x: 0, y: 0 },
              },
            },
          ],
          data: {
            originalText: '包含',
            chineseText: 'containment',
            relationType: 'containment',
            style: containmentStyle,
            labelDetached: false,
            isContainmentGroupEdge: true,
            sourceNodeId: nodeId,
            groupBoxId,
          },
          zIndex: 10,
        })
      } else {
        // Topmost level: transform the node itself into a group box
        const node = cell as unknown as {
          setPosition: (x: number, y: number) => void
          resize: (width: number, height: number) => void
          attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void
          setData: (data: Record<string, unknown>) => void
          setZIndex: (z: number) => void
        }

        node.setPosition(bounds.minX - padding, bounds.minY - padding - labelSpace)
        node.resize(
          bounds.maxX - bounds.minX + padding * 2,
          bounds.maxY - bounds.minY + padding * 2 + labelSpace,
        )
        node.attr({
          body: {
            fill: '#fafafa',
            fillOpacity: 0.5,
            stroke: '#fa8c16',
            strokeWidth: 1.5,
            strokeDasharray: '6 3',
            rx: 8,
            ry: 8,
            pointerEvents: 'stroke',
          },
          label: {
            text: groupLabel,
            fontSize: 20,
            fill: '#fa8c16',
            fontWeight: 'bold',
            textAnchor: 'left',
            textVerticalAnchor: 'top',
            refX: 12,
            refY: 8,
            pointerEvents: 'none',
          },
        })
        node.setData({
          ...nodeData,
          isGroup: true,
          isAutoGroup: true,
          label: { original: nodeData?.originalText || '', chinese: nodeData?.chineseText || '' },
          memberNodeIds: info.memberNodeIds,
          detached: false,
        })
        node.setZIndex(-1)
      }
    }

    this.updateGroupBoundsForMember('')

    this.graph.stopBatch('autoGroup')
  }

  private calculateForkPosition(sourceId: string, targetIds: string[]): { x: number; y: number } {
    if (!this.graph) return { x: 0, y: 0 }

    const sourceCell = this.graph.getCellById(sourceId)
    if (!sourceCell || !sourceCell.isNode()) return { x: 0, y: 0 }

    const sourceNode = sourceCell as unknown as {
      getPosition: () => { x: number; y: number }
      getSize: () => { width: number; height: number }
    }
    const sourcePos = sourceNode.getPosition()
    const sourceSize = sourceNode.getSize()
    const sourceCenterX = sourcePos.x + sourceSize.width / 2
    const sourceCenterY = sourcePos.y + sourceSize.height / 2

    let targetCenterSumX = 0
    let targetCenterSumY = 0
    let targetCount = 0

    for (const targetId of targetIds) {
      const targetCell = this.graph.getCellById(targetId)
      if (!targetCell || !targetCell.isNode()) continue

      const targetNode = targetCell as unknown as {
        getPosition: () => { x: number; y: number }
        getSize: () => { width: number; height: number }
      }
      const targetPos = targetNode.getPosition()
      const targetSize = targetNode.getSize()
      targetCenterSumX += targetPos.x + targetSize.width / 2
      targetCenterSumY += targetPos.y + targetSize.height / 2
      targetCount++
    }

    if (targetCount === 0) return { x: sourceCenterX, y: sourceCenterY }

    const targetCenterX = targetCenterSumX / targetCount
    const targetCenterY = targetCenterSumY / targetCount

    const forkX = sourceCenterX + 0.8 * (targetCenterX - sourceCenterX)
    const forkY = sourceCenterY + 0.8 * (targetCenterY - sourceCenterY)

    return { x: forkX, y: forkY }
  }

  private updateForkNodePositions(): void {
    if (!this.graph) return

    const forkNodes = this.graph.getNodes().filter(n => {
      const data = n.getData() as Record<string, unknown> | undefined
      return data?.isForkNode
    })

    for (const forkNode of forkNodes) {
      const data = forkNode.getData() as Record<string, unknown>
      const sourceId = data.sourceId as string
      const targetIds = data.targetIds as string[]

      const newPos = this.calculateForkPosition(sourceId, targetIds)
      const fn = forkNode as unknown as { setPosition: (x: number, y: number) => void }
      fn.setPosition(newPos.x, newPos.y)
    }
  }

  private updateAttributeTagPositions(nodeId: string): void {
    if (!this.graph) return

    // Find all attribute tags and stems belonging to this node
    const attrTags = this.graph.getNodes().filter(n => {
      const data = n.getData() as Record<string, unknown> | undefined
      return data?.isAttributeTag && data?.sourceNodeId === nodeId
    })

    if (attrTags.length === 0) return

    const sourceCell = this.graph.getCellById(nodeId)
    if (!sourceCell || !sourceCell.isNode()) return

    const sourceNode = sourceCell as unknown as {
      getPosition: () => { x: number; y: number }
      getSize: () => { width: number; height: number }
    }
    const pos = sourceNode.getPosition()
    const size = sourceNode.getSize()

    const stemLength = 16
    const tagGap = 6
    let currentY = pos.y + size.height + stemLength

    // Sort tags by their current Y position to maintain order
    const sortedTags = [...attrTags].sort((a, b) => {
      const aNode = a as unknown as { getPosition: () => { x: number; y: number } }
      const bNode = b as unknown as { getPosition: () => { x: number; y: number } }
      return aNode.getPosition().y - bNode.getPosition().y
    })

    for (const tagNode of sortedTags) {
      const tagN = tagNode as unknown as {
        getPosition: () => { x: number; y: number }
        getSize: () => { width: number; height: number }
        setPosition: (x: number, y: number) => void
      }
      const tagSize = tagN.getSize()
      const tagX = pos.x + size.width / 2 - tagSize.width / 2
      tagN.setPosition(tagX, currentY)

      // Stem edge is connected to node and tag node, so it auto-updates with position changes

      currentY = currentY + tagSize.height + tagGap
    }
  }

  updateGroupBoundsForMember(nodeId: string): void {
    if (!this.graph) return

    const groups = this.graph.getNodes().filter(n => {
      const data = n.getData() as Record<string, unknown> | undefined
      return data?.isGroup && !data?.detached
    })

    for (const groupNode of groups) {
      const data = groupNode.getData() as Record<string, unknown>
      const memberIds = (data?.memberNodeIds as string[]) || []
      if (nodeId && !memberIds.includes(nodeId)) continue

      const memberNodes = memberIds
        .map(id => this.graph!.getCellById(id))
        .filter(cell => cell && cell.isNode())

      if (memberNodes.length === 0) continue

      const bounds = this.getNodesBounds(memberNodes)
      const padding = 25
      const labelSpace = 36

      const g = groupNode as unknown as {
        setPosition: (x: number, y: number) => void
        resize: (width: number, height: number) => void
      }
      g.setPosition(bounds.minX - padding, bounds.minY - padding - labelSpace)
      g.resize(
        bounds.maxX - bounds.minX + padding * 2,
        bounds.maxY - bounds.minY + padding * 2 + labelSpace
      )
    }
  }

  toggleGroupDetached(groupId: string): boolean {
    if (!this.graph) return false
    const cell = this.graph.getCellById(groupId)
    if (!cell || !cell.isNode()) return false

    const data = (cell.getData() as Record<string, unknown>) || {}
    if (!data.isGroup) return false

    this.graph.startBatch('groupDetach')
    const newDetached = !(data.detached as boolean)
    const n = cell as unknown as {
      setData: (data: Record<string, unknown>) => void
      attr: (path: string, value?: unknown) => unknown
    }
    n.setData({ ...data, detached: newDetached })

    n.attr('body/strokeDasharray', newDetached ? '3 3' : '6 3')
    n.attr('body/stroke', newDetached ? '#999' : '#fa8c16')
    n.attr('body/fill', newDetached ? '#f5f5f5' : '#fafafa')

    if (!newDetached) {
      this.updateGroupBoundsForMember('')
    }
    this.graph.stopBatch('groupDetach')

    return newDetached
  }

  isGroupDetached(groupId: string): boolean {
    if (!this.graph) return false
    const cell = this.graph.getCellById(groupId)
    if (!cell || !cell.isNode()) return false
    const data = (cell.getData() as Record<string, unknown>) || {}
    return !!(data.detached as boolean)
  }

  toggleGroupsVisible(visible: boolean): void {
    if (!this.graph) return
    this.graph.startBatch('groupsVisible')
    const nodes = this.graph.getNodes()
    for (const node of nodes) {
      const data = (node.getData() as Record<string, unknown>) || {}
      if (data.isGroup) {
        const n = node as unknown as { attr: (path: string, value?: unknown) => unknown; setData: (data: Record<string, unknown>) => void }
        n.setData({ ...data, hidden: !visible })
        if (visible) {
          n.attr('root/pointerEvents', '')
          n.attr('body/stroke', data.detached ? '#999' : '#fa8c16')
          n.attr('body/fill', data.detached ? '#f5f5f5' : '#fafafa')
          n.attr('body/fillOpacity', 0.5)
          n.attr('body/strokeWidth', 1.5)
          n.attr('body/pointerEvents', 'stroke')
          n.attr('label/fill', data.detached ? '#999' : '#fa8c16')
          n.attr('label/pointerEvents', 'none')
        } else {
          n.attr('root/pointerEvents', 'none')
          n.attr('body/stroke', 'transparent')
          n.attr('body/fill', 'transparent')
          n.attr('body/fillOpacity', 0)
          n.attr('body/strokeWidth', 0)
          n.attr('body/pointerEvents', 'none')
          n.attr('label/fill', 'transparent')
          n.attr('label/pointerEvents', 'none')
        }
      }
    }
    this.graph.stopBatch('groupsVisible')
  }

  rebindGroupTracking(): void {
    this.bindGroupTracking()
  }

  private highlightedEdgeId: string | null = null
  private highlightedNodeIds: string[] = []
  private highlightedBranchEdgeIds: string[] = []
  private _skipHistoryCount = 0

  private startSkipHistory(): void {
    this._skipHistoryCount++
  }

  private stopSkipHistory(): void {
    if (this._skipHistoryCount > 0) {
      this._skipHistoryCount--
    }
  }

  private shouldSkipHistory(): boolean {
    return this._skipHistoryCount > 0
  }

  highlightEdge(edgeId: string): string[] {
    this.startSkipHistory()
    try {
      this.clearHighlight()
      if (!this.graph) return []

      const cell = this.graph.getCellById(edgeId)
      if (!cell || !cell.isEdge()) return []

      this.highlightedEdgeId = edgeId

      const edge = cell as unknown as {
        attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void
        getSourceCellId: () => string | null
        getTargetCellId: () => string | null
        getData: () => Record<string, unknown> | undefined
      }

      edge.attr('line/strokeWidth', 6)
      edge.attr('line/stroke', '#e63946')

      const data = edge.getData()
      const isTrunk = data?.isTrunk as boolean | undefined

      const sourceId = edge.getSourceCellId()
      const targetId = edge.getTargetCellId()

      const nodeIdsToHighlight: string[] = []

      if (isTrunk && data) {
        const forkNodeId = data.forkNodeId as string
        const realSourceId = data.realSourceId as string
        nodeIdsToHighlight.push(realSourceId)

        const branchEdges = this.graph!.getEdges().filter(e => {
          const bd = e.getData() as Record<string, unknown> | undefined
          return bd?.isBranch && bd.forkNodeId === forkNodeId
        })

        for (const branchEdge of branchEdges) {
          const bd = branchEdge.getData() as Record<string, unknown> | undefined
          const realTargetId = bd?.realTargetId as string | undefined
          if (realTargetId) {
            nodeIdsToHighlight.push(realTargetId)
          }
          const be = branchEdge as unknown as { attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void }
          be.attr('line/strokeWidth', 6)
          be.attr('line/stroke', '#e63946')
          this.highlightedBranchEdgeIds.push(branchEdge.id)
        }
      } else {
        if (sourceId) nodeIdsToHighlight.push(sourceId)
        if (targetId) nodeIdsToHighlight.push(targetId)
      }

      for (const nodeId of nodeIdsToHighlight) {
        if (!nodeId) continue
        const nodeCell = this.graph!.getCellById(nodeId)
        if (!nodeCell || !nodeCell.isNode()) continue
        const n = nodeCell as unknown as { attr: (path: string, value?: unknown) => void }
        n.attr('body/strokeWidth', 4)
        n.attr('body/stroke', '#e63946')
        this.highlightedNodeIds.push(nodeId)
      }

      return nodeIdsToHighlight
    } finally {
      this.stopSkipHistory()
    }
  }

  clearHighlight(): void {
    if (!this.graph) return
    if (!this.highlightedEdgeId && this.highlightedNodeIds.length === 0) return

    this.startSkipHistory()
    try {
      if (this.highlightedEdgeId) {
        const edgeId = this.highlightedEdgeId
        this.highlightedEdgeId = null

        const cell = this.graph.getCellById(edgeId)
        if (cell && cell.isEdge()) {
          const edge = cell as unknown as {
            attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void
            getData: () => Record<string, unknown> | undefined
          }

          const data = edge.getData()
          const relationType = data?.relationType as string | undefined
          const defaultStyle = relationType ? getDefaultEdgeStyle(relationType) : null
          const customStyle = data?.style as Record<string, unknown> | undefined
          const stroke = (customStyle?.stroke as string) ?? defaultStyle?.stroke ?? '#333333'
          const strokeWidth = (customStyle?.strokeWidth as number) ?? defaultStyle?.strokeWidth ?? 2
          const strokeDasharray = (customStyle?.strokeDasharray as string) ?? defaultStyle?.strokeDasharray ?? ''
          edge.attr('line/strokeWidth', strokeWidth)
          edge.attr('line/stroke', stroke)
          edge.attr('line/strokeDasharray', strokeDasharray)
        }
      }

      for (const branchEdgeId of this.highlightedBranchEdgeIds) {
        const branchCell = this.graph.getCellById(branchEdgeId)
        if (branchCell && branchCell.isEdge()) {
          const be = branchCell as unknown as {
            attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void
            getData: () => Record<string, unknown> | undefined
          }
          const bd = be.getData()
          const bRelationType = bd?.relationType as string | undefined
          const bDefaultStyle = bRelationType ? getDefaultEdgeStyle(bRelationType) : null
          const bCustomStyle = bd?.style as Record<string, unknown> | undefined
          const bStroke = (bCustomStyle?.stroke as string) ?? bDefaultStyle?.stroke ?? '#333333'
          const bStrokeWidth = (bCustomStyle?.strokeWidth as number) ?? bDefaultStyle?.strokeWidth ?? 2
          const bStrokeDasharray = (bCustomStyle?.strokeDasharray as string) ?? bDefaultStyle?.strokeDasharray ?? ''
          be.attr('line/strokeWidth', bStrokeWidth)
          be.attr('line/stroke', bStroke)
          be.attr('line/strokeDasharray', bStrokeDasharray)
        }
      }
      this.highlightedBranchEdgeIds = []

      for (const nodeId of this.highlightedNodeIds) {
        if (!nodeId) continue
        const nodeCell = this.graph.getCellById(nodeId)
        if (!nodeCell || !nodeCell.isNode()) continue
        const nodeData = nodeCell.getData() as Record<string, unknown> | undefined
        const nodeStyle = nodeData?.style as Record<string, unknown> | undefined
        const n = nodeCell as unknown as { attr: (path: string, value?: unknown) => void }
        n.attr('body/strokeWidth', (nodeStyle?.strokeWidth as number) ?? 1.5)
        n.attr('body/stroke', (nodeStyle?.stroke as string) ?? '#333333')
      }
      this.highlightedNodeIds = []
    } finally {
      this.stopSkipHistory()
    }
  }

  addNode(data: NodeData): string {
    if (!this.graph) throw new Error('画布未初始化')
    const config = buildNode(data)
    this.graph.addNode(config)
    return data.id
  }

  addGroup(id: string, label: string, x: number, y: number, width: number = 300, height: number = 200): string {
    if (!this.graph) throw new Error('画布未初始化')
    this.graph.addNode({
      id,
      x,
      y,
      width,
      height,
      shape: 'rect',
      zIndex: -1,
      attrs: {
        body: {
          fill: '#fafafa',
          fillOpacity: 0.5,
          stroke: '#fa8c16',
          strokeWidth: 1.5,
          strokeDasharray: '6 3',
          rx: 8,
          ry: 8,
          pointerEvents: 'stroke',
        },
        label: {
          text: label,
          fontSize: 20,
          fill: '#fa8c16',
          fontWeight: 'bold',
          textAnchor: 'left',
          textVerticalAnchor: 'top',
          refX: 12,
          refY: 8,
          pointerEvents: 'none',
        },
      },
      data: {
        isGroup: true,
        label: { original: label, chinese: '' },
        memberNodeIds: [],
        detached: false,
      },
    })
    return id
  }

  removeNode(id: string): void {
    this.graph?.getCellById(id)?.remove()
  }

  removeNodeWithOption(id: string, removeEdges: boolean = true): void {
    if (!this.graph) return
    const cell = this.graph.getCellById(id)
    if (!cell || !cell.isNode()) return

    this.graph.startBatch('removeNode')
    if (removeEdges) {
      const edges = this.graph.getConnectedEdges(cell)
      edges.forEach(edge => edge.remove())
    }
    cell.remove()
    this.graph.stopBatch('removeNode')
  }

  getConnectedEdgeIds(nodeId: string): string[] {
    if (!this.graph) return []
    const cell = this.graph.getCellById(nodeId)
    if (!cell || !cell.isNode()) return []

    const edges = this.graph.getConnectedEdges(cell)
    return edges.map(e => e.id)
  }

  updateNodeStyle(id: string, style: Partial<NodeData['style']>): void {
    if (!this.graph) return
    const cell = this.graph.getCellById(id)
    if (cell && cell.isNode()) {
      const data = cell.getData() as Record<string, unknown> | undefined
      // For group nodes, only update visual attrs, never resize (which would collapse the group box)
      if (data?.isGroup) {
        this.graph.startBatch('nodeStyle')
        const n = cell as unknown as { attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => void }
        const bodyAttrs: Record<string, unknown> = {}
        const labelAttrs: Record<string, unknown> = {}
        if (style.fill !== undefined) bodyAttrs.fill = style.fill
        if (style.stroke !== undefined) bodyAttrs.stroke = style.stroke
        if (style.strokeWidth !== undefined) bodyAttrs.strokeWidth = style.strokeWidth
        if (style.strokeDasharray !== undefined) bodyAttrs.strokeDasharray = style.strokeDasharray ?? ''
        if (style.borderRadius !== undefined) { bodyAttrs.rx = style.borderRadius; bodyAttrs.ry = style.borderRadius }
        if (style.fontSize !== undefined) labelAttrs.fontSize = style.fontSize
        if (style.fontFamily !== undefined) labelAttrs.fontFamily = style.fontFamily
        if (style.fontColor !== undefined) labelAttrs.fill = style.fontColor
        if (style.fontWeight !== undefined) labelAttrs.fontWeight = style.fontWeight
        if (Object.keys(bodyAttrs).length > 0) n.attr({ body: bodyAttrs })
        if (Object.keys(labelAttrs).length > 0) n.attr({ label: labelAttrs })
        this.graph.stopBatch('nodeStyle')
        return
      }
      this.graph.startBatch('nodeStyle')
      updateNodeStyle(cell, style)
      this.graph.stopBatch('nodeStyle')
    }
  }

  addEdge(data: EdgeData): string {
    if (!this.graph) throw new Error('画布未初始化')
    const config = buildEdge(data)
    this.graph.addEdge(config)
    return data.id
  }

  removeEdge(id: string): void {
    this.graph?.getCellById(id)?.remove()
  }

  updateEdgeStyle(id: string, style: Partial<EdgeData['style']>): void {
    if (!this.graph) return
    const cell = this.graph.getCellById(id)
    if (cell && cell.isEdge()) {
      this.graph.startBatch('edgeStyle')
      updateEdgeStyle(cell, style)
      this.graph.stopBatch('edgeStyle')
    }
  }

  toggleEdgeLabelDetached(edgeId: string): boolean {
    if (!this.graph) return false
    const cell = this.graph.getCellById(edgeId)
    if (!cell || !cell.isEdge()) return false

    const edge = cell as unknown as {
      getData: () => Record<string, unknown> | undefined
      setData: (data: Record<string, unknown>) => void
      getLabels: () => unknown[]
      setLabels: (labels: unknown[]) => void
    }

    this.graph.startBatch('labelDetach')
    const data = edge.getData() || {}
    const isDetached = !(data.labelDetached as boolean)

    edge.setData({ ...data, labelDetached: isDetached })

    const labels = edge.getLabels()
    if (labels.length > 0) {
      const label = labels[0] as Record<string, unknown>
      const existingAttrs = (label.attrs || {}) as Record<string, unknown>
      const existingBg = (existingAttrs.bg || {}) as Record<string, unknown>
      const existingLabelText = (existingAttrs.labelText || {}) as Record<string, unknown>

      const existingPosition = label.position as Record<string, unknown> | undefined
      const newPosition = isDetached
        ? existingPosition
        : {
            ...(existingPosition || {}),
            offset: { x: 0, y: 0 },
          }

      edge.setLabels([{
        ...label,
        position: newPosition,
        attrs: {
          ...existingAttrs,
          bg: {
            ...existingBg,
            stroke: isDetached ? '#fa8c16' : 'none',
            strokeWidth: isDetached ? 2 : 0,
          },
          labelText: existingLabelText,
        },
      }])
    }
    this.graph.stopBatch('labelDetach')

    return isDetached
  }

  isEdgeLabelDetached(edgeId: string): boolean {
    if (!this.graph) return false
    const cell = this.graph.getCellById(edgeId)
    if (!cell || !cell.isEdge()) return false

    const edge = cell as unknown as {
      getData: () => Record<string, unknown> | undefined
    }
    const data = edge.getData()
    return !!(data?.labelDetached as boolean)
  }

  bringForward(id: string): void {
    if (!this.graph) return
    const cell = this.graph.getCellById(id)
    if (cell) {
      this.graph.startBatch('zIndex')
      const z = cell.getZIndex() ?? 0
      cell.setZIndex(z + 1)
      this.graph.stopBatch('zIndex')
    }
  }

  sendBackward(id: string): void {
    if (!this.graph) return
    const cell = this.graph.getCellById(id)
    if (cell) {
      this.graph.startBatch('zIndex')
      const z = cell.getZIndex() ?? 0
      cell.setZIndex(z - 1)
      this.graph.stopBatch('zIndex')
    }
  }

  bringToFront(id: string): void {
    if (!this.graph) return
    const cells = this.graph.getCells()
    let maxZ = 0
    for (const c of cells) {
      const z = c.getZIndex() ?? 0
      if (z > maxZ) maxZ = z
    }
    const cell = this.graph.getCellById(id)
    if (cell) {
      this.graph.startBatch('zIndex')
      cell.setZIndex(maxZ + 1)
      this.graph.stopBatch('zIndex')
    }
  }

  sendToBack(id: string): void {
    if (!this.graph) return
    const cells = this.graph.getCells()
    let minZ = 0
    for (const c of cells) {
      const z = c.getZIndex() ?? 0
      if (z < minZ) minZ = z
    }
    const cell = this.graph.getCellById(id)
    if (cell) {
      this.graph.startBatch('zIndex')
      cell.setZIndex(minZ - 1)
      this.graph.stopBatch('zIndex')
    }
  }

  setAllNodeFontSize(fontSize: number): void {
    if (!this.graph) return
    this.graph.startBatch('fontSize')
    const nodes = this.graph.getNodes()
    for (const node of nodes) {
      const data = node.getData() as Record<string, unknown> | undefined
      if (data?.isForkNode) continue

      const n = node as unknown as {
        attr: (path: string, value?: unknown) => unknown
        getSize: () => { width: number; height: number }
        resize: (width: number, height: number) => void
        getData: () => Record<string, unknown> | undefined
        setData: (data: Record<string, unknown>) => void
      }
      n.attr('label/fontSize', fontSize)

      if (data?.isGroup) {
        // For group nodes, only update font size, don't resize (would collapse the group box)
        const currentData = n.getData() || {}
        n.setData({ ...currentData, groupFontSize: fontSize })
        continue
      }

      // Recalculate node size based on new font size to prevent text overflow
      const originalText = (data?.originalText as string) || ''
      const chineseText = (data?.chineseText as string) || ''
      const nodeStyle = (data?.style as Record<string, unknown>) || {}
      const fontFamily = (nodeStyle.fontFamily as string) || '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
      const fontWeight = (nodeStyle.fontWeight as string) || 'bold'
      const isChinese = (data?.isChinese as boolean) || false
      const currentSize = n.getSize()
      const newSize = calculateNodeSize(originalText, chineseText, isChinese, fontSize, fontFamily, fontWeight, currentSize.width, currentSize.height)
      n.resize(newSize.width, newSize.height)

      // Update stored style
      const currentData = n.getData() || {}
      const currentStyle = (currentData.style as Record<string, unknown>) || {}
      n.setData({ ...currentData, style: { ...currentStyle, fontSize } })
    }
    this.graph.stopBatch('fontSize')
  }

  setAllEdgeFontSize(fontSize: number): void {
    if (!this.graph) return
    this.graph.startBatch('fontSize')
    const edges = this.graph.getEdges()
    for (const edge of edges) {
      const e = edge as { getLabels: () => unknown[]; setLabels: (labels: unknown[]) => void; getData: () => Record<string, unknown> | undefined; setData: (data: Record<string, unknown>) => void }
      const labels = e.getLabels()
      if (labels.length > 0) {
        const firstLabel = labels[0] as Record<string, unknown>
        const existingAttrs = (firstLabel.attrs || {}) as Record<string, unknown>
        const existingBg = (existingAttrs.bg || {}) as Record<string, unknown>
        const existingLabelText = (existingAttrs.labelText || {}) as Record<string, unknown>
        const newLabel = {
          ...firstLabel,
          attrs: {
            ...existingAttrs,
            bg: existingBg,
            labelText: {
              ...existingLabelText,
              fontSize,
              lineHeight: fontSize * 1.6,
            },
          },
        }
        e.setLabels([newLabel])
      }

      // Update stored style
      const edgeData = e.getData() || {}
      const edgeStyle = (edgeData.style as Record<string, unknown>) || {}
      e.setData({ ...edgeData, style: { ...edgeStyle, fontSize } })
    }
    this.graph.stopBatch('fontSize')
  }

  async applyLayout(options?: ElkLayoutOptions): Promise<void> {
    if (!this.graph) return

    const nodes = this.graph.getNodes()
    const edges = this.graph.getEdges()

    const realNodes = nodes.filter(n => {
      const data = n.getData() as Record<string, unknown>
      return !data?.isForkNode && !data?.isGroup
    })

    const nodeDataList: NodeData[] = realNodes.map(n => {
      const data = n.getData() as Record<string, unknown>
      const size = n.getSize()
      return {
        id: n.id,
        originalText: (data?.originalText as string) || '',
        chineseText: (data?.chineseText as string) || '',
        nodeType: (data?.nodeType as NodeData['nodeType']) || 'component',
        hierarchyLevel: (data?.hierarchyLevel as number) ?? 0,
        style: { width: size.width, height: size.height } as NodeData['style'],
      }
    })

    const edgeDataList: EdgeData[] = []
    for (const e of edges) {
      const data = e.getData() as Record<string, unknown>

      if (data?.isBranch) continue

      if (data?.isTrunk) {
        const sourceId = data.realSourceId as string
        const forkNodeId = data.forkNodeId as string
        const branchEdges = edges.filter(be => {
          const bd = be.getData() as Record<string, unknown>
          return bd?.isBranch && bd.forkNodeId === forkNodeId
        })
        for (const be of branchEdges) {
          const bd = be.getData() as Record<string, unknown>
          edgeDataList.push({
            id: (bd.originalEdgeId as string) || be.id,
            source: sourceId,
            target: (bd.realTargetId as string) || '',
            originalText: (data.originalText as string) || '',
            chineseText: (data.chineseText as string) || '',
            relationType: (data.relationType as EdgeData['relationType']) || 'position',
            style: {} as EdgeData['style'],
          })
        }
        continue
      }

      edgeDataList.push({
        id: e.id,
        source: (e.getSourceCellId() as string) || '',
        target: (e.getTargetCellId() as string) || '',
        originalText: (data?.originalText as string) || '',
        chineseText: (data?.chineseText as string) || '',
        relationType: (data?.relationType as EdgeData['relationType']) || 'position',
        style: {} as EdgeData['style'],
      })
    }

    const groupNodeIds = new Set(
      nodes.filter(n => {
        const data = n.getData() as Record<string, unknown>
        return !!data?.isGroup
      }).map(n => n.id)
    )

    const filteredEdgeDataList = edgeDataList.filter(e =>
      e.source && e.target && !groupNodeIds.has(e.source) && !groupNodeIds.has(e.target)
    )

    const positions = await applyElkLayout(nodeDataList, filteredEdgeDataList, options)

    this.graph.startBatch('layout')
    for (const node of realNodes) {
      const pos = positions.get(node.id)
      if (pos) {
        node.setPosition(pos.x, pos.y)
      }
    }
    this.updateForkNodePositions()
    this.updateGroupBoundsForMember('')
    this.graph.stopBatch('layout')
  }

  fitView(): void {
    this.graph?.zoomToFit({ padding: 40, maxScale: 1.5 })
  }

  zoomTo(scale: number): void {
    this.graph?.zoomTo(scale)
  }

  zoomIn(): void {
    this.graph?.zoom(0.1)
  }

  zoomOut(): void {
    this.graph?.zoom(-0.1)
  }

  centerContent(): void {
    this.graph?.centerContent()
  }

  getSelectedNodeIds(): string[] {
    if (!this.graph) return []
    return this.graph.getCells().filter(c => c.isNode() && this.graph!.isSelected(c)).map(c => c.id)
  }

  getSelectedEdgeIds(): string[] {
    if (!this.graph) return []
    return this.graph.getCells().filter(c => c.isEdge() && this.graph!.isSelected(c)).map(c => c.id)
  }

  selectAll(): void {
    this.graph?.getCells().forEach(c => {
      if (c.isNode()) {
        const data = c.getData() as Record<string, unknown> | undefined
        if (data?.isForkNode || data?.isGroup) return
      }
      this.graph!.select(c)
    })
  }

  clearSelection(): void {
    this.graph?.getCells().forEach(c => this.graph!.unselect(c))
  }

  undo(): void {
    this.graph?.undo()
  }

  redo(): void {
    this.graph?.redo()
  }

  canUndo(): boolean {
    return this.graph?.canUndo() ?? false
  }

  canRedo(): boolean {
    return this.graph?.canRedo() ?? false
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.graph?.on(event, handler as (...args: never[]) => void)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.graph?.off(event, handler as (...args: never[]) => void)
  }

  async toPNG(options?: { padding?: number; backgroundColor?: string; scale?: number }): Promise<Blob | null> {
    if (!this.graph) return null

    const padding = options?.padding ?? 40
    const backgroundColor = options?.backgroundColor ?? '#ffffff'
    const scale = options?.scale ?? 4

    return new Promise<Blob | null>((resolve) => {
      this.graph!.toPNG((dataUrl: string) => {
        try {
          const byteString = atob(dataUrl.split(',')[1])
          const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0]
          const ab = new ArrayBuffer(byteString.length)
          const ia = new Uint8Array(ab)
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i)
          }
          resolve(new Blob([ab], { type: mimeString }))
        } catch (err) {
          console.error('PNG 导出失败:', err)
          resolve(null)
        }
      }, {
        padding,
        backgroundColor,
        quality: 1,
        ratio: String(scale),
      })
    })
  }

  toSVG(_options?: { padding?: number }): string {
    if (!this.graph) return ''

    const padding = _options?.padding ?? 40
    const contentBBox = this.graph.getContentBBox()

    let svgStr = ''
    this.graph.toSVG((svg: string) => {
      svgStr = svg
    })

    if (!svgStr) return ''

    // Manually set viewBox and dimensions to ensure complete display
    const svgWidth = contentBBox.width + padding * 2
    const svgHeight = contentBBox.height + padding * 2
    const viewBox = `${contentBBox.x - padding} ${contentBBox.y - padding} ${svgWidth} ${svgHeight}`

    svgStr = svgStr.replace(
      /<svg([^>]*)>/,
      (_, attrs: string) => {
        const cleaned = attrs
          .replace(/\s*viewBox\s*=\s*["'][^"']*["']/g, '')
          .replace(/\s*width\s*=\s*["'][^"']*["']/g, '')
          .replace(/\s*height\s*=\s*["'][^"']*["']/g, '')
        // Ensure xmlns declarations
        let newAttrs = cleaned
        if (!newAttrs.includes('xmlns="http://www.w3.org/2000/svg"')) {
          newAttrs = ' xmlns="http://www.w3.org/2000/svg"' + newAttrs
        }
        if (!newAttrs.includes('xmlns:xlink')) {
          newAttrs = ' xmlns:xlink="http://www.w3.org/1999/xlink"' + newAttrs
        }
        // Use 100% width/height so the SVG fills the browser window and centers via viewBox
        return `<svg${newAttrs} viewBox="${viewBox}" width="100%" height="100%">`
      }
    )

    return svgStr
  }

  toJSON(): Record<string, unknown> {
    return this.graph?.toJSON() ?? {}
  }

  fromJSON(json: Record<string, unknown>): void {
    this.graph?.fromJSON(json)
  }

  getZoom(): number {
    return this.graph?.zoom() ?? 1
  }

  resetToInitial(): boolean {
    if (!this.graph || !this.initialGraphJSON) return false
    try {
      this.graph.fromJSON(this.initialGraphJSON)
      setTimeout(() => this.fitView(), 100)
      return true
    } catch {
      return false
    }
  }

  hasInitialState(): boolean {
    return this.initialGraphJSON !== null
  }

  private captureOriginalStyles(): void {
    if (!this.graph) return
    this.originalNodeStyles.clear()
    this.originalEdgeStyles.clear()

    const nodes = this.graph.getNodes()
    for (const node of nodes) {
      const data = node.getData() as Record<string, unknown> | undefined
      if (data?.isForkNode || data?.isAttributeTag || data?.isAttributeStem) continue
      const attrs = node.getAttrs() as Record<string, unknown>
      const body = (attrs.body || {}) as Record<string, unknown>
      this.originalNodeStyles.set(node.id, {
        opacity: 1,
        stroke: (body.stroke as string) || '#333333',
        strokeWidth: (body.strokeWidth as number) || 1.5,
        fill: (body.fill as string) || '#ffffff',
      })
    }

    const edges = this.graph.getEdges()
    for (const edge of edges) {
      const attrs = edge.getAttrs() as Record<string, unknown>
      const line = (attrs.line || {}) as Record<string, unknown>
      this.originalEdgeStyles.set(edge.id, {
        opacity: 1,
        stroke: (line.stroke as string) || '#333333',
        strokeWidth: (line.strokeWidth as number) || 2,
        strokeDasharray: (line.strokeDasharray as string) || '',
      })
    }
  }

  setFrames(frames: ExtractFrame[]): void {
    this.frames = frames || []
    if (this.frames.length > 0) {
      this.captureOriginalStyles()
      this.applyFrame(0, false)
    } else {
      this.resetAllStyles()
    }
  }

  /**
   * 退出动画模式，直接展示完整图：清除帧并将所有节点/边恢复为完整样式。
   * 与 resetAllStyles 不同，本方法不依赖此前捕获的样式快照，
   * 因此对 fromJSON 恢复的（可能带帧样式）图同样有效。
   */
  showFullGraph(): void {
    this.frames = []
    this.currentFrameIndex = -1
    if (!this.graph) return
    this.startSkipHistory()
    this.graph.startBatch('show-full-graph')
    try {
      for (const node of this.graph.getNodes()) {
        const data = node.getData() as Record<string, unknown> | undefined
        if (data?.isForkNode || data?.isAttributeTag || data?.isAttributeStem) continue
        const style = (data?.style || {}) as Record<string, unknown>
        const stroke = typeof style.stroke === 'string' ? style.stroke : '#333333'
        const strokeWidth = typeof style.strokeWidth === 'number' ? style.strokeWidth : 1.5
        node.attr('body/opacity', 1)
        node.attr('body/stroke', data?.isGroup ? '#fa8c16' : stroke)
        node.attr('body/strokeWidth', data?.isGroup ? 1.5 : strokeWidth)
      }
      for (const edge of this.graph.getEdges()) {
        const data = edge.getData() as Record<string, unknown> | undefined
        const style = (data?.style || {}) as Record<string, unknown>
        const stroke = typeof style.stroke === 'string' ? style.stroke : '#333333'
        const strokeWidth = typeof style.strokeWidth === 'number' ? style.strokeWidth : 2
        edge.attr('line/opacity', 1)
        edge.attr('line/stroke', stroke)
        edge.attr('line/strokeWidth', strokeWidth)
      }
    } finally {
      this.graph.stopBatch('show-full-graph')
      this.stopSkipHistory()
    }
  }

  getFrames(): ExtractFrame[] {
    return this.frames
  }

  getCurrentFrameIndex(): number {
    return this.currentFrameIndex
  }

  hasFrames(): boolean {
    return this.frames.length > 0
  }

  applyFrame(frameIndex: number, animate: boolean = true): void {
    if (!this.graph || this.frames.length === 0) return
    const clampedIndex = Math.max(0, Math.min(frameIndex, this.frames.length - 1))
    this.currentFrameIndex = clampedIndex
    const frame = this.frames[clampedIndex]

    this.startSkipHistory()
    this.graph.startBatch('frame-apply')

    try {
      const highlightNodeSet = new Set(frame.highlightNodeIds || [])
      const highlightEdgeSet = new Set(frame.highlightEdgeIds || [])

      const transitionDuration = animate ? 400 : 0

      const allNodes = this.graph.getNodes()
      for (const node of allNodes) {
        const data = node.getData() as Record<string, unknown> | undefined
        if (data?.isForkNode || data?.isAttributeTag || data?.isAttributeStem) continue
        const nodeId = node.id

        const isHighlighted = highlightNodeSet.has(nodeId)
        const isInCurrentOrEarlierFrame = this.isNodeInFrameUpTo(nodeId, clampedIndex)

        const original = this.originalNodeStyles.get(nodeId)
        if (!original) continue

        let opacity: number
        let stroke: string
        let strokeWidth: number

        if (frame.index === 0) {
          opacity = isHighlighted ? 1 : 0.15
          stroke = isHighlighted ? original.stroke : '#cccccc'
          strokeWidth = isHighlighted ? original.strokeWidth : 1
        } else if (isHighlighted) {
          opacity = 1
          stroke = '#1890FF'
          strokeWidth = 3
        } else if (isInCurrentOrEarlierFrame) {
          opacity = 0.3
          stroke = '#bbbbbb'
          strokeWidth = 1
        } else {
          opacity = 0.08
          stroke = '#dddddd'
          strokeWidth = 0.5
        }

        if (animate) {
          node.transition('attrs/body/opacity', opacity, { duration: transitionDuration })
          node.transition('attrs/body/stroke', stroke, { duration: transitionDuration })
          node.transition('attrs/body/strokeWidth', strokeWidth, { duration: transitionDuration })
        } else {
          node.attr('body/opacity', opacity)
          node.attr('body/stroke', stroke)
          node.attr('body/strokeWidth', strokeWidth)
        }
      }

      const allEdges = this.graph.getEdges()
      for (const edge of allEdges) {
        const edgeId = edge.id
        const data = edge.getData() as Record<string, unknown> | undefined

        const connectedNodeIds: string[] = []
        const sourceId = edge.getSourceCellId()
        const targetId = edge.getTargetCellId()
        if (sourceId) connectedNodeIds.push(sourceId)
        if (targetId) connectedNodeIds.push(targetId)

        let isHighlighted = highlightEdgeSet.has(edgeId)

        if (!isHighlighted && (data?.isTrunk || data?.isBranch)) {
          if (data.isTrunk) {
            const mergedIds = data.mergedEdgeIds as string[] | undefined
            if (mergedIds) {
              for (const mid of mergedIds) {
                if (highlightEdgeSet.has(mid)) {
                  isHighlighted = true
                  break
                }
              }
            }
          }
          if (data.isBranch) {
            const originalEdgeId = data.originalEdgeId as string | undefined
            if (originalEdgeId && highlightEdgeSet.has(originalEdgeId)) {
              isHighlighted = true
            }
          }
        }

        const edgeHighlightedByNode = connectedNodeIds.some(nid => highlightNodeSet.has(nid))
        const isEdgeVisibleInFrame = isHighlighted || edgeHighlightedByNode
        const isEdgeInEarlierFrame = this.isEdgeInFrameUpTo(edgeId, clampedIndex, data)

        const original = this.originalEdgeStyles.get(edgeId)
        if (!original) continue

        let opacity: number
        let stroke: string
        let strokeWidth: number

        if (frame.index === 0) {
          opacity = isEdgeVisibleInFrame ? 1 : 0.1
          stroke = isEdgeVisibleInFrame ? original.stroke : '#dddddd'
          strokeWidth = isEdgeVisibleInFrame ? original.strokeWidth : 1
        } else if (isHighlighted) {
          opacity = 1
          stroke = '#1890FF'
          strokeWidth = 4
        } else if (isEdgeInEarlierFrame) {
          opacity = 0.25
          stroke = '#cccccc'
          strokeWidth = 1
        } else {
          opacity = 0.05
          stroke = '#eeeeee'
          strokeWidth = 0.5
        }

        if (animate) {
          edge.transition('attrs/line/opacity', opacity, { duration: transitionDuration })
          edge.transition('attrs/line/stroke', stroke, { duration: transitionDuration })
          edge.transition('attrs/line/strokeWidth', strokeWidth, { duration: transitionDuration })
        } else {
          edge.attr('line/opacity', opacity)
          edge.attr('line/stroke', stroke)
          edge.attr('line/strokeWidth', strokeWidth)
        }
      }

      if (frame.index > 0 && frame.highlightNodeIds.length > 0) {
        setTimeout(() => {
          this.zoomToFitNodes(frame.highlightNodeIds)
        }, animate ? transitionDuration + 50 : 50)
      }
    } finally {
      this.graph.stopBatch('frame-apply')
      this.stopSkipHistory()
    }
  }

  private isNodeInFrameUpTo(nodeId: string, frameIndex: number): boolean {
    for (let i = 0; i <= frameIndex; i++) {
      const f = this.frames[i]
      if (f.highlightNodeIds?.includes(nodeId)) return true
    }
    return false
  }

  private isEdgeInFrameUpTo(edgeId: string, frameIndex: number, data?: Record<string, unknown>): boolean {
    for (let i = 0; i <= frameIndex; i++) {
      const f = this.frames[i]
      if (f.highlightEdgeIds?.includes(edgeId)) return true
    }
    if (data?.isTrunk) {
      const mergedIds = data.mergedEdgeIds as string[] | undefined
      if (mergedIds) {
        for (const mid of mergedIds) {
          if (this.isEdgeInFrameUpTo(mid, frameIndex)) return true
        }
      }
    }
    return false
  }

  resetAllStyles(): void {
    if (!this.graph) return
    this.currentFrameIndex = -1
    this.startSkipHistory()
    this.graph.startBatch('frame-reset')
    try {
      for (const [nodeId, original] of this.originalNodeStyles) {
        const node = this.graph.getCellById(nodeId)
        if (node && node.isNode()) {
          node.attr('body/opacity', original.opacity)
          node.attr('body/stroke', original.stroke)
          node.attr('body/strokeWidth', original.strokeWidth)
        }
      }
      for (const [edgeId, original] of this.originalEdgeStyles) {
        const edge = this.graph.getCellById(edgeId)
        if (edge && edge.isEdge()) {
          edge.attr('line/opacity', original.opacity)
          edge.attr('line/stroke', original.stroke)
          edge.attr('line/strokeWidth', original.strokeWidth)
          edge.attr('line/strokeDasharray', original.strokeDasharray)
        }
      }
    } finally {
      this.graph.stopBatch('frame-reset')
      this.stopSkipHistory()
    }
  }

  private zoomToFitNodes(nodeIds: string[]): void {
    if (!this.graph || nodeIds.length === 0) return
    const cells = nodeIds
      .map(id => this.graph!.getCellById(id))
      .filter(c => c && c.isNode())
    if (cells.length === 0) return
    this.graph.zoomToFit({ padding: 80, maxScale: 1.2 })
  }
}

export const graphEngine = new GraphEngine()
