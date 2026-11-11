const PREFIX = '[⏱ Timing]'

const enabled = true

interface TimingEntry {
  label: string
  start: number
}

const entries = new Map<string, TimingEntry>()

export function timingStart(label: string): void {
  if (!enabled) return
  entries.set(label, { label, start: performance.now() })
  console.log(`${PREFIX} ▶ ${label}`)
}

export function timingEnd(label: string): number {
  if (!enabled) return 0
  const entry = entries.get(label)
  if (!entry) {
    console.warn(`${PREFIX} ⚠ 未找到计时起点: ${label}`)
    return 0
  }
  entries.delete(label)
  const elapsed = performance.now() - entry.start
  const elapsedStr = formatDuration(elapsed)
  console.log(`${PREFIX} ✓ ${label} — ${elapsedStr}`)
  return elapsed
}

export function timingLap(label: string, groupLabel: string): number {
  if (!enabled) return 0
  const entry = entries.get(groupLabel)
  if (!entry) {
    console.warn(`${PREFIX} ⚠ 未找到分组计时起点: ${groupLabel}`)
    return 0
  }
  const elapsed = performance.now() - entry.start
  const elapsedStr = formatDuration(elapsed)
  console.log(`${PREFIX}   ↳ ${label} — ${elapsedStr}`)
  return elapsed
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(1)
  return `${minutes}m ${seconds}s`
}