export type TranslationStatus = 'idle' | 'loading' | 'done' | 'error'

export type TranslationTargetLanguage = 'zh-CN' | 'en' | 'ja' | 'ko' | 'de' | 'fr'

export interface SentenceTranslation {
  sentenceId: string
  originalText: string
  translatedText: string
  status: TranslationStatus
  error: string | null
}

export interface ClaimTranslation {
  claimId: string
  sentences: SentenceTranslation[]
  overallStatus: TranslationStatus
}
