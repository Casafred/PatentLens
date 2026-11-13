<template>
  <div class="app-layout">
    <button class="workspace-edge-toggle" :class="{ open: editorStore.layout.drawerOpen }" :aria-expanded="editorStore.layout.drawerOpen" aria-label="打开项目与任务文件夹" title="项目与任务文件夹" @click="editorStore.toggleWorkspaceDrawer()">{{ editorStore.layout.drawerOpen ? '‹' : '›' }}</button>
    <!-- 工作区抽屉：覆盖式浮层，不挤占画布宽度 -->
    <transition name="drawer-fade">
      <div
        v-if="editorStore.layout.drawerOpen"
        class="drawer-backdrop"
        @click="editorStore.closeWorkspaceDrawer()"
      ></div>
    </transition>
    <transition name="drawer-slide">
      <WorkspaceSidebar v-if="editorStore.layout.drawerOpen" class="workspace-drawer" :inert="aiStore.isExtracting" />
    </transition>

    <div
      v-show="editorStore.layout.inputPanelVisible"
      class="left-panel"
      ref="leftPanelRef"
      :style="{ width: editorStore.layout.inputPanelWidth + 'px' }"
    >
      <ClaimInput />
      <ClaimReader />
    </div>
    <div
      v-if="editorStore.layout.inputPanelVisible"
      class="resize-handle resize-handle-left"
      @mousedown="startResizeLeft"
    ></div>
    <div class="center-panel">
      <CanvasToolbar />
      <TabBar :inert="aiStore.isExtracting" />
      <div class="canvas-area">
        <GraphCanvas ref="graphCanvasRef" />
        <TaskCenter />
      </div>
    </div>
    <div class="resize-handle resize-handle-right" v-if="rightPanelVisible" @mousedown="startResizeRight"></div>
    <div class="right-panel" v-if="rightPanelVisible" ref="rightPanelRef" :style="{ width: rightPanelWidth + 'px' }">
      <StylePanel />
    </div>
  </div>
</template>

<script setup lang="ts">

import { computed, ref, watch, onBeforeUnmount } from 'vue'
import ClaimInput from '../input/ClaimInput.vue'
import ClaimReader from '../input/ClaimReader.vue'
import GraphCanvas from '../canvas/GraphCanvas.vue'
import CanvasToolbar from '../canvas/CanvasToolbar.vue'
import TabBar from '../canvas/TabBar.vue'
import TaskCenter from '../canvas/TaskCenter.vue'
import StylePanel from '../panel/StylePanel.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import { useEditorStore } from '@/stores/editor'
import { useGraphStore } from '@/stores/graph'
import { useAIStore } from '@/stores/ai'
import { usePlaybackStore } from '@/stores/playback'
import { graphEngine } from '@/services/graph/engine'
import { trackCanvasRender } from '@/services/graph/render-state'

const editorStore = useEditorStore()
const graphStore = useGraphStore()
const aiStore = useAIStore()
const playback = usePlaybackStore()
const graphCanvasRef = ref<InstanceType<typeof GraphCanvas> | null>(null)
const leftPanelRef = ref<HTMLElement | null>(null)
const rightPanelRef = ref<HTMLElement | null>(null)

const rightPanelWidth = ref(280)

const hasSelection = computed(() =>
  editorStore.selectedNodeIds.length > 0 || editorStore.selectedEdgeIds.length > 0,
)

// 右侧面板：有选中、显式打开样式面板，或被布局预设强制显示时出现
const rightPanelVisible = computed(() =>
  editorStore.activePanel === 'style' || hasSelection.value || editorStore.layout.forceStylePanel,
)

// Resize handle logic
let resizingSide: 'left' | 'right' | null = null
let startX = 0
let startWidth = 0

