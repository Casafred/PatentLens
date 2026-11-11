import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NodeData, EdgeData, GroupData, GraphJSON } from '@/types/graph'
import type { ExtractResult } from '@/types/ai'
import type { Claim } from '@/types/claim'
import type { ClaimTranslation } from '@/types/translation'
import { useTranslationStore } from '@/stores/translation'

/** 画布快照：手动编辑会覆盖当前版本，快照提供自动回退点 */
export interface CanvasSnapshot {
  id: string
  at: number
  serializedGraph: Record<string, unknown>
}

/**
 * 画布版本：一次 AI 分析或一次 AI 重构的产物。
 * 版本是画布渲染的唯一数据源（serializedGraph 优先，extractResult 兜底）。
 */
export interface CanvasVersion {
  id: string
  /** 展示名：初始分析 / 重新分析 / 重构V{n} */
  label: string
  extractResult: ExtractResult | null
  serializedGraph: Record<string, unknown> | null
  createdAt: number
  /** 版本链：来源版本 ID（AI 重构产生） */
  sourceVersionId?: string
  /** 本次 AI 重构的指令 */
  redrawInstructions?: string
  /** 自动快照（最近若干次画布状态，用于手动编辑误操作后回退） */
  snapshots?: CanvasSnapshot[]
}

/** 文件级翻译快照：claimId → 翻译数据（与 translation store 的 toJSON/fromJSON 格式一致） */
export type FileTranslations = Record<string, ClaimTranslation>

/**
 * 画布文件：一个文件 = 一份权利要求输入（rawText/claims/translations）+ 版本列表。
 * 输入状态归属文件，切换文件即切换全部上下文。
 */
export interface CanvasFile {
  id: string
  name: string
  isChinese: boolean
  /** 本文件分析的权利要求 ID */
  claimId: string | null
  rawText: string
  claims: Claim[]
  activeClaimId: string | null
  translations: FileTranslations | null
  versions: CanvasVersion[]
  activeVersionId: string | null
}

/** 旧版 TabData（editorStorage 自动保存 / .p2p 项目文件中的历史格式），仅用于迁移 */
export interface LegacyTabData {
  id: string
  name: string
  extractResult: ExtractResult | null
  serializedGraph: Record<string, unknown> | null
  isChinese: boolean
  claimId: string | null
  rawText: string
  claims: Claim[]
  activeClaimId: string | null
  translations: FileTranslations | null
  sourceTabId?: string
  redrawInstructions?: string
  redrawVersion?: number
}

function deepClone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

let fileCounter = 0
let versionCounter = 0

