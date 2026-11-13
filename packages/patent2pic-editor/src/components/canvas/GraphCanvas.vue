<template>
  <div class="graph-canvas" ref="canvasContainerRef">
    <div class="canvas-viewport" ref="viewportRef"></div>
    <GraphLegend />
    <div class="canvas-status">
      <span class="zoom-label">{{ Math.round(editorStore.zoom * 100) }}%</span>
    </div>

    <PlaybackControls />

    <CellEditDialog
      v-model:visible="editDialogVisible"
      :is-node="editIsNode"
      :initial-original-text="editOriginalText"
      :initial-chinese-text="editChineseText"
      :initial-node-type="editNodeType"
      :initial-relation-type="editRelationType"
      @save="handleEditSave"
    />

    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <template v-if="contextMenu.type === 'node'">
        <div class="menu-item" @click="handleMenuAction('edit')">编辑</div>
        <div class="menu-item" @click="handleMenuAction('delete')">删除</div>
        <div class="menu-item" @click="handleMenuAction('addEdge')">添加连接</div>
        <div class="menu-divider" />
        <div class="menu-item" @click="handleMenuAction('createGroup')">添加到限定框</div>
        <template v-if="contextMenu.isGroup">
          <div class="menu-divider" />
          <div class="menu-item" @click="handleMenuAction('toggleGroupDetach')">
            {{ contextMenu.isGroupDetached ? '锁定跟随成员节点' : '脱离自由移动' }}
          </div>
        </template>
        <div class="menu-divider" />
        <div class="menu-item" @click="handleMenuAction('bringToFront')">置于顶层</div>
        <div class="menu-item" @click="handleMenuAction('bringForward')">上浮一层</div>
        <div class="menu-item" @click="handleMenuAction('sendBackward')">下移一层</div>
        <div class="menu-item" @click="handleMenuAction('sendToBack')">置于底层</div>
      </template>
      <template v-if="contextMenu.type === 'edge'">
        <div class="menu-item" @click="handleMenuAction('edit')">编辑</div>
        <div class="menu-item" @click="handleMenuAction('delete')">删除</div>
        <div class="menu-divider" />
        <div class="menu-item" @click="handleMenuAction('toggleLabelDetach')">
          {{ engine.isEdgeLabelDetached(contextMenu.cellId) ? '锁定到线条' : '脱离线条自由移动' }}
        </div>
        <div class="menu-divider" />
        <div class="menu-item" @click="handleMenuAction('bringToFront')">置于顶层</div>
        <div class="menu-item" @click="handleMenuAction('bringForward')">上浮一层</div>
        <div class="menu-item" @click="handleMenuAction('sendBackward')">下移一层</div>
        <div class="menu-item" @click="handleMenuAction('sendToBack')">置于底层</div>
      </template>
      <template v-if="contextMenu.type === 'blank'">
        <div class="menu-item" @click="handleMenuAction('fitView')">适配画布</div>
        <div class="menu-item" @click="handleMenuAction('autoLayout')">自动布局</div>
        <div class="menu-item" @click="handleMenuAction('selectAll')">全选</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useGraph } from '@/composables/useGraph'
import { useKeyboard } from '@/composables/useKeyboard'
import { useEditorStore } from '@/stores/editor'
import { useGraphStore } from '@/stores/graph'
import { getDefaultNodeStyle, getDefaultEdgeStyle } from '@/services/graph/style-registry'
import { calculateNodeSize, buildNode } from '@/services/graph/node-builder'
import { wrapLabelText } from '@/utils/label-text'
import CellEditDialog from '../common/CellEditDialog.vue'
import GraphLegend from './GraphLegend.vue'
import PlaybackControls from './PlaybackControls.vue'
import type { NodeType, RelationType, NodeData } from '@/types/graph'

const editorStore = useEditorStore()
const graphStore = useGraphStore()
const { initGraph, destroyGraph, engine } = useGraph()
useKeyboard()

const viewportRef = ref<HTMLElement | null>(null)

