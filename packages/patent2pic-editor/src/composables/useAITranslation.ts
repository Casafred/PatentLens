import { ref } from 'vue'
import { useAIStore } from '@/stores/ai'
import { useTranslationStore } from '@/stores/translation'
import { streamChat } from '@/services/ai/client'
import { buildTranslationMessages } from '@/services/ai/translation'
import type { Claim, Sentence } from '@/types/claim'
import type { SentenceTranslation } from '@/types/translation'

const MAX_CONCURRENT = 5

export function useAITranslation() {
  const aiStore = useAIStore()
  const translationStore = useTranslationStore()
  const error = ref<string | null>(null)

  async function translateSingleSentence(
    claimId: string,
    sentenceId: string,
    originalText: string,
  ): Promise<void> {
    const translation: SentenceTranslation = {
      sentenceId,
      originalText,
      translatedText: '',
      status: 'loading',
      error: null,
    }
    translationStore.setSentenceTranslation(claimId, translation)

    try {
      const messages = buildTranslationMessages(originalText, aiStore.translationConfig.targetLanguage)
      let fullContent = ''

      const providerType = aiStore.translationConfig.useSeparateModel
        ? aiStore.translationConfig.providerType
        : aiStore.activeProviderType

      const apiKey = aiStore.translationConfig.useSeparateModel
        ? aiStore.translationApiKey
        : aiStore.activeApiKey

      const baseUrl = aiStore.translationConfig.useSeparateModel
        ? aiStore.translationBaseUrl
        : aiStore.activeBaseUrl

      const model = aiStore.translationModel

      for await (const chunk of streamChat(providerType, apiKey, baseUrl, {
        model,
        messages,
        temperature: 0.3,
        stream: true,
      })) {
        if (chunk.done) break
        fullContent += chunk.content
      }

      translation.translatedText = fullContent.trim()
      translation.status = 'done'
    } catch (err) {
      translation.status = 'error'
      translation.error = (err as Error).message || '翻译失败'
    }

    translationStore.setSentenceTranslation(claimId, translation)
    translationStore.progress.completed++
  }

  async function translateAllSentences(claim: Claim): Promise<void> {
    if (!aiStore.translationConfig.enabled) return

    const sentenceIds = claim.sentences.map((s: Sentence) => s.id)
    const originalTexts: Record<string, string> = {}
    claim.sentences.forEach((s: Sentence) => {
      originalTexts[s.id] = s.text
    })

    translationStore.initClaimTranslation(claim.id, sentenceIds, originalTexts)
    translationStore.isTranslating = true
    translationStore.progress = { completed: 0, total: claim.sentences.length }
    error.value = null

    const queue = [...claim.sentences]
    let activeWorkers = 0

    async function worker() {
      while (queue.length > 0) {
        const sentence = queue.shift()
        if (sentence) {
          await translateSingleSentence(claim.id, sentence.id, sentence.text)
        }
      }
      activeWorkers--
    }

    const workerCount = Math.min(MAX_CONCURRENT, claim.sentences.length)
    activeWorkers = workerCount
    const workers = Array.from({ length: workerCount }, () => worker())
    await Promise.allSettled(workers)

    translationStore.isTranslating = false
  }

  async function retryTranslation(claimId: string, sentenceId: string): Promise<void> {
    const translation = translationStore.getSentenceTranslation(claimId, sentenceId)
    if (translation) {
      await translateSingleSentence(claimId, sentenceId, translation.originalText)
    }
  }

  return {
    error,
    translateAllSentences,
    retryTranslation,
  }
}
