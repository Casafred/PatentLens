import { ref } from 'vue'
import { useAIStore } from '@/stores/ai'
import { useClaimStore } from '@/stores/claim'
import { useGraphStore } from '@/stores/graph'
import { useTranslationStore } from '@/stores/translation'
import { streamChat } from '@/services/ai/client'
import { buildMessages } from '@/services/ai/prompt'
import { predictClaimType } from '@/utils/claim-type'
import { parseExtractResult } from '@/services/ai/extractor'
import { alignTranslationToSentences } from '@/services/claim/translation-aligner'
import { timingStart, timingEnd, timingLap } from '@/utils/timing'
import type { ChatUsage, ExtractResult, SentencePair } from '@/types/ai'
import type { Sentence } from '@/types/claim'
import { useAITranslation } from '@/composables/useAITranslation'

function isChineseText(text: string): boolean {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  const totalChars = text.replace(/[\s\d\p{P}]/gu, '').length
  if (totalChars === 0) return false
  return (chineseChars?.length ?? 0) / totalChars > 0.3
}

export function useAIExtract() {
  const aiStore = useAIStore()
  const claimStore = useClaimStore()
  const graphStore = useGraphStore()
  const translationStore = useTranslationStore()
  const { translateAllSentences } = useAITranslation()
  const streamContent = ref('')
  const reasoningContent = ref('')
  const lastUsage = ref<ChatUsage | null>(null)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null

  async function extract(claimText: string, claimId?: string): Promise<ExtractResult | null> {
    const timingKey = `权利要求分析 [${claimText.slice(0, 30).replace(/\n/g, ' ')}...]`
    timingStart(timingKey)

    // 分析目标：当前活动画布文件。输入状态已归属文件，无需任何快照搬运。
    const file = graphStore.activeFile
    if (!file) {
      error.value = '没有可用的画布文件'
      return null
    }
    const isFreshAnalysis = file.versions.length === 0

    aiStore.isExtracting = true
    aiStore.extractError = null
    streamContent.value = ''
    reasoningContent.value = ''
    lastUsage.value = null
    error.value = null

    abortController = new AbortController()

    const isChinese = isChineseText(claimText)
    const claimPreview = claimText.slice(0, 80).replace(/\n/g, ' ')
    const providerType = aiStore.activeProviderType
    const model = aiStore.activeModel

    let fullContent = ''
    let fullReasoning = ''
    let streamError: string | null = null

    try {
      timingStart(`  │ 构建提示词`)
      const claimType = predictClaimType(claimText)
      const messages = buildMessages(claimText, providerType, claimType)
      timingEnd(`  │ 构建提示词`)

      const isDeepSeek = aiStore.activeProviderType === 'deepseek'

      timingStart(`  │ API 流式请求 (${providerType}/${model})`)
      let firstChunkReceived = false

      for await (const chunk of streamChat(
        aiStore.activeProviderType,
        aiStore.activeApiKey,
        aiStore.activeBaseUrl,
        {
          model: aiStore.activeModel,
          messages,
          temperature: isDeepSeek ? undefined : 0.1,
          stream: true,
          responseFormat: isDeepSeek || aiStore.activeProviderType === 'openai' || aiStore.activeProviderType === 'custom'
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
        if (!firstChunkReceived) {
          firstChunkReceived = true
          timingLap(`  首字节到达 (TTFB)`, `  │ API 流式请求 (${providerType}/${model})`)
        }
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
        aiStore.extractStreamContent = fullContent
      }

      if (!firstChunkReceived) {
        timingLap(`  未收到任何数据块`, `  │ API 流式请求 (${providerType}/${model})`)
      }

      if (lastUsage.value) {
        timingLap(`  Token 用量: prompt=${lastUsage.value.promptTokens} completion=${lastUsage.value.completionTokens} total=${lastUsage.value.totalTokens}`,
          `  │ API 流式请求 (${providerType}/${model})`)
      }

      timingEnd(`  │ API 流式请求 (${providerType}/${model})`)
    } catch (err) {
      timingEnd(`  │ API 流式请求 (${providerType}/${model})`)
      const isAbort = (err as Error).name === 'AbortError'
      streamError = isAbort ? '用户终止分析' : ((err as Error).message || '流式请求失败')

      const elapsed = timingEnd(timingKey)

      aiStore.addExtractLog({
        provider: providerType,
        model,
        status: 'error',
        rawResponse: fullContent || '(未收到任何响应内容)',
        errorMessage: streamError,
        claimPreview,
        durationMs: elapsed,
      })

      aiStore.extractError = streamError
      error.value = streamError
      aiStore.isExtracting = false
      abortController = null
      return null
    }

    let parseError: string | null = null
    let result: ExtractResult | null = null

    try {
      timingStart(`  │ JSON 解析与验证`)
      result = parseExtractResult(fullContent)
      result.claimId = claimId || file.activeClaimId || ''
      timingEnd(`  │ JSON 解析与验证`)
    } catch (err) {
      parseError = (err as Error).message || '解析失败'
      timingEnd(`  │ JSON 解析与验证`)
    }

    if (parseError || !result) {
      const elapsed = timingEnd(timingKey)

      aiStore.addExtractLog({
        provider: providerType,
        model,
        status: 'error',
        rawResponse: fullContent,
        errorMessage: parseError || '解析结果为空',
        claimPreview,
        durationMs: elapsed,
      })

      aiStore.extractError = parseError || '解析结果为空'
      error.value = parseError || '解析结果为空'
      aiStore.isExtracting = false
      abortController = null
      return null
    }

    aiStore.addExtractLog({
      provider: providerType,
      model,
      status: 'success',
      rawResponse: fullContent,
      claimPreview,
      durationMs: timingEnd(timingKey),
    })

    // 成功：结果作为新版本写入当前文件，激活后由渲染 watcher 构建画布
    graphStore.appendVersion(file.id, {
      label: isFreshAnalysis ? '初始分析' : '重新分析',
      extractResult: result,
    })
    graphStore.updateFileMeta(file.id, { isChinese, claimId: claimId ?? null })

    // 默认命名的文件改为权利要求名
    if (/^画布 \d+$/.test(file.name)) {
      const claimIndex = claimStore.claims.find(c => c.id === (claimId ?? claimStore.activeClaimId))?.index
        ?? claimStore.claims[0]?.index
        ?? 1
      graphStore.updateFileName(file.id, `权利要求 ${claimIndex}`)
    }

    timingLap(`  节点数=${result.nodes.length} 边数=${result.edges.length} 组数=${result.groups.length}`, timingKey)

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

  async function extractActiveClaim(): Promise<ExtractResult | null> {
    const claim = claimStore.getActiveClaim()
    if (!claim) {
      error.value = '请先选择一条权利要求'
      return null
    }
    if (!aiStore.activeApiKey) {
      error.value = '请先配置 API Key'
      return null
    }

    const extractResult = await extract(claim.rawText, claim.id)
    if (!extractResult) return null

    if (extractResult.sentencePairs && extractResult.sentencePairs.length > 0) {
      applySentencePairs(claim.id, extractResult.sentencePairs)
    } else if (extractResult.translatedClaim && claim.sentences.length > 0) {
      const sentenceTranslations = alignTranslationToSentences(
        claim.rawText,
        extractResult.translatedClaim,
        claim.sentences,
      )
      const sentenceIds = sentenceTranslations.map(st => st.sentenceId)
      const originalTexts: Record<string, string> = {}
      sentenceTranslations.forEach(st => {
        originalTexts[st.sentenceId] = st.originalText
      })
      translationStore.initClaimTranslation(claim.id, sentenceIds, originalTexts)
      sentenceTranslations.forEach(st => {
        if (st.translatedText) {
          translationStore.setSentenceTranslation(claim.id, {
            sentenceId: st.sentenceId,
            originalText: st.originalText,
            translatedText: st.translatedText,
            status: 'done',
            error: null,
          })
        }
      })
      const claimTrans = translationStore.getClaimTranslation(claim.id)
      if (claimTrans) {
        claimTrans.overallStatus = 'done'
      }
    } else if (aiStore.translationConfig.enabled
      && aiStore.translationConfig.autoTranslate
      && claim.sentences.length > 0) {
      await translateAllSentences(claim)
    }

    // 把 AI 对齐后的句子与翻译同步进活动文件快照，导出 Excel 时快照数据完整
    syncActiveFileSnapshot(claim.id)

    return extractResult
  }

  function syncActiveFileSnapshot(claimId: string): void {
    const file = graphStore.activeFile
    if (!file) return
    const claim = claimStore.claims.find(c => c.id === claimId)
    if (claim) {
      graphStore.updateFileClaimSentences(file.id, claimId, claim.sentences)
    }
    graphStore.mergeFileTranslation(file.id, claimId, translationStore.getClaimTranslation(claimId))
  }

  function applySentencePairs(claimId: string, pairs: SentencePair[]): void {
    const newSentences: Sentence[] = pairs.map((pair, idx) => ({
      // 句子 ID 挂 claimId（含 sessionId，跨分析唯一），与 parser 的 ID 规则收敛
      id: `${claimId}-sent-${idx + 1}`,
      text: pair.original,
      nodeIds: [],
      edgeIds: [],
    }))

    claimStore.updateClaimSentences(claimId, newSentences)

    const sentenceIds = newSentences.map(s => s.id)
    const originalTexts: Record<string, string> = {}
    newSentences.forEach(s => {
      originalTexts[s.id] = s.text
    })
    translationStore.initClaimTranslation(claimId, sentenceIds, originalTexts)

    pairs.forEach((pair, idx) => {
      const sentenceId = newSentences[idx].id
      translationStore.setSentenceTranslation(claimId, {
        sentenceId,
        originalText: pair.original,
        translatedText: pair.translation,
        status: 'done',
        error: null,
      })
    })

    const claimTrans = translationStore.getClaimTranslation(claimId)
    if (claimTrans) {
      claimTrans.overallStatus = 'done'
    }
  }

  return {
    streamContent,
    reasoningContent,
    lastUsage,
    error,
    extract,
    extractActiveClaim,
    abort,
  }
}
