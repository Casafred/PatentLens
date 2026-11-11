<template>
  <div class="graph-legend" @mouseenter="isExpanded = true" @mouseleave="isExpanded = false">
    <div class="legend-trigger">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      <span class="trigger-text">图例</span>
    </div>

    <transition name="legend-expand">
      <div v-if="isExpanded" class="legend-panel">
        <div class="legend-section">
          <div class="section-title">{{ isMethod ? '流程节点' : '节点类型' }}</div>
          <div class="legend-items">
            <div v-for="item in nodeTypes" :key="item.label" class="legend-item">
              <svg v-if="item.shape === 'diamond'" class="node-shape-sample" width="28" height="20" viewBox="0 0 28 20">
                <polygon points="14,1 27,10 14,19 1,10" :fill="item.fill" :stroke="item.stroke" stroke-width="1.5"/>
              </svg>
              <svg v-else-if="item.shape === 'hexagon'" class="node-shape-sample" width="28" height="20" viewBox="0 0 28 20">
                <polygon points="7,1 21,1 27,10 21,19 7,19 1,10" :fill="item.fill" :stroke="item.stroke" stroke-width="1.5"/>
              </svg>
              <span v-else class="node-sample" :style="{ background: item.fill, borderColor: item.stroke }"></span>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>

        <div class="legend-section">
          <div class="section-title">{{ isMethod ? '流程关系' : '关系类型' }}</div>
          <div class="legend-items">
            <div v-for="item in relationTypes" :key="item.label" class="legend-item">
              <svg class="edge-sample" width="40" height="16" viewBox="0 0 40 16">
                <line
                  x1="2" y1="8" x2="38" y2="8"
                  :stroke="item.stroke"
                  stroke-width="1.5"
                  :stroke-dasharray="item.dasharray"
                />
                <polygon
                  v-if="item.arrowType === 'solid-triangle'"
                  points="34,4 40,8 34,12"
                  :fill="item.stroke"
                />
                <polygon
                  v-if="item.arrowType === 'hollow-triangle'"
                  points="34,4 40,8 34,12"
                  :fill="'#fff'"
                  :stroke="item.stroke"
                  stroke-width="1"
                />
                <polygon
                  v-if="item.arrowType === 'diamond'"
                  points="30,8 35,4 40,8 35,12"
                  :fill="item.stroke"
                />
                <circle
                  v-if="item.arrowType === 'circle'"
                  cx="36" cy="8" r="4"
                  :fill="item.stroke"
                />
              </svg>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>

        <div class="legend-section">
          <div class="section-title">线型</div>
          <div class="legend-items">
            <div v-for="item in lineStyles" :key="item.label" class="legend-item">
              <svg class="edge-sample" width="40" height="12" viewBox="0 0 40 12">
                <line
                  x1="2" y1="6" x2="38" y2="6"
                  stroke="#86909c"
                  stroke-width="1.5"
                  :stroke-dasharray="item.dasharray"
                />
              </svg>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>

        <div class="legend-section">
          <div class="section-title">层级颜色</div>
          <div class="legend-items">
            <div v-for="item in hierarchyLevels" :key="item.label" class="legend-item">
              <span class="node-sample" :style="{ background: item.fill, borderColor: item.stroke }"></span>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>

        <div class="legend-section">
          <div class="section-title">{{ isMethod ? '子流程框' : '限定框' }}</div>
          <div class="legend-items">
            <div class="legend-item">
              <span class="group-sample" :style="isMethod ? { borderColor: '#1890FF', background: '#f0f5ff' } : {}"></span>
              <span class="legend-label">{{ isMethod ? '子流程框（蓝色虚线边框）' : '组合/限定框（橙色虚线边框）' }}</span>
            </div>
          </div>
        </div>

        <div class="legend-section">
          <div class="section-title">{{ isMethod ? '参数标签' : '属性标签' }}</div>
          <div class="legend-items">
            <div class="legend-item">
              <svg v-if="isMethod" class="edge-sample" width="40" height="28" viewBox="0 0 40 28">
                <line x1="20" y1="28" x2="20" y2="16" stroke="#13c2c2" stroke-width="1.5" stroke-dasharray="3 3"/>
                <rect x="4" y="0" width="32" height="14" rx="3" fill="#e6fffb" stroke="#13c2c2" stroke-width="1"/>
                <text x="20" y="10" text-anchor="middle" font-size="7" fill="#08979c">参数</text>
              </svg>
              <svg v-else class="edge-sample" width="40" height="28" viewBox="0 0 40 28">
                <line x1="20" y1="0" x2="20" y2="12" stroke="#13c2c2" stroke-width="1.5" stroke-dasharray="3 3"/>
                <rect x="4" y="12" width="32" height="14" rx="3" fill="#e6fffb" stroke="#13c2c2" stroke-width="1"/>
                <text x="20" y="23" text-anchor="middle" font-size="7" fill="#08979c">属性</text>
              </svg>
              <span class="legend-label">{{ isMethod ? '节点参数（上方标签）' : '节点属性（下方标签）' }}</span>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGraphStore } from '@/stores/graph'

const isExpanded = ref(false)
const graphStore = useGraphStore()

const claimType = computed(() => {
  return graphStore.activeVersion?.extractResult?.claimType || 'structure'
})