const editDialogVisible = ref(false)
const editIsNode = ref(true)
const editOriginalText = ref('')
const editChineseText = ref('')
const editNodeType = ref<NodeType>('component')
const editRelationType = ref<RelationType>('position')
const editCellId = ref('')

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  type: 'blank' as 'node' | 'edge' | 'blank',
  cellId: '',
  isGroup: false,
  isGroupDetached: false,
})

onMounted(() => {
  if (viewportRef.value) {
    initGraph(viewportRef.value)
    bindExtraEvents()
  }
  window.addEventListener('click', hideContextMenu)
})

onUnmounted(() => {
  destroyGraph()
  window.removeEventListener('click', hideContextMenu)
})

function bindExtraEvents(): void {
  engine.on('node:dblclick', (args: unknown) => {
    const { node } = args as { node: { id: string; getData: () => Record<string, unknown> } }
    const data = node.getData()
    editCellId.value = node.id
    editIsNode.value = true
    editOriginalText.value = (data?.originalText as string) || ''
    editChineseText.value = (data?.chineseText as string) || ''
    editNodeType.value = (data?.nodeType as NodeType) || 'component'
    editDialogVisible.value = true
  })

  engine.on('edge:dblclick', (args: unknown) => {
    const { edge } = args as { edge: { id: string; getData: () => Record<string, unknown> } }
    const data = edge.getData()
    editCellId.value = edge.id
    editIsNode.value = false
    editOriginalText.value = (data?.originalText as string) || ''
    editChineseText.value = (data?.chineseText as string) || ''
    editRelationType.value = (data?.relationType as RelationType) || 'position'
    editDialogVisible.value = true
  })

  engine.on('node:contextmenu', (args: unknown) => {
    const { node, e } = args as { node: { id: string }; e: { clientX: number; clientY: number; preventDefault?: () => void } }
    e.preventDefault?.()
    const graph = engine.getGraph()
    const cell = graph?.getCellById(node.id)
    const data = cell?.getData() as Record<string, unknown> | undefined
    const isGroup = !!(data?.isGroup)
    const isGroupDetached = isGroup && !!(data?.detached)
    editorStore.selectNodes([node.id])
    showContextMenu(e.clientX, e.clientY, 'node', node.id, isGroup, isGroupDetached)
  })

  engine.on('edge:contextmenu', (args: unknown) => {
    const { edge, e } = args as { edge: { id: string }; e: { clientX: number; clientY: number; preventDefault?: () => void } }
    e.preventDefault?.()
    editorStore.selectEdges([edge.id])
    showContextMenu(e.clientX, e.clientY, 'edge', edge.id)
  })

  engine.on('edge:label:contextmenu', (args: unknown) => {
    const { edge, e } = args as { edge: { id: string }; e: { clientX: number; clientY: number; preventDefault?: () => void } }
    e.preventDefault?.()
    editorStore.selectEdges([edge.id])
    showContextMenu(e.clientX, e.clientY, 'edge', edge.id)
  })

  engine.on('blank:contextmenu', (args: unknown) => {
    const { e } = args as { e: { clientX: number; clientY: number; preventDefault?: () => void } }
    e.preventDefault?.()
    showContextMenu(e.clientX, e.clientY, 'blank', '')
  })
}

function showContextMenu(x: number, y: number, type: 'node' | 'edge' | 'blank', cellId: string, isGroup: boolean = false, isGroupDetached: boolean = false): void {
  contextMenu.visible = true
  contextMenu.x = x
  contextMenu.y = y
  contextMenu.type = type
  contextMenu.cellId = cellId
  contextMenu.isGroup = isGroup
  contextMenu.isGroupDetached = isGroupDetached
}

function hideContextMenu(): void {
  contextMenu.visible = false
}

