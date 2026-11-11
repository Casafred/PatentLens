<template>
  <transition name="task-center">
    <div v-if="parallel.taskPanelVisible.value" class="task-center">
      <div class="tc-header">
        <span class="tc-title">任务中心</span>
        <span class="tc-summary">
          {{ parallel.completedCount.value }}/{{ parallel.totalCount.value }}
        </span>
        <div class="tc-header-actions">
          <el-button
            v-if="parallel.hasFailed.value && !parallel.isRunning.value"
            size="small"
            text
            type="primary"
            @click="parallel.retryFailed()"
          >重试全部失败</el-button>
          <el-button
            v-if="parallel.isRunning.value"
            size="small"
            text
            type="danger"
            @click="parallel.abortAll()"
          >终止全部</el-button>
          <el-icon class="tc-close" title="收起" @click="parallel.closeTaskPanel()"><Close /></el-icon>
        </div>
      </div>

      <el-progress
        v-if="parallel.totalCount.value > 0"
        :percentage="overallProgress"
        :stroke-width="3"
        :show-text="false"
        class="tc-overall"
      />

      <div class="tc-body">
        <div
          v-for="task in parallel.tasks.value"
          :key="task.claimId"
          :class="['tc-item', task.status]"
        >
          <span class="tc-index">{{ task.claimIndex }}</span>

          <div class="tc-main">
            <div class="tc-preview" :title="task.claimPreview">{{ task.claimPreview }}</div>
            <el-progress
              :percentage="Math.round(task.progress)"
              :stroke-width="4"
              :show-text="false"
              :status="task.status === 'success' ? 'success' : task.status === 'error' ? 'exception' : undefined"
            />
            <div class="tc-meta">
              <span :class="['tc-status', task.status]">{{ statusText(task) }}</span>
              <span v-if="task.durationMs" class="tc-duration">{{ (task.durationMs / 1000).toFixed(1) }}s</span>
              <span v-if="task.errorMessage" class="tc-error" :title="task.errorMessage">
                {{ task.errorMessage }}
              </span>
            </div>
          </div>

          <div class="tc-item-actions">
            <el-button
              v-if="task.status === 'error' || task.status === 'aborted'"
              size="small"
              text
              type="primary"
              :disabled="parallel.isRunning.value || !aiStore.activeApiKey"
              @click="parallel.retryTask(task.claimId)"
            >重试</el-button>
            <el-button
              v-else-if="task.status === 'success' && task.fileId"
              size="small"
              text
              @click="graphStore.activateFile(task.fileId)"
            >查看</el-button>
          </div>
        </div>

        <div v-if="parallel.tasks.value.length === 0" class="tc-empty">
          暂无分析任务
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useAIStore } from '@/stores/ai'
import { useGraphStore } from '@/stores/graph'
import { useParallelExtract, type ParallelTask } from '@/composables/useParallelExtract'

const aiStore = useAIStore()
const graphStore = useGraphStore()
const parallel = useParallelExtract()

const overallProgress = computed(() => {
  const total = parallel.totalCount.value
  if (total === 0) return 0
  return Math.round((parallel.completedCount.value / total) * 100)
})

function statusText(task: ParallelTask): string {
  switch (task.status) {
    case 'pending': return '等待中'
    case 'running': return `处理中 ${Math.round(task.progress)}%`
    case 'success': return '完成'
    case 'aborted': return '已终止'
    default: return '失败'
  }
}
</script>

<style scoped>
.task-center {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 380px;
  max-height: 60%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  overflow: hidden;
  z-index: 20;
}

.tc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
}

.tc-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.tc-summary {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary, #e8eaed);
  color: var(--text-secondary);
}

.tc-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tc-close {
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 14px;
}

.tc-close:hover {
  color: var(--text-primary);
}

.tc-overall {
  padding: 0 12px;
  margin-top: 6px;
}

.tc-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 12px;
}

.tc-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary, #f5f6f7);
}

.tc-item.success {
  border-color: rgba(103, 194, 58, 0.4);
}

.tc-item.error {
  border-color: rgba(245, 108, 108, 0.4);
}

.tc-index {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary, #1890ff);
  color: #fff;
  font-size: 11px;
}

.tc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tc-preview {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  min-height: 14px;
}

.tc-status.success {
  color: #67c23a;
}

.tc-status.error {
  color: #f56c6c;
}

.tc-error {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #f56c6c;
}

.tc-item-actions {
  flex-shrink: 0;
}

.tc-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

.task-center-enter-active,
.task-center-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.task-center-enter-from,
.task-center-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