/** 每个版本保留的快照上限与最小快照间隔（避免频繁写盘与存储膨胀） */
const SNAPSHOT_MAX = 5
const SNAPSHOT_MIN_INTERVAL = 60_000

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++versionCounter}`
}

/** 旧 TabData 列表 → CanvasFile 列表（每个旧 Tab 迁移为单版本文件） */
export function migrateLegacyTabs(tabs: LegacyTabData[]): CanvasFile[] {
  return tabs.map(tab => ({
    id: tab.id,
    name: tab.name,
    isChinese: tab.isChinese,
    claimId: tab.claimId,
    rawText: tab.rawText,
    claims: tab.claims ? deepClone(tab.claims) : [],
    activeClaimId: tab.activeClaimId,
    translations: tab.translations ? deepClone(tab.translations) : null,
    versions: [{
      id: nextId('version'),
      label: tab.redrawVersion && tab.redrawVersion > 1 ? `重构V${tab.redrawVersion}` : '初始分析',
      extractResult: tab.extractResult ? deepClone(tab.extractResult) : null,
      serializedGraph: tab.serializedGraph ?? null,
      createdAt: Date.now(),
      redrawInstructions: tab.redrawInstructions,
    }],
    activeVersionId: null,
  })).map(file => ({
    ...file,
    activeVersionId: file.versions[0]?.id ?? null,
  }))
}

export const useGraphStore = defineStore('graph', () => {
  const files = ref<CanvasFile[]>([])
  const activeFileId = ref<string>('')
  const nodes = ref<NodeData[]>([])
  const edges = ref<EdgeData[]>([])
  const groups = ref<GroupData[]>([])
  /** 画布重渲染修订号：快照回退等"目标不变但内容变化"的场景靠它触发重渲染 */
  const graphRevision = ref(0)

  const globalNodeFontSize = ref<number>(15)
  const globalEdgeFontSize = ref<number>(15)

  const activeFile = computed<CanvasFile | null>(() =>
    files.value.find(f => f.id === activeFileId.value) || null,
  )

  const activeVersion = computed<CanvasVersion | null>(() => {
    const file = activeFile.value
    if (!file) return null
    return file.versions.find(v => v.id === file.activeVersionId) || null
  })

  function addFile(name?: string, activate: boolean = true): CanvasFile {
    fileCounter++
    const file: CanvasFile = {
      id: `file-${Date.now()}-${fileCounter}`,
      name: name || `画布 ${fileCounter}`,
      isChinese: false,
      claimId: null,
      rawText: '',
      claims: [],
      activeClaimId: null,
      translations: null,
      versions: [],
      activeVersionId: null,
    }
    files.value.push(file)
    if (activate) {
      activateFile(file.id)
    }
    return file
  }

  function removeFile(id: string): CanvasFile | null {
    const index = files.value.findIndex(f => f.id === id)
    if (index === -1) return null

    const [removed] = files.value.splice(index, 1)

    if (activeFileId.value === id) {
      if (files.value.length > 0) {
        const newIndex = Math.min(index, files.value.length - 1)
        activateFile(files.value[newIndex].id)
      } else {
        activeFileId.value = ''
      }
    }
    return removed
  }

  /**
   * 切换活动文件：翻译状态随文件切换（唯一入口，同步有序，
   * 取代旧版散落在 AppLayout watcher 中的快照/恢复逻辑）。
   */
  function activateFile(id: string): void {
    if (activeFileId.value === id) return

    const translationStore = useTranslationStore()
    const oldFile = files.value.find(f => f.id === activeFileId.value)
    if (oldFile) {
      oldFile.translations = translationStore.toJSON()
    }

    activeFileId.value = id

    const newFile = files.value.find(f => f.id === id)
    if (newFile) {
      if (newFile.translations) {
        translationStore.fromJSON(newFile.translations)
      } else {
        translationStore.clearAllTranslations()
      }
    }
  }

  /** 将某文件的活动版本切换为指定版本（画布渲染由监听 activeVersionId 的渲染器完成） */
  function setActiveVersion(fileId: string, versionId: string | null): void {
    const file = files.value.find(f => f.id === fileId)
    if (file) {
      file.activeVersionId = versionId
    }
  }

  /**
   * 追加版本（analyze / redraw 的统一落点）。
   * activate 默认 true：立即激活由渲染 watcher 渲染；AI 重构流式期间传 false，
   * 成功后再激活，避免画布在等待响应时被清空。
   */
  function appendVersion(
    fileId: string,
    opts: { label: string; extractResult: ExtractResult; sourceVersionId?: string; redrawInstructions?: string; activate?: boolean },
  ): CanvasVersion {
    const file = files.value.find(f => f.id === fileId)
    if (!file) throw new Error(`appendVersion: 文件 ${fileId} 不存在`)

    const version: CanvasVersion = {
      id: nextId('version'),
      label: opts.label,
      // 深拷贝入参：版本快照与调用方不共享引用
      extractResult: deepClone(opts.extractResult),
      serializedGraph: null,
      createdAt: Date.now(),
      sourceVersionId: opts.sourceVersionId,
      redrawInstructions: opts.redrawInstructions,
    }
    file.versions.push(version)
    if (opts.activate !== false) {
      file.activeVersionId = version.id
    }
    return version
  }

  function removeVersion(fileId: string, versionId: string): CanvasVersion | null {
    const file = files.value.find(f => f.id === fileId)
    if (!file) return null
    const index = file.versions.findIndex(v => v.id === versionId)
    if (index === -1) return null

    const [removed] = file.versions.splice(index, 1)
    if (file.activeVersionId === versionId) {
      file.activeVersionId = file.versions.length > 0
        ? file.versions[file.versions.length - 1].id
        : null
    }
    return removed
  }

  function updateVersionSerializedGraph(fileId: string, versionId: string, json: Record<string, unknown>): void {
    const file = files.value.find(f => f.id === fileId)
    const version = file?.versions.find(v => v.id === versionId)
    if (!version) return
    // 覆盖前留存上一版画布快照：手动编辑不可逆，快照提供自动回退点
    captureSnapshot(version, json)
    version.serializedGraph = json
  }

  /** 画布内容发生变化时留存旧状态快照（受最小间隔与数量上限约束） */
  function captureSnapshot(
    version: CanvasVersion,
    next: Record<string, unknown>,
    force = false,
  ): void {
    const prev = version.serializedGraph
    if (!prev || Object.keys(prev).length === 0) return

    const snapshots = version.snapshots ?? []
    const last = snapshots[snapshots.length - 1]
    if (!force && last && Date.now() - last.at < SNAPSHOT_MIN_INTERVAL) return
    if (!force && JSON.stringify(prev) === JSON.stringify(next)) return

    snapshots.push({
      id: nextId('snapshot'),
      at: Date.now(),
      serializedGraph: deepClone(prev),
    })
    if (snapshots.length > SNAPSHOT_MAX) {
      snapshots.splice(0, snapshots.length - SNAPSHOT_MAX)
    }
    version.snapshots = snapshots
  }

  /** 回退到某个自动快照（回退前的状态同样会被留存为快照，可再次撤回） */
  function restoreSnapshot(fileId: string, versionId: string, snapshotId: string): boolean {
    const file = files.value.find(f => f.id === fileId)
    const version = file?.versions.find(v => v.id === versionId)
    const snapshot = version?.snapshots?.find(s => s.id === snapshotId)
    if (!file || !version || !snapshot) return false

    captureSnapshot(version, snapshot.serializedGraph, true)
    version.serializedGraph = deepClone(snapshot.serializedGraph)
    file.activeVersionId = versionId
    // 目标版本可能已是活动版本，需用修订号强制触发画布重渲染
    graphRevision.value++
    return true
  }

  function updateFileName(fileId: string, name: string): void {
    const file = files.value.find(f => f.id === fileId)
    if (file) {
      file.name = name
    }
  }

  function updateFileMeta(fileId: string, meta: { isChinese?: boolean; claimId?: string | null }): void {
    const file = files.value.find(f => f.id === fileId)
    if (file) {
      if (meta.isChinese !== undefined) file.isChinese = meta.isChinese
      if (meta.claimId !== undefined) file.claimId = meta.claimId
    }
  }

  function updateFileClaimData(fileId: string, rawText: string, claims: Claim[], activeClaimId: string | null): void {
    const file = files.value.find(f => f.id === fileId)
    if (file) {
      file.rawText = rawText
      // 深拷贝入参：文件快照与全局 store 不共享引用，避免任一侧原地修改互相穿透
      file.claims = claims ? deepClone(claims) : []
      file.activeClaimId = activeClaimId
    }
  }

  function updateFileTranslations(fileId: string, translations: FileTranslations | null): void {
    const file = files.value.find(f => f.id === fileId)
    if (file) {
      file.translations = translations ? deepClone(translations) : null
    }
  }

  function updateFileClaimSentences(fileId: string, claimId: string, sentences: Claim['sentences']): void {
    const file = files.value.find(f => f.id === fileId)
    const claim = file?.claims.find(c => c.id === claimId)
    if (claim) {
      claim.sentences = deepClone(sentences)
    }
  }

  /** 定向合并单条权利要求的翻译快照到文件，不影响文件内其他条目 */
  function mergeFileTranslation(fileId: string, claimId: string, translation: FileTranslations[string] | null | undefined): void {
    const file = files.value.find(f => f.id === fileId)
    if (!file || !translation) return
    const merged: FileTranslations = { ...(file.translations ?? {}) }
    merged[claimId] = deepClone(translation)
    file.translations = merged
  }

  /** 批量恢复（加载 autosave / 项目文件时使用，不做翻译切换） */
  function setFiles(data: CanvasFile[]): void {
    files.value = data
  }

  function setActiveFileId(id: string): void {
    activeFileId.value = id
  }

  /** 保证至少存在一个画布文件（应用启动 / 删除最后一个文件时） */
  function ensureDefaultFile(): CanvasFile {
    if (files.value.length === 0) {
      const file = addFile(undefined, false)
      activateFile(file.id)
      return file
    }
    if (!activeFileId.value || !files.value.some(f => f.id === activeFileId.value)) {
      activateFile(files.value[0].id)
    }
    return files.value[0]
  }

  function setNodes(data: NodeData[]): void {
    nodes.value = data
  }

  function setEdges(data: EdgeData[]): void {
    edges.value = data
  }

  function setGroups(data: GroupData[]): void {
    groups.value = data
  }

  function updateNodeStyle(id: string, style: Partial<NodeData['style']>): void {
    const node = nodes.value.find(n => n.id === id)
    if (node) {
      node.style = { ...node.style, ...style }
    }
  }

  function updateEdgeStyle(id: string, style: Partial<EdgeData['style']>): void {
    const edge = edges.value.find(e => e.id === id)
    if (edge) {
      edge.style = { ...edge.style, ...style }
    }
  }

  function setGlobalNodeFontSize(size: number): void {
    globalNodeFontSize.value = size
  }

  function setGlobalEdgeFontSize(size: number): void {
    globalEdgeFontSize.value = size
  }

  function clearGraph(): void {
    nodes.value = []
    edges.value = []
    groups.value = []
  }

  /** 清空活动文件的全部版本与画布（保留输入文本） */
  function clearActiveFileGraph(): void {
    const file = activeFile.value
    if (file) {
      file.versions = []
      file.activeVersionId = null
      file.claimId = null
    }
    clearGraph()
  }

  function toJSON(): GraphJSON {
    return {
      version: '1.0.0',
      claimId: '',
      nodes: nodes.value,
      edges: edges.value,
      groups: groups.value,
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  }

  return {
    files,
    activeFileId,
    activeFile,
    activeVersion,
    graphRevision,
    nodes,
    edges,
    groups,
    globalNodeFontSize,
    globalEdgeFontSize,
    addFile,
    removeFile,
    activateFile,
    setActiveVersion,
    appendVersion,
    removeVersion,
    updateVersionSerializedGraph,
    restoreSnapshot,
    updateFileName,
    updateFileMeta,
    updateFileClaimData,
    updateFileTranslations,
    updateFileClaimSentences,
    mergeFileTranslation,
    setFiles,
    setActiveFileId,
    ensureDefaultFile,
    setNodes,
    setEdges,
    setGroups,
    updateNodeStyle,
    updateEdgeStyle,
    setGlobalNodeFontSize,
    setGlobalEdgeFontSize,
    clearGraph,
    clearActiveFileGraph,
    toJSON,
  }
})
