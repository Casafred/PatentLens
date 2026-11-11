import type { ChatParams, ChatChunk, AIProviderType } from '@/types/ai'

export interface AIProviderAdapter {
  readonly type: AIProviderType
  chat(params: ChatParams): AsyncGenerator<ChatChunk>
  testConnection(apiKey: string, baseUrl: string, model: string): Promise<{ success: boolean; message: string; latency?: number }>
}
