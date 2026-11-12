<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import TitleBar from './components/layout/TitleBar.vue'
import AppLayout from './components/layout/AppLayout.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHostIntegration } from '@/composables/useHostIntegration'
import { useAIStore } from '@/stores/ai'

defineProps<{ recovered: boolean }>()
const workspace = useWorkspaceStore()
const integration = useHostIntegration()
const ai = useAIStore()
const saveError = ref('')
const saving = ref(false)
let interval: ReturnType<typeof setInterval> | undefined
function onSaveState(event: Event): void {
  const detail: { error?: string; dirty?: boolean } = (event as CustomEvent).detail
  saveError.value = detail.error || ''
  saving.value = !!detail.dirty
}
async function save(): Promise<void> {
  try { await integration.save(); saveError.value = '' }
  catch (error) { saveError.value = error instanceof Error ? error.message : '项目保存失败' }
}
watch(() => ai.isExtracting, (running) => { if (!running) void save() }, { flush: 'post' })
onMounted(async () => {
  window.addEventListener('patent2pic-save-state', onSaveState)
  workspace.initWorkspace()
  await nextTick()
  integration.connect()
  interval = setInterval(() => { void save() }, 5000)
})
onUnmounted(() => { clearInterval(interval); window.removeEventListener('patent2pic-save-state', onSaveState) })
</script>
<template>
  <div class="app-container">
    <TitleBar />
    <div v-if="recovered" class="recovery">已从上次备份恢复工作区，请检查最近编辑并保存。</div>
    <div v-if="saveError" class="save-error" role="alert">{{ saveError }} <el-button size="small" @click="save">重试保存</el-button></div>
    <div class="app-body"><AppLayout /></div>
    <div class="save-status">{{ saveError ? '保存失败 · 请重试或导出 .p2p 备份' : saving ? '正在保存…' : '项目已保存到本机' }}</div>
  </div>
</template>
<style scoped>
.app-container { display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--bg-primary); }
.app-body { flex:1; overflow:hidden; min-height:0; }
.save-status { height:24px; font-size:11px; padding:4px 16px; border-top:1px solid #dce3ee; color:#64748b; background:white; }
.save-error { padding:8px 16px; color:#9b2626; background:#fff0f0; }
.recovery { padding:8px 16px; background:#fff7d6; color:#715415; }
</style>
