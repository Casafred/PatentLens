import type { AIProviderType, ChatParams, ChatChunk } from '@/types/ai'
import { getHost } from '@/services/host/bridge'
export async function* streamChat(providerType: AIProviderType, _apiKey: string, _baseUrl: string,
  params: ChatParams, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
  yield* getHost().streamChat(providerType, params, signal)
}
