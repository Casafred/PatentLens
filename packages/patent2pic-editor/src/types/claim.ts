import type { ClaimSource } from './host'
export interface Claim {
  id: string
  index: number
  rawText: string
  sentences: Sentence[]
  source?: ClaimSource
}

export interface Sentence {
  id: string
  text: string
  nodeIds: string[]
  edgeIds: string[]
}
