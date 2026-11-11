<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAIStore } from '@/stores/ai'
import { useGraphStore } from '@/stores/graph'
import AIConfigDialog from '../ai/AIConfigDialog.vue'
const aiStore = useAIStore()
const graphStore = useGraphStore()
const showSettings = ref(false)
const source = computed(() => {
  const file = graphStore.activeFile
  return file?.claims.find(claim => claim.id === (file.claimId || file.activeClaimId))?.source
})
function refresh(): void { aiStore.refreshProfiles() }
onMounted(() => { window.addEventListener('focus', refresh); window.addEventListener('patent2pic-ai-config-changed', refresh) })
onUnmounted(() => { window.removeEventListener('focus', refresh); window.removeEventListener('patent2pic-ai-config-changed', refresh) })
</script>
<template>
  <div class="title-bar">
    <strong>Patent2Pic</strong>
    <span v-if="source" class="source" :title="source.title">{{ source.publicationNumber }} · 权利要求 {{ source.sourceClaimNumber }} · {{ source.source }}</span>
    <span v-else class="source">粘贴权利要求，或从专利详情页导入</span>
    <span class="model">{{ aiStore.activeModel || '尚未配置 AI 模型' }}{{ aiStore.followsHost ? ' · 继承 PatentLens' : '' }}</span>
    <el-button size="small" @click="showSettings = true">模型 / 提示词 / 日志</el-button>
  </div>
  <AIConfigDialog v-model:visible="showSettings" />
</template>
<style scoped>
.title-bar { height:44px; display:flex; align-items:center; gap:16px; padding:0 16px; border-bottom:1px solid #dce3ee; background:#fff; }
.source { flex:1; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.model { color:#62738b; font-size:12px; }
</style>
