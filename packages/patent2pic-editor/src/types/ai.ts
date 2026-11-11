export type AIProviderType = 'openai' | 'zhipu' | 'deepseek' | 'custom'

export interface AIProviderConfig {
  type: AIProviderType
  name: string
  apiKey: string
  baseUrl: string
  models: AIModelConfig[]
  defaultModel: string
}

export interface AIModelConfig {
  id: string
  name: string
  enabled: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatParams {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  responseFormat?: { type: 'json_object' } | { type: 'text' }
  thinking?: { type: 'enabled' | 'disabled'; budgetTokens?: number }
  reasoningEffort?: 'high' | 'max'
  topP?: number
  userId?: string
  streamOptions?: { includeUsage?: boolean }
}

export interface ChatChunk {
  content: string
  reasoningContent?: string
  done: boolean
  usage?: ChatUsage
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  reasoningTokens?: number
}

export type SemanticLayer = 'structure' | 'process' | 'logic'

export interface ExtractFrame {
  index: number
  title: string
  type: SemanticLayer
  narration?: string
  highlightNodeIds: string[]
  highlightEdgeIds: string[]
  claimSpan?: [number, number]
}

export interface ExtractResult {
  claimType: 'structure' | 'method' | 'mixed'
  claimId: string
  nodes: ExtractNode[]
  edges: ExtractEdge[]
  groups: ExtractGroup[]
  translatedClaim: string
  sentencePairs: SentencePair[]
  frames?: ExtractFrame[]
  /** AI 重构摘要（仅重构链路产出）：说明本次做了哪些修改与取舍 */
  changes?: string[]
}

export interface SentencePair {
  original: string
  translation: string
}

export interface ExtractNode {
  id: string
  originalText: string
  chineseText: string
  nodeType: 'component' | 'subsystem' | 'feature' | 'step' | 'decision' | 'condition'
  hierarchyLevel: number
  sourceSentence: string
}

export interface ExtractEdge {
  id: string
  source: string
  target: string
  originalText: string
  chineseText: string
  relationType: 'position' | 'action' | 'containment' | 'logical' | 'attribute'
    | 'sequence' | 'branch_true' | 'branch_false' | 'trigger' | 'feedback' | 'parallel'
}

export interface ExtractGroup {
  id: string
  label: { original: string; chinese: string }
  memberNodeIds: string[]
}

export interface ConnectionTestResult {
  success: boolean
  message: string
  latency?: number
  modelInfo?: string
}
