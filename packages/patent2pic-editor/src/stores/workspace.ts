import { editorStorage } from '@/services/host/storage'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useGraphStore, migrateLegacyTabs, type CanvasFile } from '@/stores/graph'
import { useClaimStore } from '@/stores/claim'
import { useTranslationStore } from '@/stores/translation'
import { graphEngine } from '@/services/graph/engine'

/** 项目：画布文件的容器，每个项目独立持久化槽位 */
export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** 项目数据槽位（每个项目一个 editorStorage key） */
interface ProjectData {
  version: string
  files: CanvasFile[]
  activeFileId: string
  isInputCollapsed: boolean
  savedAt: number
}

const WORKSPACE_KEY = 'patent2pic-workspace'
const PROJECT_KEY_PREFIX = 'patent2pic-project-'
const LEGACY_AUTOSAVE_KEY = 'patent2pic-autosave'
const DATA_VERSION = '1.1.0'

function projectKey(id: string): string {
  return `${PROJECT_KEY_PREFIX}${id}`
}

function loadWorkspaceMeta(): { projects: Project[]; activeProjectId: string } {
  try {
    const raw = editorStorage.getItem(WORKSPACE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (Array.isArray(data.projects)) {
        return { projects: data.projects, activeProjectId: data.activeProjectId || '' }
      }
    }
  } catch (err) {
    console.error('工作区元数据读取失败:', err)
  }
  return { projects: [], activeProjectId: '' }
}

function persistWorkspaceMeta(projects: Project[], activeProjectId: string): void {
  try {
    editorStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      version: DATA_VERSION,
      projects,
      activeProjectId,
    }))
  } catch (err) {
    console.error('工作区元数据持久化失败:', err)
  }
}

function loadProjectData(id: string): ProjectData | null {
  try {
    const raw = editorStorage.getItem(projectKey(id))
    if (!raw) return null
    return JSON.parse(raw) as ProjectData
  } catch (err) {
    console.error(`项目 ${id} 数据读取失败:`, err)
    return null
  }
}

function persistProjectData(id: string, data: ProjectData): void {
  try {
    editorStorage.setItem(projectKey(id), JSON.stringify(data))
  } catch (err) {
    console.error(`项目 ${id} 数据持久化失败:`, err)
  }
}

function removeProjectData(id: string): void {
  editorStorage.removeItem(projectKey(id))
}

