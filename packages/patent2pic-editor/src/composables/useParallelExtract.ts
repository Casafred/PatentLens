import { ref, computed } from 'vue'
import { useAIStore } from '@/stores/ai'
import { useGraphStore, type CanvasFile } from '@/stores/graph'
import { useTranslationStore } from '@/stores/translation'
import { streamChat } from '@/services/ai/client'
import { buildMessages } from '@/services/ai/prompt'
import { predictClaimType } from '@/utils/claim-type'
import { parseExtractResult } from '@/services/ai/extractor'
import { alignTranslationToSentences } from '@/services/claim/translation-aligner'
import type { ExtractResult } from '@/types/ai'
import type { Claim, Sentence } from '@/types/claim'
import type { ClaimTranslation } from '@/types/translation'

export interface ParallelTask {
  claimId: string
  claimIndex: number
  claimPreview: string
  status: 'pending' | 'running' | 'success' | 'error' | 'aborted'
  progress: number
  fileId: string
  errorMessage: string | null
  durationMs: number | null
}

function isChineseText(text: string): boolean {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  const totalChars = text.replace(/[\s\d\p{P}]/gu, '').length
  if (totalChars === 0) return false
  return (chineseChars?.length ?? 0) / totalChars > 0.3
}

/**
 * 模块级单例状态：输入区与任务中心共享同一份队列，
 * 因此任务面板能实时反映并行分析进度并支持单条重试。
 */
const tasks = ref<ParallelTask[]>([])
const isRunning = ref(false)
const taskPanelVisible = ref(false)
let abortControllers: AbortController[] = []
let aborted = false
/** 本次运行中新建的文件（复用的活动文件不算），失败/终止时回滚删除 */
let createdFileIds: Set<string> = new Set()

const maxConcurrency = computed(() => {
  // 默认并发数 3，可根据 provider 类型调整
  return 3
})

const effectiveConcurrency = computed(() => {
  return Math.min(maxConcurrency.value, 10, tasks.value.length)
})

const isDone = (status: ParallelTask['status']): boolean =>
  status === 'success' || status === 'error' || status === 'aborted'

const completedCount = computed(() => tasks.value.filter(t => isDone(t.status)).length)

const totalCount = computed(() => tasks.value.length)

const allDone = computed(() => tasks.value.length > 0 && tasks.value.every(t => isDone(t.status)))

const hasFailed = computed(() => tasks.value.some(t => t.status === 'error' || t.status === 'aborted'))

/** 从活动文件或任一文件中找回权利要求（重试需要完整 Claim 数据） */
function findClaimById(graphStore: ReturnType<typeof useGraphStore>, claimId: string): Claim | undefined {
  const fromActive = graphStore.activeFile?.claims.find(c => c.id === claimId)
  if (fromActive) return fromActive
  for (const file of graphStore.files) {
    const claim = file.claims.find(c => c.id === claimId)
    if (claim) return claim
  }
  return undefined
}

