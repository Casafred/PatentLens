import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AIProviderType, ConnectionTestResult } from '@/types/ai'
import type { TranslationTargetLanguage } from '@/types/translation'
import { editorStorage } from '@/services/host/storage'
import { getHost } from '@/services/host/bridge'

export interface TranslationConfig {
  enabled: boolean
  useSeparateModel: boolean
  providerType: AIProviderType
  model: string
  targetLanguage: TranslationTargetLanguage
  autoTranslate: boolean
}
export interface ExtractLog {
  id: string
  timestamp: string
  provider: AIProviderType
  model: string
  status: 'success' | 'error'
  rawResponse: string
  errorMessage?: string
  claimPreview: string
  durationMs: number
}
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(editorStorage.getItem(key) || 'null') ?? fallback }
  catch { return fallback }
}
export const useAIStore = defineStore('ai', () => {
  const hostConfig = ref(getHost().getAIConfig())
  const selection = ref(read<{ providerType: AIProviderType | null; model: string }>('patent2pic-model-selection', { providerType: null, model: '' }))
  const followsHost = computed(() => !selection.value.providerType)
  const activeProviderType = computed<AIProviderType>(() => selection.value.providerType || hostConfig.value.currentProvider)
  const profiles = computed(() => hostConfig.value.profiles)
  // No credential is copied into the editor; these compatibility fields are status flags.
  const providers = computed(() => Object.fromEntries(profiles.value.map(profile => [profile.type, {
    apiKey: profile.configured ? 'host-managed' : '', baseUrl: '', models: profile.models,
    defaultModel: selection.value.providerType === profile.type && selection.value.model ? selection.value.model : profile.model,
  }])))
  const activeProvider = computed(() => providers.value[activeProviderType.value])
  const activeApiKey = computed(() => activeProvider.value?.apiKey || '')
  const activeBaseUrl = computed(() => '')
  const activeModel = computed(() => activeProvider.value?.defaultModel || '')
  const activeModels = computed(() => activeProvider.value?.models || [])
  const translationConfig = ref<TranslationConfig>(read('patent2pic-translation-config', {
    enabled: false, useSeparateModel: false, providerType: 'zhipu', model: '', targetLanguage: 'zh-CN', autoTranslate: true,
  }))
  const translationProvider = computed(() => translationConfig.value.useSeparateModel
    ? providers.value[translationConfig.value.providerType] : activeProvider.value)
  const translationApiKey = computed(() => translationProvider.value?.apiKey || '')
  const translationBaseUrl = computed(() => '')
  const translationModel = computed(() => translationConfig.value.useSeparateModel && translationConfig.value.model
    ? translationConfig.value.model : translationProvider.value?.defaultModel || '')
  const translationModels = computed(() => translationProvider.value?.models || [])
  const isExtracting = ref(false)
  const extractError = ref<string | null>(null)
  const extractStreamContent = ref('')
  const isTesting = ref(false)
  const testResult = ref<ConnectionTestResult | null>(null)
  const extractLogs = ref<ExtractLog[]>(read('patent2pic-extract-logs', []))
  function persistSelection(): void { editorStorage.setItem('patent2pic-model-selection', JSON.stringify(selection.value)) }
  function refreshProfiles(): void { hostConfig.value = getHost().getAIConfig() }
  function followHost(): void { selection.value = { providerType: null, model: '' }; refreshProfiles(); persistSelection() }
  function setActiveProvider(type: AIProviderType): void { selection.value = { providerType: type, model: '' }; persistSelection() }
  function updateDefaultModel(type: AIProviderType, model: string): void { selection.value = { providerType: type, model }; persistSelection() }
  function addExtractLog(log: Omit<ExtractLog, 'id' | 'timestamp'>): void {
    extractLogs.value = [{ ...log, id: crypto.randomUUID(), timestamp: new Date().toLocaleString('zh-CN') }, ...extractLogs.value].slice(0, 50)
    editorStorage.setItem('patent2pic-extract-logs', JSON.stringify(extractLogs.value))
  }
  function clearExtractLogs(): void { extractLogs.value = []; editorStorage.setItem('patent2pic-extract-logs', '[]') }
  function updateTranslationConfig(partial: Partial<TranslationConfig>): void {
    translationConfig.value = { ...translationConfig.value, ...partial }
    editorStorage.setItem('patent2pic-translation-config', JSON.stringify(translationConfig.value))
  }
  return { profiles, followsHost, followHost, refreshProfiles, activeProviderType, providers, activeProvider, activeApiKey, activeBaseUrl,
    activeModel, activeModels, translationConfig, translationProvider, translationApiKey, translationBaseUrl, translationModel, translationModels,
    isExtracting, extractError, extractStreamContent, isTesting, testResult, extractLogs, setActiveProvider, updateDefaultModel,
    addExtractLog, clearExtractLogs, updateTranslationConfig }
})
