import type { Claim, Sentence } from '@/types/claim'

const CLAIM_NUMBER_REGEX = /(?:^|\n)\s*(\d+)\s*[.、．]\s*/g

const SENTENCE_SPLIT_CHARS = new Set('。；;，,！!？?：:、'.split(''))

// 分析会话计数器：两次分析的 claimId/sentenceId 落入不同命名空间，
// 避免翻译 store 的 Map<claimId> 与 updateClaimSentences 跨分析串扰
let claimSessionCounter = 0

export function newClaimSessionId(): number {
  return ++claimSessionCounter
}

export function parseClaims(rawText: string, sessionId?: number, previousClaims: Claim[] = []): Claim[] {
  const trimmed = rawText.trim()
  if (!trimmed) return []

  // Structured imports are already separated by PatentLens. Numbered method
  // steps inside a claim must not be mistaken for additional claim boundaries.
  if (previousClaims.length && previousClaims.every(claim => claim.source)) {
    const expected = previousClaims.map(claim => `${claim.index}. ${claim.rawText}`).join('\n\n')
    if (trimmed === expected.trim()) return previousClaims.map((claim, index) => ({
      ...parseSingleClaim(claim.rawText, claim.index, sessionId ? `claim-${sessionId}-${index + 1}` : claim.id),
      source: claim.source,
    }))
  }

  const segments = splitByClaimNumbers(trimmed)

  return segments.map((segment, index) => {
    const text = segment.text
    const claimNumber = segment.number ?? index + 1
    const previous = previousClaims.find(claim => claim.index === claimNumber)
    // 输入期不传 sessionId（保持 claim-N 稳定格式）；分析入口传入新 sessionId
    const id = sessionId ? `claim-${sessionId}-${index + 1}` : `claim-${index + 1}`
    return {
      id,
      index: claimNumber,
      rawText: text.trim(),
      sentences: splitSentences(text.trim(), id),
      ...(previous?.source ? { source: previous.source } : {}),
    }
  })
}

export function parseSingleClaim(text: string, index: number, id: string): Claim {
  return { id, index, rawText: text, sentences: splitSentences(text, id) }
}

function splitByClaimNumbers(text: string): Array<{ text: string; number?: number }> {
  const matches = [...text.matchAll(CLAIM_NUMBER_REGEX)]

  if (matches.length === 0) {
    return [{ text }]
  }

  const segments: Array<{ text: string; number: number }> = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    segments.push({ text: text.slice(start, end).trim(), number: Number(matches[i][1]) })
  }

  return segments.filter(segment => segment.text.length > 0)
}

function isSplitAtPosition(text: string, index: number): boolean {
  const ch = text[index]
  if (!SENTENCE_SPLIT_CHARS.has(ch)) {
    if (ch === '.' && (index + 1 === text.length || /\s/.test(text[index + 1]))) {
      return true
    }
    return false
  }
  let depth = 0
  for (let i = 0; i < index; i++) {
    const c = text[i]
    if (c === '(' || c === '（' || c === '[' || c === '【') depth++
    else if (c === ')' || c === '）' || c === ']' || c === '】') depth--
  }
  return depth === 0
}

function findNextSplit(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (isSplitAtPosition(text, i)) {
      return i
    }
  }
  return -1
}

function splitSentences(claimText: string, claimId: string): Sentence[] {
  const parts: string[] = []
  let remaining = claimText

  while (remaining.length > 0) {
    const splitPos = findNextSplit(remaining)
    if (splitPos === -1) {
      if (remaining.trim().length > 0) {
        parts.push(remaining.trim())
      }
      break
    }

    const splitEnd = splitPos + 1
    const part = remaining.slice(0, splitEnd).trim()
    if (part.length > 0) {
      parts.push(part)
    }
    remaining = remaining.slice(splitEnd)
  }

  // 句子 ID 挂在 claimId 之下（claimId 含 sessionId 时句子 ID 同样全局唯一）
  return parts.map((text, index) => ({
    id: `${claimId}-sent-${index + 1}`,
    text,
    nodeIds: [],
    edgeIds: [],
  }))
}

export function getClaimPreview(claim: Claim): string {
  const firstSentence = claim.sentences[0]?.text || ''
  if (firstSentence.length > 60) {
    return firstSentence.slice(0, 60) + '...'
  }
  return firstSentence
}
