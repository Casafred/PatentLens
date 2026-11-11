import type { Sentence } from '@/types/claim'
import type { SentenceTranslation } from '@/types/translation'

const STRONG_SPLIT_CHARS = new Set('。；;！!？?'.split(''))
const WEAK_SPLIT_CHARS = new Set('，,：:、'.split(''))

interface SplitResult {
  text: string
  endChar: string
}

function splitByPunctuation(text: string, strongOnly: boolean = false): SplitResult[] {
  const parts: SplitResult[] = []
  let remaining = text

  while (remaining.length > 0) {
    let splitPos = -1
    let splitChar = ''

    for (let i = 0; i < remaining.length; i++) {
      const ch = remaining[i]
      if (STRONG_SPLIT_CHARS.has(ch)) {
        splitPos = i
        splitChar = ch
        break
      }
      if (!strongOnly && WEAK_SPLIT_CHARS.has(ch)) {
        let depth = 0
        for (let j = 0; j < i; j++) {
          const c = remaining[j]
          if (c === '(' || c === '（' || c === '[' || c === '【') depth++
          else if (c === ')' || c === '）' || c === ']' || c === '】') depth--
        }
        if (depth === 0) {
          splitPos = i
          splitChar = ch
          break
        }
      }
      if (!strongOnly && ch === '.' && (i + 1 === remaining.length || /\s/.test(remaining[i + 1]))) {
        splitPos = i
        splitChar = ch
        break
      }
    }

    if (splitPos === -1) {
      if (remaining.trim().length > 0) {
        parts.push({ text: remaining.trim(), endChar: '' })
      }
      break
    }

    const part = remaining.slice(0, splitPos + 1).trim()
    if (part.length > 0) {
      parts.push({ text: part, endChar: splitChar })
    }
    remaining = remaining.slice(splitPos + 1)
  }

  return parts
}

export function alignTranslationToSentences(
  originalClaimText: string,
  translatedClaim: string,
  sentences: Sentence[],
): SentenceTranslation[] {
  if (!translatedClaim || !originalClaimText) {
    return sentences.map(s => ({
      sentenceId: s.id,
      originalText: s.text,
      translatedText: '',
      status: 'idle' as const,
      error: null,
    }))
  }

  const originalParts = splitByPunctuation(originalClaimText)
  const translatedParts = splitByPunctuation(translatedClaim)

  if (originalParts.length === translatedParts.length) {
    return alignDirect(sentences, originalParts, translatedParts)
  }

  const originalStrong = splitByPunctuation(originalClaimText, true)
  const translatedStrong = splitByPunctuation(translatedClaim, true)

  if (originalStrong.length === translatedStrong.length && originalStrong.length > 0) {
    return alignWithMerge(sentences, originalParts, translatedParts, originalStrong, translatedStrong)
  }

  return alignByRatio(sentences, translatedClaim)
}

function alignDirect(
  sentences: Sentence[],
  originalParts: SplitResult[],
  translatedParts: SplitResult[],
): SentenceTranslation[] {
  const sentenceTranslations: SentenceTranslation[] = []
  let partIdx = 0

  for (const sentence of sentences) {
    let matchedTranslation = ''
    let accumulatedOriginal = ''

    while (partIdx < originalParts.length) {
      accumulatedOriginal = accumulatedOriginal
        ? accumulatedOriginal + originalParts[partIdx].text
        : originalParts[partIdx].text

      const translatedText = translatedParts[partIdx]?.text || ''
      matchedTranslation = matchedTranslation
        ? matchedTranslation + translatedText
        : translatedText

      partIdx++

      if (isSentenceComplete(sentence.text, accumulatedOriginal)) {
        break
      }
    }

    sentenceTranslations.push({
      sentenceId: sentence.id,
      originalText: sentence.text,
      translatedText: matchedTranslation.trim(),
      status: 'done',
      error: null,
    })
  }

  return sentenceTranslations
}

function alignWithMerge(
  sentences: Sentence[],
  _originalParts: SplitResult[],
  translatedParts: SplitResult[],
  _originalStrong: SplitResult[],
  _translatedStrong: SplitResult[],
): SentenceTranslation[] {
  return alignByRatio(sentences, translatedParts.map(p => p.text).join(''))
}

function alignByRatio(
  sentences: Sentence[],
  translatedClaim: string,
): SentenceTranslation[] {
  const totalOriginalLength = sentences.reduce((sum, s) => sum + s.text.length, 0)
  if (totalOriginalLength === 0) {
    return sentences.map(s => ({
      sentenceId: s.id,
      originalText: s.text,
      translatedText: '',
      status: 'idle' as const,
      error: null,
    }))
  }

  let translatedOffset = 0
  return sentences.map((sentence) => {
    const ratio = sentence.text.length / totalOriginalLength
    const translatedLength = Math.round(ratio * translatedClaim.length)
    const translatedText = translatedClaim.slice(translatedOffset, translatedOffset + translatedLength).trim()
    translatedOffset += translatedLength

    return {
      sentenceId: sentence.id,
      originalText: sentence.text,
      translatedText,
      status: 'done' as const,
      error: null,
    }
  })
}

function isSentenceComplete(sentenceText: string, accumulatedOriginal: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, '').replace(/[（）()【】\[\]]/g, '')
  return normalize(accumulatedOriginal).length >= normalize(sentenceText).length
}