/** 旧版单槽位自动保存数据（tabs 或早期 files 格式）迁移为项目数据 */
function migrateLegacyAutosave(): ProjectData | null {
  try {
    const raw = editorStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)

    let files: CanvasFile[] | null = null
    if (Array.isArray(data.files) && data.files.length > 0) {
      files = data.files
    } else if (Array.isArray(data.tabs) && data.tabs.length > 0) {
      files = migrateLegacyTabs(data.tabs)
    }
    if (!files) return null

    return {
      version: DATA_VERSION,
      files,
      activeFileId: data.activeFileId && files.some(f => f.id === data.activeFileId)
        ? data.activeFileId
        : files[0].id,
      isInputCollapsed: typeof data.isInputCollapsed === 'boolean' ? data.isInputCollapsed : false,
      savedAt: Date.now(),
    }
  } catch {
    return null
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const graphStore = useGraphStore()
  const claimStore = useClaimStore()
  const translationStore = useTranslationStore()

  const meta = loadWorkspaceMeta()
  const projects = ref<Project[]>(meta.projects)
  const activeProjectId = ref<string>(meta.activeProjectId)

  const activeProject = computed<Project | null>(() =>
    projects.value.find(p => p.id === activeProjectId.value) || null,
  )

  function persistMeta(): void {
    persistWorkspaceMeta(projects.value, activeProjectId.value)
  }

  /** 把 graphStore 当前状态持久化到活动项目槽位（含当前画布快照） */
  function saveActiveProject(): void {
    const id = activeProjectId.value
    if (!id) return

    // 活动文件的当前画布（含手动编辑）写回其活动版本
    const graph = graphEngine.getGraph()
    const activeFile = graphStore.activeFile
    if (graph && activeFile?.activeVersionId) {
      graphStore.updateVersionSerializedGraph(
        activeFile.id,
        activeFile.activeVersionId,
        graphEngine.toJSON(),
      )
    }

    persistProjectData(id, {
      version: DATA_VERSION,
      files: graphStore.files.map(file =>
        file.id === activeFile?.id
          ? { ...file, translations: translationStore.toJSON() }
          : file,
      ),
      activeFileId: graphStore.activeFileId,
      isInputCollapsed: claimStore.isInputCollapsed,
      savedAt: Date.now(),
    })

    const project = projects.value.find(p => p.id === id)
    if (project) {
      project.updatedAt = Date.now()
      persistMeta()
    }
  }

  /** 把项目数据装入 graphStore（切换项目 / 启动恢复 / 导入项目） */
  function applyProjectData(data: ProjectData | null): void {
    const files = data?.files ?? []
    const targetId = data?.activeFileId && files.some(f => f.id === data.activeFileId)
      ? data.activeFileId
      : files[0]?.id ?? ''

    if (targetId) {
      graphStore.setFiles(files)
      // 先清空再激活：强制触发 activateFile 的翻译切换与 renderKey 渲染
      graphStore.setActiveFileId('')
      graphStore.activateFile(targetId)
    } else {
      // 目标项目为空：复用启动时创建的空白文件，避免重复新建（否则默认名会跳号）
      const current = graphStore.activeFile
      const reusable = current && !current.rawText.trim() && current.versions.length === 0
        ? current
        : null
      graphStore.setFiles(reusable ? [reusable] : [])
      graphStore.setActiveFileId('')
      if (reusable) {
        graphStore.activateFile(reusable.id)
      } else {
        graphStore.ensureDefaultFile()
      }
    }

    if (typeof data?.isInputCollapsed === 'boolean') {
      if (data.isInputCollapsed) {
        claimStore.collapseInput()
      } else {
        claimStore.expandInput()
      }
    }
  }

  function createProject(name?: string, activate = true): Project {
    // 切换前先保存当前项目
    if (activate) {
      saveActiveProject()
    }
    const project: Project = {
      id: `project-${Date.now()}-${projects.value.length + 1}`,
      name: name || `项目 ${projects.value.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    projects.value.push(project)
    if (activate) {
      activeProjectId.value = project.id
      applyProjectData(null)
    }
    persistMeta()
    return project
  }

  function switchProject(id: string): void {
    if (id === activeProjectId.value) return
    if (!projects.value.some(p => p.id === id)) return
    saveActiveProject()
    activeProjectId.value = id
    persistMeta()
    applyProjectData(loadProjectData(id))
  }

  function removeProject(id: string): void {
    const index = projects.value.findIndex(p => p.id === id)
    if (index === -1) return

    projects.value.splice(index, 1)
    removeProjectData(id)

    if (activeProjectId.value === id) {
      const next = projects.value[0]
      if (next) {
        activeProjectId.value = next.id
        persistMeta()
        applyProjectData(loadProjectData(next.id))
      } else {
        // 最后一个项目被删除：重建默认项目
        const project: Project = {
          id: `project-${Date.now()}-1`,
          name: '默认项目',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        projects.value.push(project)
        activeProjectId.value = project.id
        persistMeta()
        applyProjectData(null)
      }
    } else {
      persistMeta()
    }
  }

  function renameProject(id: string, name: string): void {
    const project = projects.value.find(p => p.id === id)
    if (project && name.trim()) {
      project.name = name.trim()
      project.updatedAt = Date.now()
      persistMeta()
    }
  }

  /** 读取指定项目的画布文件（活动项目返回内存实时数据，其他项目读磁盘槽位） */
  function getProjectFiles(projectId: string): CanvasFile[] | null {
    if (projectId === activeProjectId.value) return graphStore.files
    return loadProjectData(projectId)?.files ?? null
  }

  /** 回写指定项目的画布文件（活动项目写内存，其他项目直接改磁盘槽位，不切换项目） */
  function commitProjectFiles(projectId: string, files: CanvasFile[]): boolean {
    if (projectId === activeProjectId.value) {
      graphStore.setFiles([...files])
      return true
    }
    const data = loadProjectData(projectId)
    if (!data) return false
    persistProjectData(projectId, { ...data, files: [...files], savedAt: Date.now() })
    return true
  }

  /** 删除项目前读取其完整数据（供回收站留存） */
  function readProjectSnapshot(id: string): ProjectData | null {
    if (id === activeProjectId.value) {
      saveActiveProject()
    }
    return loadProjectData(id)
  }

  /** 导入项目（.p2p 项目文件）：创建新项目并切换过去 */
  function importProject(
    name: string,
    files: CanvasFile[],
    activeFileId: string,
    isInputCollapsed = false,
  ): Project {
    saveActiveProject()
    const project: Project = {
      id: `project-${Date.now()}-${projects.value.length + 1}`,
      name: name || `导入项目`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    projects.value.push(project)
    activeProjectId.value = project.id

    const data: ProjectData = {
      version: DATA_VERSION,
      files,
      activeFileId: activeFileId && files.some(f => f.id === activeFileId)
        ? activeFileId
        : files[0]?.id ?? '',
      isInputCollapsed,
      savedAt: Date.now(),
    }
    persistProjectData(project.id, data)
    persistMeta()
    applyProjectData(data)
    return project
  }

  /**
   * 应用启动初始化：恢复活动项目数据到 graphStore。
   * 首次启动（无项目）时迁移旧版 autosave 或创建默认项目。
   */
  function initWorkspace(): boolean {
    if (projects.value.length === 0) {
      const migrated = migrateLegacyAutosave()
      const project: Project = {
        id: `project-${Date.now()}-1`,
        name: '默认项目',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      projects.value.push(project)
      activeProjectId.value = project.id
      persistMeta()
      if (migrated) {
        persistProjectData(project.id, migrated)
        applyProjectData(migrated)
      } else {
        applyProjectData(null)
      }
      return !!migrated
    }

    if (!projects.value.some(p => p.id === activeProjectId.value)) {
      activeProjectId.value = projects.value[0].id
      persistMeta()
    }
    applyProjectData(loadProjectData(activeProjectId.value))
    return true
  }

  return {
    projects,
    activeProjectId,
    activeProject,
    createProject,
    switchProject,
    removeProject,
    renameProject,
    getProjectFiles,
    commitProjectFiles,
    readProjectSnapshot,
    importProject,
    saveActiveProject,
    initWorkspace,
  }
})
