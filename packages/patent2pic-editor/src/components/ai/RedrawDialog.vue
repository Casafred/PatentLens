<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="handleVisibleChange"
    title="AI 重构"
    width="560px"
    :close-on-click-modal="false"
    :close-on-press-escape="!isRunning"
    :show-close="!isRunning"
    destroy-on-close
  >
    <div class="redraw-dialog">
      <!-- 基准信息 -->
      <div class="base-info">
        <div class="base-summary">
          <span v-if="stats">当前图：{{ stats.nodeCount }} 节点 / {{ stats.edgeCount }} 关系 / {{ stats.groupCount }} 分组</span>
          <span v-else>当前画布无结构数据</span>
        </div>
        <el-radio-group v-model="base" size="small" :disabled="isRunning">
          <el-radio-button value="current">当前画布（含手动编辑）</el-radio-button>
          <el-radio-button value="original">原始抽取结果</el-radio-button>
        </el-radio-group>
        <el-alert
          v-if="stats && stats.nodeCount > 200"
          title="图规模较大，Token 消耗会明显增加"
          type="warning"
          :closable="false"
          show-icon
        />
      </div>

      <!-- 重构要求 -->
      <div class="form-section">
        <label class="section-label">重构要求（必填）</label>
        <el-input
          v-model="instructions"
          type="textarea"
          :rows="4"
          placeholder="用自然语言描述要做的修改，如：把「驱动电机」改名为「主驱动电机」；在「主驱动电机」与「传动轴」之间增加「减速器」并建立包含关系"
          maxlength="2000"
          show-word-limit
          :disabled="isRunning"
        />
        <div class="quick-commands">
          <el-tag
            v-for="cmd in QUICK_COMMANDS"
            :key="cmd"
            size="small"
            type="info"
            effect="plain"
            class="quick-cmd"
            @click="applyQuickCommand(cmd)"
          >
            {{ cmd }}
          </el-tag>
        </div>
      </div>

      <!-- 附加选项 -->
      <div class="options-row">
        <el-checkbox v-model="includeClaimContext" :disabled="isRunning">引用权利要求原文作为参考</el-checkbox>
        <el-checkbox v-model="keepFrames" :disabled="isRunning">保留原图动画帧</el-checkbox>
      </div>

      <!-- 进行中：流式预览 -->
      <div v-if="isRunning" class="stream-preview">
        <div class="stream-header">
          <span>AI 正在重构...（{{ streamContent.length }} 字符）</span>
          <el-button size="small" type="danger" @click="handleAbort">终止</el-button>
        </div>
        <pre class="stream-content">{{ streamContent || '等待响应...' }}</pre>
      </div>

      <!-- 错误提示 -->
      <el-alert
        v-if="error && !isRunning"
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />
    </div>

    <template #footer>
      <el-button :disabled="isRunning" @click="handleVisibleChange(false)">取消</el-button>
      <el-button
        type="primary"
        :loading="isRunning"
        :disabled="!instructions.trim() || !canStart"
        @click="handleStart"
      >
        {{ isRunning ? '重构中...' : '开始重构' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useGraphStore } from '@/stores/graph'
import { useAIStore } from '@/stores/ai'
import { useAIRedraw } from '@/composables/useAIRedraw'
import { x6ToExtractResult } from '@/services/graph/x6-to-extract'
import { graphEngine } from '@/services/graph/engine'
import type { RedrawBase } from '@/types/redraw'

const props = defineProps<{
  visible: boolean
  sourceFileId: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'completed': [fileId: string]
}>()

const graphStore = useGraphStore()
const aiStore = useAIStore()
const { redraw, abort, isRunning, streamContent, error } = useAIRedraw()

const QUICK_COMMANDS = [
  '将…改名为…',
  '把…与…建立…关系',
  '将…提升为一级部件',
  '合并含义重复的节点',
  '按功能重新划分层级',
]

const base = ref<RedrawBase>('current')
const instructions = ref('')
const includeClaimContext = ref(true)
const keepFrames = ref(true)
const stats = ref<{ nodeCount: number; edgeCount: number; groupCount: number } | null>(null)

const canStart = computed(() => !!aiStore.activeApiKey)

watch(() => props.visible, (val) => {
  if (val) {
    instructions.value = ''
    error.value = null
    // 打开时统计当前画布结构（含手动编辑）
    const converted = x6ToExtractResult(graphEngine.toJSON())
    stats.value = converted.nodes.length > 0
      ? { nodeCount: converted.nodes.length, edgeCount: converted.edges.length, groupCount: converted.groups.length }
      : null
  }
})

function applyQuickCommand(cmd: string): void {
  if (isRunning.value) return
  instructions.value = instructions.value
    ? `${instructions.value}\n${cmd}`
    : cmd
}

function handleVisibleChange(value: boolean): void {
  if (isRunning.value && !value) return
  emit('update:visible', value)
}

async function handleStart(): Promise<void> {
  if (!instructions.value.trim()) return
  const result = await redraw(props.sourceFileId, instructions.value.trim(), {
    base: base.value,
    includeClaimContext: includeClaimContext.value,
    keepFrames: keepFrames.value,
  })

  if (result) {
    emit('update:visible', false)
    emit('completed', graphStore.activeFileId)
    if (result.changes && result.changes.length > 0) {
      ElMessage({
        type: 'success',
        message: `重构完成：${result.changes.slice(0, 3).join('；')}`,
        duration: 6000,
      })
    } else {
      ElMessage.success('重构完成，已生成新版本')
    }
  }
}

function handleAbort(): void {
  abort()
}
</script>

<style scoped>
.redraw-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.base-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.base-summary {
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary);
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  color: var(--text-primary);
}

.quick-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-cmd {
  cursor: pointer;
}

.quick-cmd:hover {
  opacity: 0.8;
}

.options-row {
  display: flex;
  gap: 16px;
}

.stream-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stream-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary);
}

.stream-content {
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
  padding: 8px;
  background: var(--bg-tertiary, #f5f7fa);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
