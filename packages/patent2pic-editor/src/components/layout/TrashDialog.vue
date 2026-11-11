<template>
  <el-dialog
    :model-value="visible"
    title="回收站"
    width="600px"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="trash-toolbar">
      <span class="trash-hint">保留最近 {{ trash.count }} 项（上限 50），恢复后从回收站移除</span>
      <el-button
        size="small"
        type="danger"
        text
        :disabled="trash.count === 0"
        @click="handleClear"
      >清空回收站</el-button>
    </div>

    <div class="trash-list">
      <div v-for="item in trash.sortedItems" :key="item.id" class="trash-item">
        <span :class="['trash-kind', item.kind]">{{ kindText(item.kind) }}</span>
        <div class="trash-main">
          <div class="trash-label" :title="item.label">{{ item.label }}</div>
          <div class="trash-time">{{ formatTime(item.deletedAt) }}</div>
        </div>
        <el-button size="small" text type="primary" @click="handleRestore(item.id)">恢复</el-button>
        <el-button size="small" text type="danger" @click="handleRemove(item.id)">彻底删除</el-button>
      </div>

      <div v-if="trash.count === 0" class="trash-empty">
        回收站为空。删除项目 / 画布文件 / 版本后会暂存到这里。
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTrashStore, type TrashKind } from '@/stores/trash'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const trash = useTrashStore()

function kindText(kind: TrashKind): string {
  switch (kind) {
    case 'project': return '项目'
    case 'file': return '画布'
    default: return '版本'
  }
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function handleRestore(id: string): void {
  const result = trash.restore(id)
  if (result.ok) {
    ElMessage.success(result.message)
  } else {
    ElMessage.error(result.message)
  }
}

async function handleRemove(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('彻底删除后不可恢复，是否继续？', '彻底删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    trash.remove(id)
  } catch {
    // 用户取消
  }
}

async function handleClear(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空后回收站内容不可恢复，是否继续？', '清空回收站', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
    trash.clear()
    ElMessage.success('回收站已清空')
  } catch {
    // 用户取消
  }
}
</script>

<style scoped>
.trash-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.trash-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.trash-list {
  max-height: 400px;
  overflow-y: auto;
}

.trash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-bottom: 6px;
}

.trash-kind {
  flex-shrink: 0;
  width: 40px;
  text-align: center;
  font-size: 11px;
  padding: 2px 0;
  border-radius: 4px;
  background: var(--bg-tertiary, #e8eaed);
  color: var(--text-secondary);
}

.trash-kind.project {
  background: rgba(24, 144, 255, 0.14);
  color: #1890ff;
}

.trash-kind.file {
  background: rgba(250, 140, 22, 0.14);
  color: #fa8c16;
}

.trash-main {
  flex: 1;
  min-width: 0;
}

.trash-label {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-time {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.trash-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
