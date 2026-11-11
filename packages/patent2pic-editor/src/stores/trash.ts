import { editorStorage } from '@/services/host/storage'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useGraphStore, type CanvasFile, type CanvasVersion } from '@/stores/graph'
import { useWorkspaceStore } from '@/stores/workspace'

export type TrashKind = 'project' | 'file' | 'version'

/** 删除项目时留存的完整快照 */
export interface TrashProjectPayload {
  name: string
  files: CanvasFile[]
  activeFileId: string
  isInputCollapsed: boolean
}

/** 删除画布文件时留存的快照及其所属项目 */
export interface TrashFilePayload {
  projectId: string
  file: CanvasFile
}

/** 删除版本时留存所属文件信息 */
export interface TrashVersionPayload {
  projectId: string
  fileId: string
  fileName: string
  version: CanvasVersion
}

export type TrashPayload = TrashProjectPayload | TrashFilePayload | TrashVersionPayload

export interface TrashItem {
  id: string
  kind: TrashKind
  label: string
  deletedAt: number
  payload: TrashPayload
}

const TRASH_KEY = 'patent2pic-trash'
/** 回收站上限：超出后丢弃最早的条目 */
const TRASH_MAX = 50

function loadTrash(): TrashItem[] {
  try {
    const raw = editorStorage.getItem(TRASH_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data.items) ? data.items : []
  } catch {
    return []
  }
}

function persistTrash(items: TrashItem[]): void {
  try {
    editorStorage.setItem(TRASH_KEY, JSON.stringify({ version: '1.0.0', items }))
  } catch (err) {
    console.error('回收站持久化失败:', err)
  }
}

function clone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export const useTrashStore = defineStore('trash', () => {
  const graphStore = useGraphStore()
  const workspaceStore = useWorkspaceStore()

  const items = ref<TrashItem[]>(loadTrash())

  const count = computed(() => items.value.length)

  const sortedItems = computed(() => [...items.value].sort((a, b) => b.deletedAt - a.deletedAt))

  function persist(): void {
    persistTrash(items.value)
  }

  /** 入站：留存删除内容（超出上限丢弃最早） */
  function push(kind: TrashKind, label: string, payload: TrashPayload): void {
    items.value.push({
      id: `trash-${Date.now()}-${items.value.length + 1}`,
      kind,
      label,
      deletedAt: Date.now(),
      payload: clone(payload),
    })
    if (items.value.length > TRASH_MAX) {
      items.value.splice(0, items.value.length - TRASH_MAX)
    }
    persist()
  }

  /** 彻底删除单条（不可恢复） */
  function remove(id: string): void {
    const index = items.value.findIndex(i => i.id === id)
    if (index === -1) return
    items.value.splice(index, 1)
    persist()
  }

  /** 清空回收站（不可恢复） */
  function clear(): void {
    items.value = []
    persist()
  }

  /**
   * 恢复条目：
   * - project：作为新项目导入并切换过去
   * - file：还原到原项目（原项目已不存在则还原到当前项目）
   * - version：还原到原文件并激活
   */
  function restore(id: string): { ok: boolean; message: string } {
    const item = items.value.find(i => i.id === id)
    if (!item) return { ok: false, message: '条目不存在' }

    if (item.kind === 'project') {
      const payload = item.payload as TrashProjectPayload
      workspaceStore.importProject(
        `${payload.name}（已恢复）`,
        payload.files,
        payload.activeFileId,
        payload.isInputCollapsed,
      )
      remove(id)
      return { ok: true, message: `已恢复项目「${payload.name}」` }
    }

    if (item.kind === 'file') {
      const payload = item.payload as TrashFilePayload
      const projectExists = workspaceStore.projects.some(p => p.id === payload.projectId)
      const targetProjectId = projectExists ? payload.projectId : workspaceStore.activeProjectId
      const files = workspaceStore.getProjectFiles(targetProjectId)
      if (!files) return { ok: false, message: '目标项目已不存在，无法恢复' }
      if (files.some(f => f.id === payload.file.id)) {
        return { ok: false, message: '该画布文件已存在' }
      }

      workspaceStore.commitProjectFiles(targetProjectId, [...files, clone(payload.file)])
      if (targetProjectId === workspaceStore.activeProjectId) {
        graphStore.activateFile(payload.file.id)
      }
      remove(id)
      return {
        ok: true,
        message: projectExists ? '已恢复画布文件' : '原项目已删除，已恢复到当前项目',
      }
    }

    const payload = item.payload as TrashVersionPayload
    const projectExists = workspaceStore.projects.some(p => p.id === payload.projectId)
    const targetProjectId = projectExists ? payload.projectId : workspaceStore.activeProjectId
    const files = workspaceStore.getProjectFiles(targetProjectId)
    if (!files) return { ok: false, message: '目标项目已不存在，无法恢复' }

    const file = files.find(f => f.id === payload.fileId)
    if (!file) return { ok: false, message: '原画布文件已不存在，无法恢复版本' }
    if (file.versions.some(v => v.id === payload.version.id)) {
      return { ok: false, message: '该版本已存在' }
    }

    const restored = clone(payload.version)
    file.versions.push(restored)
    workspaceStore.commitProjectFiles(targetProjectId, files)
    if (targetProjectId === workspaceStore.activeProjectId) {
      graphStore.activateFile(file.id)
      graphStore.setActiveVersion(file.id, restored.id)
    }
    remove(id)
    return { ok: true, message: `已恢复版本「${payload.version.label}」` }
  }

  return {
    items,
    count,
    sortedItems,
    push,
    remove,
    clear,
    restore,
  }
})
