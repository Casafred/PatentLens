import { editorStorage } from '@/services/host/storage'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExtractFrame } from '@/types/ai'

const ANIMATION_MODE_STORAGE_KEY = 'patent2pic-animation-mode'

function loadAnimationMode(): boolean {
  try {
    const raw = editorStorage.getItem(ANIMATION_MODE_STORAGE_KEY)
    if (raw === null) return true
    return raw !== 'false'
  } catch {
    return true
  }
}

function saveAnimationMode(enabled: boolean): void {
  try {
    editorStorage.setItem(ANIMATION_MODE_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // ignore
  }
}

export const usePlaybackStore = defineStore('playback', () => {
  const frames = ref<ExtractFrame[]>([])
  const currentFrameIndex = ref(0)
  const isPlaying = ref(false)
  const playbackSpeed = ref(1)
  const animationEnabled = ref(true)
  // 动画模式：生成时开启则播放分步动画，关闭则直接展示完整图
  const animationMode = ref(loadAnimationMode())
  let playbackTimer: ReturnType<typeof setTimeout> | null = null

  const hasFrames = computed(() => frames.value.length > 0)
  const totalFrames = computed(() => frames.value.length)
  const currentFrame = computed(() => {
    if (frames.value.length === 0) return null
    return frames.value[Math.min(currentFrameIndex.value, frames.value.length - 1)]
  })
  const progress = computed(() => {
    if (frames.value.length <= 1) return 0
    return currentFrameIndex.value / (frames.value.length - 1)
  })
  const canGoPrev = computed(() => currentFrameIndex.value > 0)
  const canGoNext = computed(() => currentFrameIndex.value < frames.value.length - 1)
  const isFirstFrame = computed(() => currentFrameIndex.value === 0)
  const isLastFrame = computed(() => currentFrameIndex.value === frames.value.length - 1)

  function setFrames(newFrames: ExtractFrame[]): void {
    stop()
    frames.value = newFrames || []
    currentFrameIndex.value = 0
  }

  function clearFrames(): void {
    stop()
    frames.value = []
    currentFrameIndex.value = 0
  }

  function goToFrame(index: number): void {
    if (frames.value.length === 0) return
    const clamped = Math.max(0, Math.min(index, frames.value.length - 1))
    currentFrameIndex.value = clamped
  }

  function nextFrame(): void {
    if (!canGoNext.value) {
      stop()
      return
    }
    currentFrameIndex.value++
  }

  function prevFrame(): void {
    if (canGoPrev.value) {
      currentFrameIndex.value--
    }
  }

  function goToStart(): void {
    stop()
    currentFrameIndex.value = 0
  }

  function goToEnd(): void {
    stop()
    currentFrameIndex.value = frames.value.length - 1
  }

  function play(): void {
    if (frames.value.length === 0) return
    if (isLastFrame.value) {
      currentFrameIndex.value = 0
    }
    isPlaying.value = true
    scheduleNextFrame()
  }

  function pause(): void {
    isPlaying.value = false
    if (playbackTimer) {
      clearTimeout(playbackTimer)
      playbackTimer = null
    }
  }

  function stop(): void {
    pause()
  }

  function togglePlay(): void {
    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  function scheduleNextFrame(): void {
    if (!isPlaying.value) return
    const delay = 2500 / playbackSpeed.value
    playbackTimer = setTimeout(() => {
      if (isLastFrame.value) {
        pause()
        return
      }
      nextFrame()
      scheduleNextFrame()
    }, delay)
  }

  function setSpeed(speed: number): void {
    playbackSpeed.value = Math.max(0.25, Math.min(3, speed))
  }

  function setAnimationEnabled(enabled: boolean): void {
    animationEnabled.value = enabled
  }

  function setAnimationMode(enabled: boolean): void {
    animationMode.value = enabled
    saveAnimationMode(enabled)
  }

  return {
    frames,
    currentFrameIndex,
    isPlaying,
    playbackSpeed,
    animationEnabled,
    animationMode,
    hasFrames,
    totalFrames,
    currentFrame,
    progress,
    canGoPrev,
    canGoNext,
    isFirstFrame,
    isLastFrame,
    setFrames,
    clearFrames,
    goToFrame,
    nextFrame,
    prevFrame,
    goToStart,
    goToEnd,
    play,
    pause,
    stop,
    togglePlay,
    setSpeed,
    setAnimationEnabled,
    setAnimationMode,
  }
})
