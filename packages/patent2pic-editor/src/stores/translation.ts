import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ClaimTranslation, SentenceTranslation, TranslationStatus } from '@/types/translation'

export const useTranslationStore = defineStore('translation', () => {
  const claimTranslations = ref<Map<string, ClaimTranslation>>(new Map())
  const isTranslating = ref(false)
  const progress = ref({ completed: 0, total: 0 })

  function getSentenceTranslation(claimId: string, sentenceId: string): SentenceTranslation | undefined {
    const claimTrans = claimTranslations.value.get(claimId)
    return claimTrans?.sentences.find((s: SentenceTranslation) => s.sentenceId === sentenceId)
  }

  function setSentenceTranslation(claimId: string, sentenceTranslation: SentenceTranslation): void {
    let claimTrans = claimTranslations.value.get(claimId)
    if (!claimTrans) {
      claimTrans = {
        claimId,
        sentences: [],
        overallStatus: 'idle',
      }
      claimTranslations.value.set(claimId, claimTrans)
    }
    const existingIdx = claimTrans.sentences.findIndex((s: SentenceTranslation) => s.sentenceId === sentenceTranslation.sentenceId)
    if (existingIdx >= 0) {
      claimTrans.sentences[existingIdx] = sentenceTranslation
    } else {
      claimTrans.sentences.push(sentenceTranslation)
    }
    updateClaimOverallStatus(claimId)
  }

  function initClaimTranslation(claimId: string, sentenceIds: string[], originalTexts: Record<string, string>): void {
    const sentences: SentenceTranslation[] = sentenceIds.map((sentenceId: string) => ({
      sentenceId,
      originalText: originalTexts[sentenceId] || '',
      translatedText: '',
      status: 'idle',
      error: null,
    }))
    claimTranslations.value.set(claimId, {
      claimId,
      sentences,
      overallStatus: 'idle',
    })
  }

  function updateClaimOverallStatus(claimId: string): void {
    const claimTrans = claimTranslations.value.get(claimId)
    if (!claimTrans) return

    const statuses = claimTrans.sentences.map((s: SentenceTranslation) => s.status)
    if (statuses.every((s: TranslationStatus) => s === 'done')) {
      claimTrans.overallStatus = 'done'
    } else if (statuses.some((s: TranslationStatus) => s === 'loading')) {
      claimTrans.overallStatus = 'loading'
    } else if (statuses.some((s: TranslationStatus) => s === 'error')) {
      claimTrans.overallStatus = 'error'
    } else {
      claimTrans.overallStatus = 'idle'
    }
  }

  function getClaimTranslation(claimId: string): ClaimTranslation | undefined {
    return claimTranslations.value.get(claimId)
  }

  function clearAllTranslations(): void {
    claimTranslations.value.clear()
  }

  function updateTranslatedText(claimId: string, sentenceId: string, newText: string): void {
    const claimTrans = claimTranslations.value.get(claimId)
    if (!claimTrans) return
    const sentence = claimTrans.sentences.find((s: SentenceTranslation) => s.sentenceId === sentenceId)
    if (sentence) {
      sentence.translatedText = newText
    }
  }

  function toJSON(): Record<string, { claimId: string; sentences: SentenceTranslation[]; overallStatus: TranslationStatus }> {
    const result: Record<string, { claimId: string; sentences: SentenceTranslation[]; overallStatus: TranslationStatus }> = {}
    claimTranslations.value.forEach((val, key) => {
      result[key] = val
    })
    return result
  }

  function fromJSON(data: Record<string, { claimId: string; sentences: SentenceTranslation[]; overallStatus: TranslationStatus }>): void {
    const map = new Map<string, ClaimTranslation>()
    for (const [key, val] of Object.entries(data)) {
      // 深拷贝入参：恢复 Tab 快照时与快照切断引用，任一侧原地修改不互相穿透（修复 C）
      map.set(key, JSON.parse(JSON.stringify(val)))
    }
    claimTranslations.value = map
  }

  return {
    claimTranslations,
    isTranslating,
    progress,
    getSentenceTranslation,
    setSentenceTranslation,
    initClaimTranslation,
    getClaimTranslation,
    clearAllTranslations,
    updateTranslatedText,
    toJSON,
    fromJSON,
  }
})
