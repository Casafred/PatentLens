import { getHost } from './bridge'
let values: Record<string, string> = Object.create(null)
let revision = 0
let savedRevision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> = Promise.resolve()
function notify(error?: string): void {
  window.dispatchEvent(new CustomEvent('patent2pic-save-state', { detail: { error, dirty: revision !== savedRevision } }))
}
function schedule(): void {
  revision++
  notify()
  clearTimeout(timer)
  timer = setTimeout(() => { void flushStorage().catch(() => {}) }, 600)
}
export const editorStorage = {
  getItem(key: string): string | null { return values[key] ?? null },
  setItem(key: string, value: string): void {
    if (values[key] === value) return
    values[key] = value
    schedule()
  },
  removeItem(key: string): void {
    if (!(key in values)) return
    delete values[key]
    schedule()
  },
}
export async function initializeStorage(): Promise<boolean> {
  const result = await getHost().loadStorage()
  values = Object.assign(Object.create(null), result.values)
  return result.recovered
}
export async function flushStorage(): Promise<void> {
  clearTimeout(timer)
  const operation = pending.catch(() => {}).then(async () => {
    while (revision !== savedRevision) {
      const target = revision
      const result = await getHost().saveStorage({ ...values })
      if (!result.ok) throw new Error('成图项目保存失败，请重试或导出 .p2p 备份')
      savedRevision = target
    }
    notify()
  })
  pending = operation
  try { await operation }
  catch (error) { notify(error instanceof Error ? error.message : '成图项目保存失败'); throw error }
}