function startResizeLeft(e: MouseEvent): void {
  resizingSide = 'left'
  startX = e.clientX
  startWidth = editorStore.layout.inputPanelWidth
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function startResizeRight(e: MouseEvent): void {
  resizingSide = 'right'
  startX = e.clientX
  startWidth = rightPanelWidth.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent): void {
  if (resizingSide === 'left') {
    const delta = e.clientX - startX
    editorStore.setInputPanelWidth(Math.max(280, Math.min(600, startWidth + delta)))
  } else if (resizingSide === 'right') {
    const delta = startX - e.clientX
    rightPanelWidth.value = Math.max(200, Math.min(500, startWidth + delta))
  }
}

function onResizeEnd(): void {
  resizingSide = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  // 拖拽结束后才写盘，避免 mousemove 高频写 editorStorage
  editorStore.persistLayout()
}

/** Esc 关闭工作区抽屉（覆盖式浮层需要快捷退出） */
function onDrawerKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !editorStore.layout.drawerOpen) return
  // 有弹窗/对话框时 Esc 只应关闭弹窗，避免连带关闭抽屉
  if (document.querySelector('.el-overlay')) return
  editorStore.closeWorkspaceDrawer()
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  window.removeEventListener('keydown', onDrawerKeyDown)
})

window.addEventListener('keydown', onDrawerKeyDown)

// 启动即保证存在活动画布文件：输入状态（rawText/claims）是活动文件的投影，
// 没有活动文件时输入框将无法写入
graphStore.ensureDefaultFile()

/**
 * 渲染键：活动文件 + 活动版本 + 修订号。任一变化即重渲染画布。
 * 这是画布渲染的唯一入口（切换文件 / 切换版本 / 分析追加版本 / 重构追加版本 / 快照回退）。
 * 输入与翻译状态无需在此处理：输入是文件投影，翻译随 activateFile 切换。
 */
const renderKey = computed(() =>
  `${graphStore.activeFileId}::${graphStore.activeFile?.activeVersionId ?? ''}::${graphStore.graphRevision}`,
)

watch(renderKey, (newKey, oldKey) => { trackCanvasRender((async () => {
  const [newFileId, newVersionId] = newKey.split('::')

  // 目标（文件+版本）未变、仅修订号变化时说明画布内容已被外部改写（如快照回退），
  // 此时不能把当前画布回写旧版本，否则会覆盖刚恢复的内容
  if (oldKey) {
    const [oldFileId, oldVersionId] = oldKey.split('::')
    const targetChanged = oldFileId !== newFileId || oldVersionId !== newVersionId
    const graph = graphEngine.getGraph()
    if (targetChanged && oldFileId && oldVersionId && graph && graph.getCells().length > 0) {
      graphStore.updateVersionSerializedGraph(oldFileId, oldVersionId, graphEngine.toJSON())
    }
  }

  const graph = graphEngine.getGraph()
  if (!graph) return
  graph.clearCells()
  playback.clearFrames()

  const version = graphStore.activeVersion
  if (!version) return

  if (version.serializedGraph && Object.keys(version.serializedGraph).length > 0) {
    graphEngine.fromJSON(version.serializedGraph)
    if (playback.animationMode && version.extractResult?.frames?.length) {
      playback.setFrames(version.extractResult.frames)
    } else {
      graphEngine.showFullGraph()
    }
  } else if (version.extractResult) {
    await graphEngine.batchBuild(version.extractResult, undefined, graphStore.activeFile?.isChinese ?? false)
    if (playback.animationMode && version.extractResult.frames?.length) {
      playback.setFrames(version.extractResult.frames)
    } else {
      graphEngine.showFullGraph()
    }
  }
})()) })
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.workspace-edge-toggle { position:absolute; top:48%; left:-9px; z-index:50; width:34px; height:64px; padding-left:10px; border:1px solid var(--border-color); border-radius:0 12px 12px 0; color:var(--color-primary); background:var(--bg-secondary); cursor:pointer; font-size:28px; box-shadow:2px 0 8px #0001; transition:left .15s; }
.workspace-edge-toggle:hover,.workspace-edge-toggle:focus-visible { left:0; }

/* 工作区抽屉：覆盖式浮层，画布保持完整宽度 */
.workspace-drawer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 31;
  box-shadow: 2px 0 16px rgba(0, 0, 0, 0.16);
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.18);
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.2s ease;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(-100%);
}

.left-panel {
  min-width: 280px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.resize-handle {
  width: 5px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  z-index: 10;
  transition: background 0.2s;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--color-primary);
  opacity: 0.5;
}

.resize-handle-left {
  margin-left: -2px;
}

.resize-handle-right {
  margin-right: -2px;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  min-width: 200px;
}

.canvas-area {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.right-panel {
  min-width: 200px;
  border-left: 1px solid var(--border-color);
  background: var(--bg-secondary);
  overflow-y: auto;
  flex-shrink: 0;
}
</style>
