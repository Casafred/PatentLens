import { ref } from 'vue'
import { useAIStore } from '@/stores/ai'
import { useGraphStore, type CanvasFile, type CanvasVersion } from '@/stores/graph'
import { streamChat } from '@/services/ai/client'
import { buildRedrawMessages } from '@/services/ai/redraw-prompt'
import { parseExtractResult } from '@/services/ai/extractor'
import { x6ToExtractResult } from '@/services/graph/x6-to-extract'
import { graphEngine } from '@/services/graph/engine'
import { timingStart, timingEnd, timingLap } from '@/utils/timing'
import type { ChatUsage, ExtractResult } from '@/types/ai'
import type { RedrawOptions } from '@/types/redraw'

export function useAIRedraw() {
  const aiStore = useAIStore()
  const graphStore = useGraphStore()

  const streamContent = ref('')
  const reasoningContent = ref('')
  const isRunning = ref(false)
  const lastChanges = ref<string[]>([])
  const lastUsage = ref<ChatUsage | null>(null)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null

  /** 沿 sourceVersionId 回溯版本链根版本 */
  function findRootVersionId(file: CanvasFile, versionId: string): string {
    let current = file.versions.find(v => v.id === versionId)
    const seen = new Set<string>()
    while (current?.sourceVersionId && !seen.has(current.sourceVersionId)) {
      seen.add(current.id)
      const parent = file.versions.find(v => v.id === current!.sourceVersionId)
      if (!parent) break
      current = parent
    }
    return current?.id ?? versionId
  }

  /** 同一版本链上下一个重构版本号（根版本「初始分析」不计，首个重构为 V1） */
  function nextChainVersion(file: CanvasFile, sourceVersionId: string): number {
    const rootId = findRootVersionId(file, sourceVersionId)
    const chainCount = file.versions.filter(
      v => v.id === rootId || findRootVersionId(file, v.id) === rootId,
    ).length
    return chainCount
  }

  /** 取重构基准：当前画布（含手动编辑）或源版本的抽取结果 */
  function resolveBase(
    file: CanvasFile,
    sourceVersion: CanvasVersion,
    base: RedrawOptions['base'],
  ): ExtractResult | null {
    const original = sourceVersion.extractResult

    if (base === 'current') {
      // 序列化当前画布（含手动编辑）并存回源版本，保证手动编辑不丢失
      if (graphStore.activeFileId === file.id) {
        const json = graphEngine.toJSON()
        graphStore.updateVersionSerializedGraph(file.id, sourceVersion.id, json)
        const converted = x6ToExtractResult(json, {
          frames: original?.frames,
          translatedClaim: original?.translatedClaim,
          sentencePairs: original?.sentencePairs,
        })
        if (converted.nodes.length > 0) return converted
        // 当前画布为空但 extractResult 存在 → 自动降级
        return original
      }
      // 非活动文件：用源版本的序列化快照
      if (sourceVersion.serializedGraph && Object.keys(sourceVersion.serializedGraph).length > 0) {
        const converted = x6ToExtractResult(sourceVersion.serializedGraph, {
          frames: original?.frames,
          translatedClaim: original?.translatedClaim,
          sentencePairs: original?.sentencePairs,
        })
        if (converted.nodes.length > 0) return converted
      }
      return original
    }

    return original
  }

  async function redraw(
    sourceFileId: string,
    instructions: string,
    options: RedrawOptions,
  ): Promise<ExtractResult | null> {
    const file = graphStore.files.find(f => f.id === sourceFileId)
    if (!file) {
      error.value = '目标画布文件不存在'
      return null
    }
    const sourceVersion = file.versions.find(v => v.id === file.activeVersionId) ?? null
    if (!sourceVersion) {
      error.value = '当前文件没有可重构的版本，请先执行分析'
      return null
    }
    if (!instructions.trim()) {
      error.value = '请填写重构要求'
      return null
    }
    if (!aiStore.activeApiKey) {
      error.value = '请先配置 API Key'
      return null
    }

    const base = resolveBase(file, sourceVersion, options.base)
    if (!base || base.nodes.length === 0) {
      error.value = '当前版本无可用基准（无图且无抽取结果）'
      return null
    }

    const timingKey = `AI 重构 [${instructions.slice(0, 30).replace(/\n/g, ' ')}...]`
    timingStart(timingKey)

    error.value = null
    streamContent.value = ''
    reasoningContent.value = ''
    lastUsage.value = null
    isRunning.value = true
    aiStore.isExtracting = true
    aiStore.extractError = null

    abortController = new AbortController()

    // 参考上下文：该文件分析的权利要求原文
    const claimText = options.includeClaimContext
      ? file.claims.find(c => c.id === file.claimId)?.rawText
      : undefined

    let fullContent = ''
    let fullReasoning = ''
    let streamError: string | null = null
    const providerType = aiStore.activeProviderType
    const model = aiStore.activeModel
    const claimPreview = `[重构] ${instructions.slice(0, 60).replace(/\n/g, ' ')}`

    try {
      const messages = buildRedrawMessages(base, instructions, providerType, { claimText })
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
          thinking: isDeepSeek
            ? { type: 'enabled' }
            : undefined,
          reasoningEffort: isDeepSeek
            ? 'high'
            : undefined,
          userId: isDeepSeek ? 'patent2pic-user' : undefined,
          streamOptions: isDeepSeek ? { includeUsage: true } : undefined,
        },
        abortController.signal,
      )) {
        if (chunk.done) break
        if (chunk.usage) {
          lastUsage.value = chunk.usage
        }
        fullContent += chunk.content
        if (chunk.reasoningContent) {
          fullReasoning += chunk.reasoningContent
          reasoningContent.value = fullReasoning
        }
        streamContent.value = fullContent
      }
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError'
      streamError = isAbort ? '用户终止重构' : ((err as Error).message || '流式请求失败')
    }

    const fail = (message: string): null => {
      aiStore.addExtractLog({
        provider: providerType,
        model,
        status: 'error',
        rawResponse: fullContent || '(未收到任何响应内容)',
        errorMessage: message,
        claimPreview,
        durationMs: timingEnd(timingKey),
      })
      // 版本仅在成功时追加，失败无需清理
      aiStore.extractError = message
      error.value = message
      isRunning.value = false
      aiStore.isExtracting = false
      abortController = null
      return null
    }

    if (streamError) {
      return fail(streamError)
    }

    let result: ExtractResult
    try {
      result = parseExtractResult(fullContent)
    } catch (err) {
      return fail((err as Error).message || '解析失败')
    }

    result.claimId = file.claimId ?? ''

    // 保留原图动画帧（节点 ID 未变的帧高亮依然有效）
    if (options.keepFrames && base.frames && base.frames.length > 0) {
      result.frames = base.frames
    }

    aiStore.addExtractLog({
      provider: providerType,
      model,
      status: 'success',
      rawResponse: fullContent,
      claimPreview,
      durationMs: timingEnd(timingKey),
    })

    // 重构结果作为新版本追加到版本链并激活；
    // 画布渲染由 AppLayout 的 renderKey watcher 统一完成
    const versionNo = nextChainVersion(file, sourceVersion.id)
    graphStore.appendVersion(file.id, {
      label: `重构V${versionNo}`,
      extractResult: result,
      sourceVersionId: sourceVersion.id,
      redrawInstructions: instructions,
    })

    timingLap(`  节点数=${result.nodes.length} 边数=${result.edges.length} 组数=${result.groups.length}`, timingKey)

    lastChanges.value = result.changes ?? []
    isRunning.value = false
    aiStore.isExtracting = false
    abortController = null
    return result
  }

  function abort(): void {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    streamContent,
    reasoningContent,
    isRunning,
    lastChanges,
    lastUsage,
    error,
    redraw,
    abort,
  }
}