const isMethod = computed(() => claimType.value === 'method')
const isMixed = computed(() => claimType.value === 'mixed')

const structureNodeTypes = [
  { label: '部件', fill: '#e8f4fd', stroke: '#1890FF', shape: 'rect' as const },
  { label: '子系统', fill: '#fff7e6', stroke: '#fa8c16', shape: 'rect' as const },
  { label: '特征', fill: '#f6ffed', stroke: '#52c41a', shape: 'rect' as const },
]

const methodNodeTypes = [
  { label: '步骤 (step)', fill: '#e8f4fd', stroke: '#1890FF', shape: 'rect' as const },
  { label: '判断 (decision)', fill: '#f3e8ff', stroke: '#722ed1', shape: 'diamond' as const },
  { label: '条件 (condition)', fill: '#fff7e6', stroke: '#fa8c16', shape: 'hexagon' as const },
]

const mixedNodeTypes = [
  ...structureNodeTypes,
  ...methodNodeTypes,
]

const nodeTypes = computed(() =>
  isMethod.value ? methodNodeTypes
    : isMixed.value ? mixedNodeTypes
    : structureNodeTypes
)

const structureRelationTypes = [
  { label: '位置关系', stroke: '#1890FF', dasharray: '', arrowType: 'solid-triangle' },
  { label: '动作关系', stroke: '#52c41a', dasharray: '', arrowType: 'solid-triangle' },
  { label: '包含关系', stroke: '#fa8c16', dasharray: '5 5', arrowType: 'hollow-triangle' },
  { label: '逻辑关系', stroke: '#722ed1', dasharray: '2 4 2 4 5 4', arrowType: 'diamond' },
  { label: '属性关系', stroke: '#13c2c2', dasharray: '3 3', arrowType: 'none' },
]

const methodRelationTypes = [
  { label: '先后顺序', stroke: '#1890FF', dasharray: '', arrowType: 'solid-triangle' },
  { label: '是 (branch_true)', stroke: '#52c41a', dasharray: '', arrowType: 'solid-triangle' },
  { label: '否 (branch_false)', stroke: '#e63946', dasharray: '6 3', arrowType: 'solid-triangle' },
  { label: '触发关系', stroke: '#fa8c16', dasharray: '6 3 2 3', arrowType: 'hollow-triangle' },
  { label: '反馈回路', stroke: '#722ed1', dasharray: '4 4', arrowType: 'circle' },
  { label: '并行执行', stroke: '#13c2c2', dasharray: '', arrowType: 'solid-triangle' },
  { label: '参数/阈值', stroke: '#13c2c2', dasharray: '3 3', arrowType: 'none' },
]

const mixedRelationTypes = [
  ...structureRelationTypes,
  { label: '先后顺序', stroke: '#1890FF', dasharray: '', arrowType: 'solid-triangle' },
  { label: '是 (branch_true)', stroke: '#52c41a', dasharray: '', arrowType: 'solid-triangle' },
  { label: '否 (branch_false)', stroke: '#e63946', dasharray: '6 3', arrowType: 'solid-triangle' },
  { label: '触发关系', stroke: '#fa8c16', dasharray: '6 3 2 3', arrowType: 'hollow-triangle' },
  { label: '反馈回路', stroke: '#722ed1', dasharray: '4 4', arrowType: 'circle' },
  { label: '并行执行', stroke: '#13c2c2', dasharray: '', arrowType: 'solid-triangle' },
]

const relationTypes = computed(() =>
  isMethod.value ? methodRelationTypes
    : isMixed.value ? mixedRelationTypes
    : structureRelationTypes
)

const lineStyles = [
  { label: '实线', dasharray: '' },
  { label: '虚线', dasharray: '6 3' },
  { label: '点线', dasharray: '2 3' },
  { label: '点划线', dasharray: '6 3 2 3' },
]

const hierarchyLevels = [
  { label: '第一级', fill: '#ffe4e4', stroke: '#e63946' },
  { label: '第二级', fill: '#fff3e0', stroke: '#ff9800' },
  { label: '第三级', fill: '#e8f5e9', stroke: '#4caf50' },
  { label: '第四级', fill: '#ede7f6', stroke: '#7e57c2' },
  { label: '第五级', fill: '#e0f2f1', stroke: '#00897b' },
  { label: '第六级', fill: '#fce4ec', stroke: '#c62828' },
]
</script>

<style scoped>
.graph-legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 100;
}

.legend-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  transition: all 0.15s;
  user-select: none;
}

.legend-trigger:hover {
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
}

.trigger-text {
  line-height: 1;
}

.legend-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  min-width: 200px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.legend-section {
  margin-bottom: 10px;
}

.legend-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color-light);
}

.legend-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-sample {
  display: inline-block;
  width: 28px;
  height: 16px;
  border-radius: 3px;
  border-width: 1.5px;
  border-style: solid;
  flex-shrink: 0;
}

.edge-sample {
  flex-shrink: 0;
}

.node-shape-sample {
  flex-shrink: 0;
}

.legend-label {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}

.group-sample {
  display: inline-block;
  width: 28px;
  height: 16px;
  border-radius: 3px;
  border: 1.5px dashed #fa8c16;
  background: #fafafa;
  flex-shrink: 0;
}

.legend-expand-enter-active,
.legend-expand-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.legend-expand-enter-from,
.legend-expand-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
