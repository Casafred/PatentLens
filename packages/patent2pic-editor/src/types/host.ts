import type { AIProviderType, ChatParams, ChatChunk } from './ai'
export interface HostProfile {
  type: AIProviderType
  name: string
  model: string
  models: string[]
  configured: boolean
}
export interface HostAIConfig { currentProvider: AIProviderType; profiles: HostProfile[] }
export interface ClaimSource {
  publicationNumber: string
  title: string
  language: string
  source: string
  sourceUrl?: string
  documentId?: string
  sourceClaimNumber: string
  originalText: string
  claimType: string
}
export interface LaunchRequest { schemaVersion: 1; requestId: string; claims: ClaimSource[] }
export interface EditorController {
  launch(request: LaunchRequest): Promise<void>
  save(): Promise<void>
  isBusy(): boolean
  openRecord(target: { projectId: string; fileId: string; versionId?: string; claimId?: string }): Promise<void>
}
export interface PatentLensHost {
  getAIConfig(): HostAIConfig
  streamChat(provider: AIProviderType, params: ChatParams, signal?: AbortSignal): AsyncGenerator<ChatChunk>
  openAISettings(): void
  loadStorage(): Promise<{ values: Record<string, string>; recovered: boolean }>
  saveStorage(values: Record<string, string>): Promise<{ ok: boolean }>
  ready(controller: EditorController): void
}
declare global { interface Window { Patent2PicHost?: PatentLensHost } }
