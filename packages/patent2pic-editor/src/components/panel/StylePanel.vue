<template>
  <div class="style-panel">
    <div class="panel-header">
      <h3>样式编辑</h3>
      <el-button size="small" text class="close-btn" @click="handleClose">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <div v-if="hasSelection" class="panel-body">
      <template v-if="isNodeSelected">
        <div class="form-section">
          <h4>节点样式</h4>
          <div class="form-row">
            <label>填充颜色</label>
            <el-color-picker v-model="nodeStyle.fill" @change="applyNodeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>边框颜色</label>
            <el-color-picker v-model="nodeStyle.stroke" @change="applyNodeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>边框粗细</label>
            <el-slider v-model="nodeStyle.strokeWidth" :min="0.5" :max="5" :step="0.5" @change="applyNodeStyle" />
          </div>
          <div class="form-row">
            <label>边框样式</label>
            <el-select v-model="nodeBorderStyle" @change="applyNodeBorderStyle" size="small" class="full-select">
              <el-option label="实线" value="solid" />
              <el-option label="虚线" value="dashed" />
            </el-select>
          </div>
          <div class="form-row">
            <label>圆角</label>
            <el-slider v-model="nodeStyle.borderRadius" :min="0" :max="24" :step="2" @change="applyNodeStyle" />
          </div>
        </div>

        <div class="form-section">
          <h4>文字样式</h4>
          <div class="form-row">
            <label>字体</label>
            <el-select v-model="nodeStyle.fontFamily" @change="applyNodeStyle" size="small" class="full-select">
              <el-option v-for="f in FONT_FAMILY_OPTIONS" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </div>
          <div class="form-row">
            <label>字号</label>
            <el-select v-model="nodeStyle.fontSize" @change="applyNodeStyle" size="small">
              <el-option v-for="s in FONT_SIZE_OPTIONS" :key="s" :label="s + 'px'" :value="s" />
            </el-select>
          </div>
          <div class="form-row">
            <label>文字颜色</label>
            <el-color-picker v-model="nodeStyle.fontColor" @change="applyNodeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>粗体</label>
            <el-switch v-model="isBold" @change="applyNodeStyle" />
          </div>
        </div>

        <div class="form-section">
          <h4>尺寸</h4>
          <div class="form-row">
            <label>宽度</label>
            <el-input-number v-model="nodeStyle.width" :min="60" :max="400" :step="10" @change="applyNodeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>高度</label>
            <el-input-number v-model="nodeStyle.height" :min="30" :max="200" :step="10" @change="applyNodeStyle" size="small" />
          </div>
        </div>
      </template>

      <template v-if="isEdgeSelected">
        <div class="form-section">
          <h4>线条样式</h4>
          <div class="form-row">
            <label>线条颜色</label>
            <el-color-picker v-model="edgeStyle.stroke" @change="applyEdgeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>线条粗细</label>
            <el-slider v-model="edgeStyle.strokeWidth" :min="0.5" :max="5" :step="0.5" @change="applyEdgeStyle" />
          </div>
          <div class="form-row">
            <label>线条类型</label>
            <el-select v-model="edgeLineStyle" @change="applyEdgeLineStyle" size="small" class="full-select">
              <el-option v-for="l in LINE_STYLE_OPTIONS" :key="l.value" :label="l.label" :value="l.value" />
            </el-select>
          </div>
          <div class="form-row">
            <label>箭头样式</label>
            <el-select v-model="edgeStyle.arrowType" @change="applyEdgeStyle" size="small" class="full-select">
              <el-option v-for="a in ARROW_TYPE_OPTIONS" :key="a.value" :label="a.label" :value="a.value" />
            </el-select>
          </div>
        </div>

        <div class="form-section">
          <h4>标签样式</h4>
          <div class="form-row">
            <label>字号</label>
            <el-select v-model="edgeStyle.fontSize" @change="applyEdgeStyle" size="small">
              <el-option v-for="s in FONT_SIZE_OPTIONS" :key="s" :label="s + 'px'" :value="s" />
            </el-select>
          </div>
          <div class="form-row">
            <label>文字颜色</label>
            <el-color-picker v-model="edgeStyle.fontColor" @change="applyEdgeStyle" size="small" />
          </div>
          <div class="form-row">
            <label>背景颜色</label>
            <el-color-picker v-model="edgeStyle.labelBgColor" @change="applyEdgeStyle" size="small" />
          </div>
        </div>
      </template>
    </div>

    <div v-else class="panel-body">
      <p class="empty-hint">选中节点或边以编辑样式</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useEditorStore } from '@/stores/editor'
import { graphEngine } from '@/services/graph/engine'
import { getDefaultNodeStyle, getDefaultEdgeStyle, lineStyleToDasharray, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, LINE_STYLE_OPTIONS, ARROW_TYPE_OPTIONS } from '@/services/graph/style-registry'
import type { NodeStyle, EdgeStyle } from '@/types/graph'

const editorStore = useEditorStore()

function handleClose(): void {
  editorStore.clearSelection()
  editorStore.activePanel = null
}

