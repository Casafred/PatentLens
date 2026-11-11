<template>
  <div class="canvas-toolbar">
    <div class="toolbar-group">
      <el-tooltip content="打开项目" placement="bottom">
        <el-button size="small" :disabled="aiStore.isExtracting" @click="handleLoadProject">打开</el-button>
      </el-tooltip>
      <el-tooltip content="保存项目" placement="bottom">
        <el-button size="small" @click="handleSaveProject">保存</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom">
        <el-button size="small" :icon="RefreshLeft" @click="engine.undo()" />
      </el-tooltip>
      <el-tooltip content="重做 (Ctrl+Y)" placement="bottom">
        <el-button size="small" :icon="RefreshRight" @click="engine.redo()" />
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="适配画布" placement="bottom">
        <el-button size="small" @click="engine.fitView()">适配</el-button>
      </el-tooltip>
      <el-tooltip content="居中" placement="bottom">
        <el-button size="small" @click="engine.centerContent()">居中</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="恢复到初始生成状态" placement="bottom">
        <el-button size="small" :disabled="!engine.hasInitialState()" @click="handleResetToInitial">重置</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="添加新节点" placement="bottom">
        <el-button size="small" type="success" @click="handleAddNode">+ 节点</el-button>
      </el-tooltip>
      <el-tooltip content="添加组合框" placement="bottom">
        <el-button size="small" type="warning" @click="handleAddGroup">+ 组合框</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="显示/隐藏组合框" placement="bottom">
        <el-checkbox v-model="groupsVisible" size="small" @change="handleToggleGroups">组合框</el-checkbox>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="统一调节字号" placement="bottom">
        <div class="font-size-control">
          <span class="font-size-label">字号</span>
          <el-button size="small" @click="handleFontSizeChange(-1)" :disabled="globalFontSize <= 10">−</el-button>
          <span class="font-size-value">{{ globalFontSize }}px</span>
          <el-button size="small" @click="handleFontSizeChange(1)" :disabled="globalFontSize >= 28">+</el-button>
        </div>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="清空画布" placement="bottom">
        <el-button size="small" type="danger" :disabled="aiStore.isExtracting" @click="handleClearCanvas">清空</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="基于当前图 AI 重构，进入新版本" placement="bottom">
        <el-button size="small" type="primary" plain :disabled="!canRedraw" @click="redrawDialogVisible = true">AI 重构</el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group">
      <el-tooltip content="查看分析任务队列与重试" placement="bottom">
        <el-badge
          :value="taskBadgeCount"
          :hidden="taskBadgeCount === 0"
          :type="parallel.hasFailed.value ? 'danger' : 'primary'"
          class="task-badge"
        >
          <el-button size="small" @click="parallel.toggleTaskPanel()">任务中心</el-button>
        </el-badge>
      </el-tooltip>
    </div>

    <div class="toolbar-group">
      <el-tooltip content="一键切换面板布局（Ctrl+Shift+1~4）" placement="bottom">
        <el-dropdown trigger="click" @command="handleLayoutCommand">
          <el-button size="small">
            布局 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="item in LAYOUT_ITEMS"
                :key="item.value"
                :command="item.value"
              >
                {{ item.label }}
                <span class="layout-shortcut">{{ item.shortcut }}</span>
              </el-dropdown-item>
              <el-dropdown-item command="toggleDrawer" divided>
                {{ editorStore.layout.drawerOpen ? '关闭工作区' : '打开工作区' }}
                <span class="layout-shortcut">Ctrl+Shift+B</span>
              </el-dropdown-item>
              <el-dropdown-item command="toggleInputPanel">
                {{ editorStore.layout.inputPanelVisible ? '隐藏输入面板' : '显示输入面板' }}
                <span class="layout-shortcut">Ctrl+Shift+E</span>
              </el-dropdown-item>
              <el-dropdown-item command="toggleForceStylePanel">
                {{ editorStore.layout.forceStylePanel ? '取消固定样式面板' : '固定显示样式面板' }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-tooltip>
    </div>

    <div class="toolbar-spacer" />

    <div class="toolbar-group">
      <el-dropdown trigger="click" @command="handleExport">
        <el-button size="small" type="primary">
          导出 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="png">导出 PNG (3x 高清)</el-dropdown-item>
            <el-dropdown-item command="svg">导出 SVG</el-dropdown-item>
            <el-dropdown-item command="html" divided>导出可交互 HTML</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <CellEditDialog
      v-model:visible="addDialogVisible"
      :is-node="addDialogMode === 'node'"
      :initial-original-text="addOriginalText"
      :initial-chinese-text="addChineseText"
      :initial-node-type="addNodeType"
      @save="handleAddSave"
    />

    <RedrawDialog
      v-model:visible="redrawDialogVisible"
      :source-file-id="activeFileId"
    />
  </div>
</template>

<script setup lang="ts">
import { RefreshLeft, RefreshRight, ArrowDown } from '@element-plus/icons-vue'
import { ref, computed } from 'vue'
import { graphEngine } from '@/services/graph/engine'
import { useExport } from '@/composables/useExport'
import { useProjectFile } from '@/composables/useProjectFile'
import { useGraphStore } from '@/stores/graph'
import { useAIStore } from '@/stores/ai'
import { useEditorStore, type LayoutPreset } from '@/stores/editor'
import { useParallelExtract } from '@/composables/useParallelExtract'
import type { ExportFormat } from '@/types/app'
import type { NodeType } from '@/types/graph'
import { getDefaultNodeStyle } from '@/services/graph/style-registry'
import CellEditDialog from '../common/CellEditDialog.vue'
import RedrawDialog from '../ai/RedrawDialog.vue'

const engine = graphEngine
const graphStore = useGraphStore()
const aiStore = useAIStore()
const editorStore = useEditorStore()
const parallel = useParallelExtract()

/** 布局预设（与 Ctrl+Shift+1~4 对应） */
const LAYOUT_ITEMS: Array<{ value: LayoutPreset; label: string; shortcut: string }> = [
  { value: 'default', label: '默认（全显示）', shortcut: 'Ctrl+Shift+1' },
  { value: 'focus', label: '专注画布', shortcut: 'Ctrl+Shift+2' },
  { value: 'compare', label: '输入对照', shortcut: 'Ctrl+Shift+3' },
  { value: 'review', label: '审阅（含样式面板）', shortcut: 'Ctrl+Shift+4' },
]

function handleLayoutCommand(command: string): void {
  if (command === 'toggleDrawer') {
    editorStore.toggleWorkspaceDrawer()
  } else if (command === 'toggleInputPanel') {
    editorStore.toggleInputPanel()
  } else if (command === 'toggleForceStylePanel') {
    editorStore.toggleForceStylePanel()
  } else {
    editorStore.applyLayoutPreset(command as LayoutPreset)
  }
}
const globalFontSize = computed(() => Math.round((graphStore.globalNodeFontSize + graphStore.globalEdgeFontSize) / 2))
const { downloadFile } = useExport()
const { saveProject, loadProject } = useProjectFile()

const addDialogVisible = ref(false)
const addDialogMode = ref<'node' | 'group'>('node')
const addOriginalText = ref('')
const addChineseText = ref('')
const addNodeType = ref<NodeType>('component')
const groupsVisible = ref(true)
const redrawDialogVisible = ref(false)

const activeFileId = computed(() => graphStore.activeFile?.id ?? '')

// 任务中心角标：未完成任务数（含失败），失败时红色提示
const taskBadgeCount = computed(() =>
  parallel.tasks.value.filter(t => t.status !== 'success').length,
)

// 当前文件存在可重构的版本（有版本即可：基准取当前画布或版本抽取结果）且有 API Key 时可用
const canRedraw = computed(() => {
  return !!(graphStore.activeVersion && aiStore.activeApiKey && !aiStore.isExtracting)
})

function handleFontSizeChange(delta: number): void {
  const newNodeSize = Math.max(10, Math.min(28, graphStore.globalNodeFontSize + delta))
  const newEdgeSize = Math.max(10, Math.min(28, graphStore.globalEdgeFontSize + delta))
  graphStore.setGlobalNodeFontSize(newNodeSize)
  graphStore.setGlobalEdgeFontSize(newEdgeSize)
  engine.setAllNodeFontSize(newNodeSize)
  engine.setAllEdgeFontSize(newEdgeSize)
}

function handleResetToInitial(): void {
  engine.resetToInitial()
}

function handleExport(format: string): void {
  downloadFile(format as ExportFormat)
}

async function handleSaveProject(): Promise<void> {
  await saveProject()
}

async function handleLoadProject(): Promise<void> {
  await loadProject()
}

function handleClearCanvas(): void {
  const graph = engine.getGraph()
  if (graph) {
    graph.clearCells()
  }
  graphStore.clearActiveFileGraph()
}

function handleAddNode(): void {
  addDialogMode.value = 'node'
  addOriginalText.value = ''
  addChineseText.value = ''
  addNodeType.value = 'component'
  addDialogVisible.value = true
}

function handleAddGroup(): void {
  addDialogMode.value = 'group'
  addOriginalText.value = ''
  addChineseText.value = ''
  addDialogVisible.value = true
}

function handleToggleGroups(visible: boolean): void {
  engine.toggleGroupsVisible(visible)
}

function handleAddSave(data: { originalText: string; chineseText: string; nodeType?: NodeType }): void {
  const graph = engine.getGraph()
  if (!graph) return

  if (addDialogMode.value === 'node') {
    const id = `node-${Date.now()}`
    const style = getDefaultNodeStyle(data.nodeType || 'component')
    engine.addNode({
      id,
      originalText: data.originalText,
      chineseText: data.chineseText,
      nodeType: data.nodeType || 'component',
      hierarchyLevel: 0,
      style,
      x: 100,
      y: 100,
    })
  } else {
    const id = `group-${Date.now()}`
    const label = data.originalText || '新组合框'
    engine.addGroup(id, label, 50, 50)
  }
}
</script>

<style scoped>
.layout-shortcut {
  margin-left: 12px;
  font-size: 11px;
  color: #999;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 var(--spacing-sm);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  gap: var(--spacing-xs);
  overflow-x: auto;
  overflow-y: hidden;
}

.canvas-toolbar::-webkit-scrollbar {
  height: 4px;
}

.canvas-toolbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 2px;
}

.canvas-toolbar::-webkit-scrollbar-track {
  background: transparent;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border-color);
  margin: 0 var(--spacing-xs);
  flex-shrink: 0;
}

.toolbar-spacer {
  flex: 1;
  min-width: 20px;
}

.font-size-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.font-size-label {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.font-size-value {
  font-size: 12px;
  color: var(--text-primary);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