async function handleMenuAction(action: string): Promise<void> {
  contextMenu.visible = false
  const graph = engine.getGraph()
  if (!graph) return

  switch (action) {
    case 'edit': {
      const cell = graph.getCellById(contextMenu.cellId)
      if (!cell) return
      const data = cell.getData() as Record<string, unknown>
      editCellId.value = contextMenu.cellId
      if (cell.isNode()) {
        editIsNode.value = true
        editOriginalText.value = (data?.originalText as string) || ''
        editChineseText.value = (data?.chineseText as string) || ''
        editNodeType.value = (data?.nodeType as NodeType) || 'component'
      } else {
        editIsNode.value = false
        editOriginalText.value = (data?.originalText as string) || ''
        editChineseText.value = (data?.chineseText as string) || ''
        editRelationType.value = (data?.relationType as RelationType) || 'position'
      }
      editDialogVisible.value = true
      break
    }
    case 'delete': {
      if (contextMenu.type === 'node') {
        const connectedEdgeIds = engine.getConnectedEdgeIds(contextMenu.cellId)

        if (connectedEdgeIds.length > 0) {
          try {
            await ElMessageBox.confirm(
              `该节点有 ${connectedEdgeIds.length} 条连接的边关系，请选择删除方式：`,
              '确认删除节点',
              {
                distinguishCancelAndClose: true,
                confirmButtonText: '删除节点和相关边',
                cancelButtonText: '仅删除节点',
                type: 'warning',
              }
            )
            engine.removeNodeWithOption(contextMenu.cellId, true)
            editorStore.clearSelection()
          } catch (action: unknown) {
            if (action === 'cancel') {
              engine.removeNodeWithOption(contextMenu.cellId, false)
              editorStore.clearSelection()
            }
          }
        } else {
          try {
            await ElMessageBox.confirm(
              '确定要删除此节点吗？',
              '确认删除',
              {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning',
              }
            )
            engine.removeNodeWithOption(contextMenu.cellId, true)
            editorStore.clearSelection()
          } catch {
            // 用户取消
          }
        }
      } else {
        try {
          await ElMessageBox.confirm(
            '确定要删除此边关系吗？',
            '确认删除',
            {
              confirmButtonText: '删除',
              cancelButtonText: '取消',
              type: 'warning',
            }
          )
          engine.removeEdge(contextMenu.cellId)
          editorStore.clearSelection()
        } catch {
          // 用户取消
        }
      }
      break
    }
    case 'toggleLabelDetach':
      engine.toggleEdgeLabelDetached(contextMenu.cellId)
      break
    case 'addEdge':
      break
    case 'createGroup':
      break
    case 'toggleGroupDetach':
      engine.toggleGroupDetached(contextMenu.cellId)
      break
    case 'bringToFront':
      engine.bringToFront(contextMenu.cellId)
      break
    case 'bringForward':
      engine.bringForward(contextMenu.cellId)
      break
    case 'sendBackward':
      engine.sendBackward(contextMenu.cellId)
      break
    case 'sendToBack':
      engine.sendToBack(contextMenu.cellId)
      break
    case 'fitView':
      engine.fitView()
      break
    case 'autoLayout':
      await engine.applyLayout()
      break
    case 'selectAll':
      engine.selectAll()
      break
  }
}

function getLabelText(data: { originalText: string; chineseText: string }): string {
  const isChinese = graphStore.activeFile?.isChinese ?? false
  if (isChinese) {
    return wrapLabelText(data.chineseText || data.originalText)
  }
  if (!data.chineseText) return wrapLabelText(data.originalText)
  return wrapLabelText(`${data.originalText}\n${data.chineseText}`)
}