const hasSelection = computed(() => editorStore.selectedNodeIds.length > 0 || editorStore.selectedEdgeIds.length > 0)
const isNodeSelected = computed(() => editorStore.selectedNodeIds.length > 0)
const isEdgeSelected = computed(() => editorStore.selectedEdgeIds.length > 0)

const nodeStyle = reactive<NodeStyle>({ ...getDefaultNodeStyle('component') })
const edgeStyle = reactive<EdgeStyle>({ ...getDefaultEdgeStyle('position') })
const nodeBorderStyle = ref('solid')
const edgeLineStyle = ref<'solid' | 'dashed' | 'dotted' | 'dash-dot'>('solid')
const isBold = ref(false)

watch(() => editorStore.selectedNodeIds, (ids) => {
  if (ids.length > 0) {
    const graph = graphEngine.getGraph()
    if (graph) {
      const cell = graph.getCellById(ids[0])
      if (cell?.isNode()) {
        const node = cell as unknown as { attr: (path: string) => unknown }
        Object.assign(nodeStyle, {
          fill: node.attr('body/fill'),
          stroke: node.attr('body/stroke'),
          strokeWidth: node.attr('body/strokeWidth'),
          fontSize: node.attr('label/fontSize'),
          fontFamily: node.attr('label/fontFamily'),
          fontColor: node.attr('label/fill'),
          fontWeight: node.attr('label/fontWeight'),
          borderRadius: node.attr('body/rx'),
        })
        const size = (cell as { getSize: () => { width: number; height: number } }).getSize()
        nodeStyle.width = size.width
        nodeStyle.height = size.height
        nodeBorderStyle.value = node.attr('body/strokeDasharray') ? 'dashed' : 'solid'
        isBold.value = node.attr('label/fontWeight') === 'bold'
      }
    }
  }
}, { deep: true })

watch(() => editorStore.selectedEdgeIds, (ids) => {
  if (ids.length > 0) {
    const graph = graphEngine.getGraph()
    if (graph) {
      const cell = graph.getCellById(ids[0])
      if (cell?.isEdge()) {
        const edge = cell as unknown as { attr: (path: string) => unknown; getLabels: () => unknown[] }
        const labels = edge.getLabels()
        let labelFontColor = '#4e5969'
        let labelFontSize = 15
        let labelFontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
        let labelBgColor = '#ffffff'
        if (labels.length > 0) {
          const label = labels[0] as Record<string, unknown>
          const attrs = (label.attrs || {}) as Record<string, unknown>
          const labelText = (attrs.labelText || {}) as Record<string, unknown>
          const bg = (attrs.bg || {}) as Record<string, unknown>
          if (labelText.fill) labelFontColor = labelText.fill as string
          if (labelText.fontSize) labelFontSize = labelText.fontSize as number
          if (labelText.fontFamily) labelFontFamily = labelText.fontFamily as string
          if (bg.fill) labelBgColor = bg.fill as string
        }
        Object.assign(edgeStyle, {
          stroke: edge.attr('line/stroke'),
          strokeWidth: edge.attr('line/strokeWidth'),
          fontColor: labelFontColor,
          fontSize: labelFontSize,
          fontFamily: labelFontFamily,
          labelBgColor,
        })
        edgeLineStyle.value = edge.attr('line/strokeDasharray') ? 'dashed' : 'solid'
      }
    }
  }
}, { deep: true })

function applyNodeStyle(): void {
  const styleToUpdate = {
    ...nodeStyle,
    fontWeight: (isBold.value ? 'bold' : 'normal') as 'bold' | 'normal',
  }
  for (const id of editorStore.selectedNodeIds) {
    graphEngine.updateNodeStyle(id, styleToUpdate)
  }
}

function applyNodeBorderStyle(): void {
  const dasharray = nodeBorderStyle.value === 'dashed' ? '5 3' : null
  nodeStyle.strokeDasharray = dasharray
  applyNodeStyle()
}

function applyEdgeStyle(): void {
  for (const id of editorStore.selectedEdgeIds) {
    graphEngine.updateEdgeStyle(id, { ...edgeStyle })
  }
}

function applyEdgeLineStyle(): void {
  edgeStyle.strokeDasharray = lineStyleToDasharray(edgeLineStyle.value)
  applyEdgeStyle()
}
</script>

<style scoped>
.style-panel {
  padding: var(--spacing-md);
}

.panel-header h3 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.close-btn {
  color: var(--text-tertiary) !important;
  padding: 4px !important;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.form-section h4 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: var(--spacing-sm);
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--border-color-light);
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.form-row label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  min-width: 60px;
}

.form-row :deep(.el-slider) {
  flex: 1;
}

.form-row :deep(.el-select),
.form-row :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
}

.form-row :deep(.full-select),
.form-row :deep(.el-select) {
  width: 100%;
}

.form-row :deep(.el-select .el-select__wrapper) {
  min-width: 0;
}

.form-row :deep(.el-select .el-select__selected-item span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  font-size: var(--font-size-sm);
  text-align: center;
  color: var(--text-tertiary);
  padding: var(--spacing-xxl) 0;
}
</style>