export function useParallelExtract() {
  const aiStore = useAIStore()
  const graphStore = useGraphStore()
  const translationStore = useTranslationStore()

  function initTasks(claims: Claim[], fileIdForClaim: Map<string, string>): void {
    tasks.value = claims.map(claim => ({
      claimId: claim.id,
      claimIndex: claim.index,
      claimPreview: claim.rawText.slice(0, 60).replace(/\n/g, ' '),
      status: 'pending',
      progress: 0,
      fileId: fileIdForClaim.get(claim.id) ?? '',
      errorMessage: null,
      durationMs: null,
    }))
  }

  /**
   * 为每条权利要求分配目标画布文件：
   * - 第一条：若活动文件尚无版本，就地复用（输入状态已在该文件上）；
   * - 其余：新建文件，复制当前输入状态（rawText / claims），activeClaimId 指向各自权利要求。
   */
  function assignFiles(claims: Claim[]): Map<string, string> {
    const mapping = new Map<string, string>()
    const activeFile = graphStore.activeFile
    const reusableActive = activeFile && activeFile.versions.length === 0 ? activeFile : null
    let reused = false

    for (const claim of claims) {
      if (reusableActive && !reused) {
        mapping.set(claim.id, reusableActive.id)
        reused = true
        continue
      }
      const file = graphStore.addFile(`权利要求 ${claim.index}`, false)
      graphStore.updateFileClaimData(
        file.id,
        activeFile?.rawText ?? '',
        claims,
        claim.id,
      )
      createdFileIds.add(file.id)
      mapping.set(claim.id, file.id)
    }
    return mapping
  }

  /** 构造句子与翻译快照，直接写入目标文件；活动文件额外刷新全局翻译 store 供 UI 实时展示 */
  function applyResultData(fileId: string, claim: Claim, result: ExtractResult): void {
    let newSentences: Sentence[] | null = null
    let claimTrans: ClaimTranslation | null = null

    if (result.sentencePairs && result.sentencePairs.length > 0) {
      const sentences: Sentence[] = result.sentencePairs.map((pair, idx) => ({
        // 句子 ID 挂 claimId（含 sessionId，跨分析唯一），与 parser 的 ID 规则收敛
        id: `${claim.id}-sent-${idx + 1}`,
        text: pair.original,
        nodeIds: [],
        edgeIds: [],
      }))
      newSentences = sentences
      claimTrans = {
        claimId: claim.id,
        sentences: result.sentencePairs.map((pair, idx) => ({
          sentenceId: sentences[idx].id,
          originalText: pair.original,
          translatedText: pair.translation,
          status: 'done' as const,
          error: null,
        })),
        overallStatus: 'done' as const,
      }
    } else if (result.translatedClaim && claim.sentences.length > 0) {
      const sentenceTranslations = alignTranslationToSentences(
        claim.rawText,
        result.translatedClaim,
        claim.sentences,
      )
      newSentences = claim.sentences.map(s => {
        const matched = sentenceTranslations.find(st => st.sentenceId === s.id)
        return matched ? { ...s, text: matched.originalText } : s
      })
      claimTrans = {
        claimId: claim.id,
        sentences: sentenceTranslations.map(st => ({
          sentenceId: st.sentenceId,
          originalText: st.originalText,
          translatedText: st.translatedText,
          status: 'done' as const,
          error: null,
        })),
        overallStatus: 'done' as const,
      }
    }

    if (newSentences) {
      // 写入文件快照；若为活动文件，claimStore 投影自动带动 UI 更新
      graphStore.updateFileClaimSentences(fileId, claim.id, newSentences)
    }
    if (claimTrans) {
      graphStore.mergeFileTranslation(fileId, claim.id, claimTrans)
    }

    // 活动文件：从文件快照刷新全局翻译 store，供对照阅读实时展示
    if (graphStore.activeFileId === fileId) {
      const file = graphStore.files.find(f => f.id === fileId)
      if (file?.translations) {
        translationStore.fromJSON(file.translations)
      }
    }
  }

  /** 任务失败/终止时回滚：仅删除本次新建的文件，复用的活动文件保留（输入不丢） */
  function rollbackFile(fileId: string): void {
    if (createdFileIds.has(fileId)) {
      graphStore.removeFile(fileId)
    }
  }

  async function processSingleClaim(claim: Claim, task: ParallelTask): Promise<void> {
    if (aborted) {
      task.status = 'aborted'
      task.errorMessage = '用户终止'
      return
    }

    const startTime = Date.now()
    task.status = 'running'
    task.progress = 10

    const isChinese = isChineseText(claim.rawText)
    const file = graphStore.files.find(f => f.id === task.fileId)
    if (!file) {
      task.status = 'error'
      task.errorMessage = '目标画布文件不存在'
      task.progress = 100
      return
    }

    const abortController = new AbortController()
    abortControllers.push(abortController)
    const providerType = aiStore.activeProviderType
    const model = aiStore.activeModel
    const claimPreview = claim.rawText.slice(0, 80).replace(/\n/g, ' ')

    let fullContent = ''
    let streamError: string | null = null

    try {
      const messages = buildMessages(claim.rawText, providerType, predictClaimType(claim.rawText))
      const isDeepSeek = providerType === 'deepseek'

      for await (const chunk of streamChat(
        providerType,
        aiStore.activeApiKey,
        aiStore.activeBaseUrl,
        {
          model,
          messages,
          temperature: isDeepSeek ? undefined : 0.1,
          stream: true,
          responseFormat: isDeepSeek || providerType === 'openai' || providerType === 'custom'
            ? { type: 'json_object' }
            : undefined,
          thinking: isDeepSeek ? { type: 'enabled' } : undefined,
          reasoningEffort: isDeepSeek ? 'high' : undefined,
          userId: isDeepSeek ? 'patent2pic-user' : undefined,
          streamOptions: isDeepSeek ? { includeUsage: true } : undefined,
        },
        abortController.signal,
      )) {
        if (aborted) break
        if (chunk.done) break
        fullContent += chunk.content
        task.progress = Math.min(80, 10 + (fullContent.length / 2000) * 70)
      }
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError'
      streamError = isAbort ? '用户终止分析' : ((err as Error).message || '流式请求失败')
    }

    if (aborted) {
      task.status = 'aborted'
      task.errorMessage = '用户终止'
      task.progress = 100
      task.durationMs = Date.now() - startTime
      rollbackFile(file.id)
      return
    }

    if (streamError) {
      task.status = 'error'
      task.errorMessage = streamError
      task.progress = 100
      task.durationMs = Date.now() - startTime
      rollbackFile(file.id)
      aiStore.addExtractLog({
        provider: providerType,
        model,
        status: 'error',
        rawResponse: fullContent || '(未收到任何响应内容)',
        errorMessage: streamError,
        claimPreview,
        durationMs: task.durationMs,
      })
      return
    }

    task.progress = 85
    let result: ExtractResult | null = null

    try {
      result = parseExtractResult(fullContent)
      result.claimId = claim.id
    } catch (err) {
      task.status = 'error'
      task.errorMessage = (err as Error).message || '解析失败'
      task.progress = 100
      task.durationMs = Date.now() - startTime
      rollbackFile(file.id)
      aiStore.addExtractLog({
        provider: providerType,
        model,
        status: 'error',
        rawResponse: fullContent,
        errorMessage: task.errorMessage || '解析结果为空',
        claimPreview,
        durationMs: task.durationMs,
      })
      return
    }

    task.progress = 90

    // 结果作为初始版本写入目标文件；若该文件处于活动态，
    // 渲染 watcher 会自动构建画布，非活动文件在切换时按需渲染
    graphStore.appendVersion(file.id, { label: '初始分析', extractResult: result })
    graphStore.updateFileMeta(file.id, { isChinese, claimId: claim.id })
    if (/^画布 \d+$/.test(file.name)) {
      graphStore.updateFileName(file.id, `权利要求 ${claim.index}`)
    }

    // 句子与翻译直接写入文件快照
    applyResultData(file.id, claim, result)

    task.status = 'success'
    task.progress = 100
    task.durationMs = Date.now() - startTime

    aiStore.addExtractLog({
      provider: providerType,
      model,
      status: 'success',
      rawResponse: fullContent,
      claimPreview,
      durationMs: task.durationMs,
    })
  }

  async function runParallel(claims: Claim[]): Promise<void> {
    if (isRunning.value) return
    if (!aiStore.activeApiKey) return

    isRunning.value = true
    aborted = false
    abortControllers = []
    createdFileIds = new Set()
    aiStore.isExtracting = true
    aiStore.extractError = null
    // 并行任务可视化面板：任务下发即展开
    taskPanelVisible.value = true

    const mapping = assignFiles(claims)
    initTasks(claims, mapping)

    const concurrency = effectiveConcurrency.value
    const queue = [...tasks.value]
    const claimMap = new Map(claims.map(c => [c.id, c]))

    // Process tasks with controlled concurrency
    const executing = new Set<Promise<void>>()

    for (const task of queue) {
      if (aborted) {
        task.status = 'aborted'
        task.errorMessage = '用户终止'
        continue
      }

      const claim = claimMap.get(task.claimId)
      if (!claim) continue

      const promise = processSingleClaim(claim, task).then(() => {
        executing.delete(promise)
      })

      executing.add(promise)

      if (executing.size >= concurrency) {
        await Promise.race(executing)
      }
    }

    // Wait for remaining tasks
    await Promise.all(executing)

    // 全部完成后激活第一个成功的文件（复用活动文件时通常就是它自己）
    const firstSuccess = tasks.value.find(t => t.status === 'success' && t.fileId)
    if (firstSuccess && firstSuccess.fileId
      && graphStore.files.some((f: CanvasFile) => f.id === firstSuccess.fileId)) {
      graphStore.activateFile(firstSuccess.fileId)
    }

    isRunning.value = false
    aiStore.isExtracting = false
    abortControllers = []
  }

  /**
   * 单条重试：仅重跑失败/已终止的任务。
   * 目标文件若已被回滚删除，则重新分配一个文件后再执行。
   */
  async function retryTask(claimId: string): Promise<void> {
    if (isRunning.value) return
    const task = tasks.value.find(t => t.claimId === claimId)
    if (!task || (task.status !== 'error' && task.status !== 'aborted')) return
    if (!aiStore.activeApiKey) return

    const claim = findClaimById(graphStore, claimId)
    if (!claim) return

    // 目标文件可能已被回滚删除 → 重新分配
    const existing = graphStore.files.find(f => f.id === task.fileId)
    if (!existing) {
      const source = graphStore.activeFile
      const file = graphStore.addFile(`权利要求 ${claim.index}`, false)
      graphStore.updateFileClaimData(
        file.id,
        source?.rawText ?? claim.rawText,
        source?.claims.length ? source.claims : [claim],
        claim.id,
      )
      createdFileIds.add(file.id)
      task.fileId = file.id
    }

    isRunning.value = true
    aborted = false
    abortControllers = []
    aiStore.isExtracting = true
    aiStore.extractError = null
    task.status = 'pending'
    task.progress = 0
    task.errorMessage = null
    task.durationMs = null

    await processSingleClaim(claim, task)

    isRunning.value = false
    aiStore.isExtracting = false
    abortControllers = []

    // 重新从队列读取状态：processSingleClaim 在原地改写 task.status
    const finished = tasks.value.find(t => t.claimId === claimId)
    if (finished?.status === 'success') {
      // 重试成功后切到该文件，用户直接看到结果
      graphStore.activateFile(finished.fileId)
    }
  }

  /** 批量重试所有失败/已终止的任务（串行执行，避免并发风暴） */
  async function retryFailed(): Promise<void> {
    const failed = tasks.value.filter(t => t.status === 'error' || t.status === 'aborted')
    for (const task of failed) {
      if (aborted) break
      await retryTask(task.claimId)
    }
  }

  function abortAll(): void {
    aborted = true
    // Abort all active HTTP requests
    for (const controller of abortControllers) {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    }
    abortControllers = []

    // Mark all pending/running tasks as aborted
    for (const task of tasks.value) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'aborted'
        task.errorMessage = '用户终止'
        // 回滚该任务新建的文件（复用的活动文件保留，输入不丢）
        if (task.fileId) {
          rollbackFile(task.fileId)
        }
      }
    }

    isRunning.value = false
    aiStore.isExtracting = false
  }

  function reset(): void {
    tasks.value = []
    isRunning.value = false
  }

  function openTaskPanel(): void {
    taskPanelVisible.value = true
  }

  function closeTaskPanel(): void {
    taskPanelVisible.value = false
  }

  function toggleTaskPanel(): void {
    taskPanelVisible.value = !taskPanelVisible.value
  }

  return {
    tasks,
    isRunning,
    taskPanelVisible,
    maxConcurrency,
    effectiveConcurrency,
    completedCount,
    totalCount,
    allDone,
    hasFailed,
    runParallel,
    retryTask,
    retryFailed,
    abortAll,
    reset,
    openTaskPanel,
    closeTaskPanel,
    toggleTaskPanel,
  }
}
