import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './assets/styles/global.css'
import './assets/styles/theme.css'
import { initializeStorage } from '@/services/host/storage'
async function start(): Promise<void> {
  const recovered = await initializeStorage()
  // Prompt modules and stores read storage during import, so hydrate first.
  const { default: App } = await import('./App.vue')
  createApp(App, { recovered }).use(createPinia()).use(ElementPlus).mount('#app')
}
void start().catch((error: unknown) => {
  const host = document.getElementById('app')
  if (host) { host.textContent = error instanceof Error ? error.message : '成图工作台启动失败'; host.style.padding = '32px' }
})
