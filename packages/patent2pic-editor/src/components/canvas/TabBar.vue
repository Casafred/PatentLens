<template>
  <div class="tab-bar" v-if="graphStore.files.length > 0">
    <div class="tab-bar-scroll">
      <div
        v-for="file in graphStore.files"
        :key="file.id"
        :class="['tab-item', { active: file.id === graphStore.activeFileId }]"
        @click="handleFileClick(file.id)"
      >
        <span class="tab-name" :title="file.name">{{ file.name }}</span>
        <span v-if="file.versions.length > 1" class="tab-versions">V{{ file.versions.length }}</span>
        <span
          class="tab-close"
          @click.stop="handleFileClose(file.id)"
        >×</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGraphStore } from '@/stores/graph'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTrashStore } from '@/stores/trash'
import { ElMessageBox } from 'element-plus'
import { useProjectFile } from '@/composables/useProjectFile'
import { graphEngine } from '@/services/graph/engine'

const graphStore = useGraphStore()
const workspaceStore = useWorkspaceStore()
const trash = useTrashStore()
const { saveProject } = useProjectFile()

function handleFileClick(id: string): void {
  graphStore.activateFile(id)
}

async function handleFileClose(id: string): Promise<void> {
  const file = graphStore.files.find(f => f.id === id)
  if (!file) return

  // 最后一个文件：清空到空状态而非关闭，保证输入始终有归属文件
  if (graphStore.files.length <= 1) {
    const graph = graphEngine.getGraph()
    if (graph) {
      graph.clearCells()
    }
    graphStore.clearActiveFileGraph()
    return
  }

  try {
    await ElMessageBox.confirm(
      '关闭画布文件前是否保存当前项目？未保存的修改将会丢失。',
      '保存提醒',
      {
        confirmButtonText: '保存并关闭',
        cancelButtonText: '直接关闭',
        distinguishCancelAndClose: true,
        type: 'warning',
      },
    )
    await saveProject()
    closeFileToTrash(id)
  } catch (action: unknown) {
    if (action === 'cancel') {
      closeFileToTrash(id)
    }
  }
}

/** 关闭画布文件统一走回收站，误关可恢复 */
function closeFileToTrash(id: string): void {
  const projectId = workspaceStore.activeProjectId
  const removed = graphStore.removeFile(id)
  if (removed) {
    trash.push('file', removed.name, { projectId, file: removed })
  }
}
</script>

<style scoped>
.tab-bar {
  display: flex;
  align-items: center;
  height: 36px;
  background: var(--bg-tertiary, #e8eaed);
  border-bottom: 1px solid var(--border-color);
  overflow: hidden;
}

.tab-bar-scroll {
  display: flex;
  align-items: flex-end;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tab-bar-scroll::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  margin: 6px 1px 0;
  background: var(--bg-secondary, #f0f0f0);
  border: 1px solid var(--border-color);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: background 0.15s;
  max-width: 180px;
}

.tab-item:hover {
  background: var(--bg-primary, #fff);
}

.tab-item.active {
  background: var(--bg-primary, #fff);
  border-color: var(--border-color);
  height: 32px;
  margin-top: 4px;
}

.tab-name {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.tab-versions {
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 6px;
  background: var(--color-primary, #1890ff);
  color: #fff;
  flex-shrink: 0;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-tertiary);
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.15s;
}

.tab-close:hover {
  background: var(--border-color);
  color: var(--text-primary);
}
</style>
