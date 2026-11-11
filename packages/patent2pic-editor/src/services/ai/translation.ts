import { editorStorage } from '@/services/host/storage'
import type { ChatMessage } from '@/types/ai'
import type { TranslationTargetLanguage } from '@/types/translation'

const TARGET_LANGUAGE_LABELS: Record<TranslationTargetLanguage, string> = {
  'zh-CN': '简体中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'de': 'Deutsch',
  'fr': 'Français',
}

const _translationSystemPrompt =
`你是一个专业的专利翻译助手。请将用户输入的专利文本准确地翻译成{targetLanguage}。

翻译要求：
1. 保持原文的专业性和准确性
2. 遵循专利文献的常用表达方式
3. 术语翻译要一致
4. 只返回翻译结果，不要添加其他说明或解释`

const CUSTOM_PROMPT_STORAGE_KEY = 'patent2pic-translation-prompt'

export function buildTranslationMessages(
  originalText: string,
  targetLanguage: TranslationTargetLanguage,
): ChatMessage[] {
  const langLabel = TARGET_LANGUAGE_LABELS[targetLanguage] || targetLanguage
  const systemContent = getTranslationSystemPrompt().replace('{targetLanguage}', langLabel)
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: originalText },
  ]
}

export function getTranslationSystemPrompt(): string {
  try {
    const stored = editorStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY)
    if (stored) {
      return stored
    }
  } catch {
    // ignore
  }
  return _translationSystemPrompt
}

export function setTranslationSystemPrompt(prompt: string): void {
  try {
    editorStorage.setItem(CUSTOM_PROMPT_STORAGE_KEY, prompt)
  } catch {
    // ignore
  }
}

export function resetTranslationSystemPrompt(): void {
  try {
    editorStorage.removeItem(CUSTOM_PROMPT_STORAGE_KEY)
  } catch {
    // ignore
  }
}