function handleEditSave(data: { originalText: string; chineseText: string; nodeType?: NodeType; relationType?: RelationType }): void {
  const graph = engine.getGraph()
  if (!graph) return

  const cell = graph.getCellById(editCellId.value)
  if (!cell) return

  graph.startBatch('editSave')
  const labelText = getLabelText(data)

  if (cell.isNode()) {
    const node = cell as unknown as { attr: (path: string, value?: unknown) => unknown; setData: (data: Record<string, unknown>) => void }
    node.attr('label/text', labelText)
    const prevData = (cell.getData() as Record<string, unknown>) || {}
    node.setData({ ...prevData, originalText: data.originalText, chineseText: data.chineseText, nodeType: data.nodeType })

    const isChinese = graphStore.activeFile?.isChinese ?? false
    const prevStyle = (prevData.style as Record<string, unknown>) || {}
    const fontSize = (prevStyle.fontSize as number) || 15
    const fontFamily = (prevStyle.fontFamily as string) || '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    const fontWeight = (prevStyle.fontWeight as string) || 'bold'
    const prevWidth = (prevStyle.width as number) || 160
    const prevHeight = (prevStyle.height as number) || 60
    const newSize = calculateNodeSize(data.originalText, data.chineseText, isChinese, fontSize, fontFamily, fontWeight, prevWidth, prevHeight)

    engine.updateNodeStyle(editCellId.value, {
      width: newSize.width,
      height: newSize.height,
    })

    if (data.nodeType) {
      const prevNodeType = prevData.nodeType as NodeType | undefined
      // If node type changed (especially between structure and method types),
      // we need to rebuild the node because shape cannot be changed via attr
      if (prevNodeType && prevNodeType !== data.nodeType) {
        const pos = (cell as unknown as { getPosition: () => { x: number; y: number } }).getPosition()
        const connectedEdges = graph.getConnectedEdges(cell)

        // Build new node with updated type
        const newNodeData: NodeData = {
          id: editCellId.value,
          originalText: data.originalText,
          chineseText: data.chineseText,
          nodeType: data.nodeType,
          hierarchyLevel: (prevData.hierarchyLevel as number) ?? 0,
          style: getDefaultNodeStyle(data.nodeType),
          x: pos.x,
          y: pos.y,
        }
        const newNodeConfig = buildNode(newNodeData, graphStore.activeFile?.isChinese ?? false)

        // Remove old node and add new one
        cell.remove()
        graph.addNode(newNodeConfig)

        // Re-add connected edges
        for (const edge of connectedEdges) {
          const edgeConfig = edge.toJSON()
          graph.addEdge(edgeConfig)
        }
      } else {
        const style = getDefaultNodeStyle(data.nodeType)
        engine.updateNodeStyle(editCellId.value, {
          fill: style.fill,
          stroke: style.stroke,
        })
      }
    }
  } else {
    const edge = cell as unknown as { getLabels: () => unknown[]; setLabels: (labels: unknown[]) => void; setData: (data: Record<string, unknown>) => void }
    const labels = edge.getLabels()
    if (labels.length > 0) {
      const existingLabel = labels[0] as Record<string, unknown>
      const existingAttrs = (existingLabel.attrs || {}) as Record<string, unknown>
      const existingLabelText = (existingAttrs.labelText || {}) as Record<string, unknown>
      const existingBg = (existingAttrs.bg || {}) as Record<string, unknown>

      const newLabel = {
        ...existingLabel,
        attrs: {
          bg: existingBg,
          labelText: {
            ...existingLabelText,
            text: labelText,
          },
        },
      }
      edge.setLabels([newLabel])
    } else {
      // Edge has no labels yet (e.g. manually created edge), add one
      edge.setLabels([{
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
            text: labelText,
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
      }])
    }
    const prevData = (cell.getData() as Record<string, unknown>) || {}
    edge.setData({ ...prevData, originalText: data.originalText, chineseText: data.chineseText, relationType: data.relationType })

    if (data.relationType) {
      const style = getDefaultEdgeStyle(data.relationType)
      engine.updateEdgeStyle(editCellId.value, {
        stroke: style.stroke,
        strokeDasharray: style.strokeDasharray,
        arrowType: style.arrowType,
      })
    }
  }
  graph.stopBatch('editSave')
}
</script>

<style scoped>
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.canvas-viewport {
  width: 100%;
  height: 100%;
}

.canvas-status {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

.zoom-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  min-width: 36px;
  text-align: center;
}

.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 140px;
  padding: 4px 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.menu-item {
  padding: 6px 16px;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.15s;
}

.menu-item:hover {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border-color-light);
}
</style>
