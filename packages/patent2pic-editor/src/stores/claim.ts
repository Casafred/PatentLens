import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useGraphStore } from '@/stores/graph'
import type { Claim, Sentence } from '@/types/claim'

/**
 * 输入状态 store：rawText / claims / activeClaimId 是"活动画布文件"的投影，
 * 读写直接落到 CanvasFile 上——切换文件即切换输入上下文，不再需要快照/恢复。
 */
export const useClaimStore = defineStore('claim', () => {
  const graphStore = useGraphStore()

  /** 应用级输入历史（跨文件共享，不归属单个文件） */
  const history = ref<string[]>([])
  const isInputCollapsed = ref(false)

  const rawText = computed<string>({
    get: () => graphStore.activeFile?.rawText ?? '',
    set: (text: string) => {
      const file = graphStore.activeFile
      if (file) {
        file.rawText = text
      }
    },
  })

  const claims = computed<Claim[]>({
    get: () => graphStore.activeFile?.claims ?? [],
    set: (parsed: Claim[]) => {
      const file = graphStore.activeFile
      if (!file) return
      // 深拷贝入参：与调用方切断引用，任一侧原地修改不互相穿透
      file.claims = parsed ? JSON.parse(JSON.stringify(parsed)) : []
      if (parsed.length > 0) {
        // 始终保证 activeClaimId 指向存在的权利要求
        const activeExists = parsed.some(c => c.id === file.activeClaimId)
        if (!activeExists) {
          file.activeClaimId = parsed[0].id
        }
      }
    },
  })

  const activeClaimId = computed<string | null>({
    get: () => graphStore.activeFile?.activeClaimId ?? null,
    set: (id: string | null) => {
      const file = graphStore.activeFile
      if (file) {
        file.activeClaimId = id
      }
    },
  })

  function setText(text: string): void {
    rawText.value = text
    if (text && !history.value.includes(text)) {
      history.value = [text, ...history.value].slice(0, 20)
    }
  }

  function setClaims(parsed: Claim[]): void {
    claims.value = parsed
  }

  function setActiveClaim(id: string | null): void {
    activeClaimId.value = id
  }

  function getActiveClaim(): Claim | undefined {
    const file = graphStore.activeFile
    if (!file) return undefined
    return file.claims.find(c => c.id === file.activeClaimId)
  }

  function collapseInput(): void {
    isInputCollapsed.value = true
  }

  function expandInput(): void {
    isInputCollapsed.value = false
  }

  function updateClaimSentences(claimId: string, sentences: Sentence[]): void {
    const file = graphStore.activeFile
    const claim = file?.claims.find(c => c.id === claimId)
    if (claim) {
      claim.sentences = sentences
    }
  }

  return {
    rawText,
    claims,
    activeClaimId,
    history,
    isInputCollapsed,
    setText,
    setClaims,
    setActiveClaim,
    getActiveClaim,
    collapseInput,
    expandInput,
    updateClaimSentences,
  }
})
