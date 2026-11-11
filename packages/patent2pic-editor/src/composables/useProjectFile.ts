import { graphEngine } from '@/services/graph/engine'
import { useGraphStore, migrateLegacyTabs, type CanvasFile } from '@/stores/graph'
import { useClaimStore } from '@/stores/claim'
import { useTranslationStore } from '@/stores/translation'
import { useWorkspaceStore } from '@/stores/workspace'
import { parseClaims } from '@/services/claim/parser'
import { nextTick } from 'vue'
import { waitForCanvasRender } from '@/services/graph/render-state'


export function useProjectFile() {
  const graphStore = useGraphStore()
  const claimStore = useClaimStore()
  const translationStore = useTranslationStore()
  const workspaceStore = useWorkspaceStore()

  async function saveProject(): Promise<void> {
    await nextTick()
    await waitForCanvasRender()
    const graph = graphEngine.getGraph()
    if (!graph) return

    const activeFile = graphStore.activeFile
    // 活动文件的当前画布（含手动编辑）写回其活动版本
    if (activeFile && activeFile.activeVersionId) {
      graphStore.updateVersionSerializedGraph(
        activeFile.id,
        activeFile.activeVersionId,
        graphEngine.toJSON(),
      )
    }

    const projectName = workspaceStore.activeProject?.name ?? '未命名项目'
    const projectData = {
      version: '1.2.0',
      projectName,
      isInputCollapsed: claimStore.isInputCollapsed,
      files: graphStore.files.map(file =>
        file.id === activeFile?.id
          ? { ...file, translations: translationStore.toJSON() }
          : file,
      ),
      activeFileId: graphStore.activeFileId,
    }

    const content = JSON.stringify(projectData, null, 2)
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
    const filename = `patent2pic-${safeName}.p2p`

    saveViaBrowser(content, filename)
  }

  async function loadProject(): Promise<boolean> {
    return loadViaBrowser()
  }


  function saveViaBrowser(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }


  function loadViaBrowser(): Promise<boolean> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.p2p,.json'
      input.oncancel = () => resolve(false)
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(false)
          return
        }
        const text = await file.text()
        resolve(applyProjectData(text))
      }
      input.click()
    })
  }

  /** 导入项目文件：作为新项目导入并切换（不覆盖当前项目） */
  function applyProjectData(text: string): boolean {
    try {
      const data = JSON.parse(text)
      const isCollapsed = typeof data.isInputCollapsed === 'boolean' ? data.isInputCollapsed : false

      // 新模型：files 数组；旧模型：tabs 数组（迁移为单版本文件）
      let files: CanvasFile[] | null = null
      if (Array.isArray(data.files) && data.files.length > 0) {
        files = data.files
      } else if (Array.isArray(data.tabs) && data.tabs.length > 0) {
        files = migrateLegacyTabs(data.tabs)
      }

      if (files) {
        workspaceStore.importProject(
          data.projectName || '导入项目',
          files,
          data.activeFileId || data.activeTabId || '',
          isCollapsed,
        )
        return true
      }

      // 旧版单图格式（graphJSON / graph）：包装为单文件项目导入
      const graphJSON = data.graphJSON || data.graph
      const rawText = typeof data.claimText === 'string' ? data.claimText : ''
      const claims = Array.isArray(data.claims) && data.claims.length > 0
        ? data.claims
        : (rawText ? parseClaims(rawText) : [])
      const activeClaimId = data.activeClaimId
        && claims.some((c: { id: string }) => c.id === data.activeClaimId)
        ? data.activeClaimId
        : claims[0]?.id ?? null

      if (graphJSON || rawText) {
        const versionId = `version-imported-${Date.now()}`
        const file: CanvasFile = {
          id: `file-imported-${Date.now()}`,
          name: data.projectName || '导入画布',
          isChinese: false,
          claimId: null,
          rawText,
          claims,
          activeClaimId,
          translations: data.translations && typeof data.translations === 'object' ? data.translations : null,
          versions: graphJSON
            ? [{
                id: versionId,
                label: '导入',
                extractResult: null,
                serializedGraph: graphJSON,
                createdAt: Date.now(),
              }]
            : [],
          activeVersionId: graphJSON ? versionId : null,
        }
        workspaceStore.importProject(data.projectName || '导入项目', [file], file.id, isCollapsed)
        return true
      }

      return false
    } catch (err) {
      console.error('项目文件解析失败:', err)
      return false
    }
  }

  return {
    saveProject,
    loadProject,
  }
}
