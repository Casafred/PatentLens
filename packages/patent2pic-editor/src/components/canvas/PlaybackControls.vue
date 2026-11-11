<template>
  <div v-if="playback.hasFrames" class="playback-controls">
    <div class="playback-bar">
      <div class="frame-info">
        <span class="frame-badge" :class="`badge-${currentFrame?.type || 'structure'}`">
          {{ frameTypeLabel }}
        </span>
        <span class="frame-title">{{ currentFrame?.title || '整体结构' }}</span>
        <span class="frame-counter">{{ playback.currentFrameIndex + 1 }} / {{ playback.totalFrames }}</span>
      </div>

      <div class="controls">
        <el-tooltip content="回到开始" placement="top">
          <button class="ctrl-btn" @click="handleGoToStart" :disabled="playback.isFirstFrame">
            <span class="ctrl-icon">⏮</span>
          </button>
        </el-tooltip>
        <el-tooltip content="上一帧" placement="top">
          <button class="ctrl-btn" @click="handlePrevFrame" :disabled="!playback.canGoPrev">
            <span class="ctrl-icon">◀</span>
          </button>
        </el-tooltip>
        <el-tooltip :content="playback.isPlaying ? '暂停' : '播放'" placement="top">
          <button class="ctrl-btn play-btn" @click="handleTogglePlay">
            <span class="ctrl-icon">{{ playback.isPlaying ? '⏸' : '▶' }}</span>
          </button>
        </el-tooltip>
        <el-tooltip content="下一帧" placement="top">
          <button class="ctrl-btn" @click="handleNextFrame" :disabled="!playback.canGoNext">
            <span class="ctrl-icon">▶</span>
          </button>
        </el-tooltip>
        <el-tooltip content="跳到最后" placement="top">
          <button class="ctrl-btn" @click="handleGoToEnd" :disabled="playback.isLastFrame">
            <span class="ctrl-icon">⏭</span>
          </button>
        </el-tooltip>
      </div>

      <div class="progress-container">
        <div class="progress-track" @click="handleProgressClick">
          <div class="progress-fill" :style="{ width: `${playback.progress * 100}%` }" />
          <div
            v-for="(frame, idx) in playback.frames"
            :key="frame.index"
            class="progress-dot"
            :class="{ active: idx === playback.currentFrameIndex, passed: idx < playback.currentFrameIndex }"
            :style="{ left: `${(idx / Math.max(1, playback.totalFrames - 1)) * 100}%` }"
            :title="frame.title"
            @click.stop="handleGoToFrame(idx)"
          />
        </div>
      </div>

      <div class="speed-control">
        <el-dropdown trigger="click" @command="handleSpeedChange">
          <button class="speed-btn">
            {{ playback.playbackSpeed }}x
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="0.5">0.5x</el-dropdown-item>
              <el-dropdown-item command="1">1x</el-dropdown-item>
              <el-dropdown-item command="1.5">1.5x</el-dropdown-item>
              <el-dropdown-item command="2">2x</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div v-if="currentFrame?.narration" class="narration-bar">
      <span class="narration-text">{{ currentFrame.narration }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { usePlaybackStore } from '@/stores/playback'
import { graphEngine } from '@/services/graph/engine'

const playback = usePlaybackStore()

const currentFrame = computed(() => playback.currentFrame)

const frameTypeLabel = computed(() => {
  const type = currentFrame.value?.type || 'structure'
  switch (type) {
    case 'process': return '过程'
    case 'logic': return '逻辑'
    default: return '结构'
  }
})

watch(() => playback.currentFrameIndex, (newIdx) => {
  if (playback.hasFrames) {
    graphEngine.applyFrame(newIdx, playback.animationEnabled)
  }
}, { immediate: false })

function handlePrevFrame(): void {
  playback.pause()
  playback.prevFrame()
}

function handleNextFrame(): void {
  playback.pause()
  playback.nextFrame()
}

function handleTogglePlay(): void {
  playback.togglePlay()
}

function handleGoToStart(): void {
  playback.goToStart()
}

function handleGoToEnd(): void {
  playback.goToEnd()
}

function handleGoToFrame(idx: number): void {
  playback.pause()
  playback.goToFrame(idx)
}

function handleSpeedChange(speed: string): void {
  playback.setSpeed(Number(speed))
}

function handleProgressClick(e: MouseEvent): void {
  const track = e.currentTarget as HTMLElement
  const rect = track.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const frameIdx = Math.round(ratio * (playback.totalFrames - 1))
  handleGoToFrame(frameIdx)
}
</script>

<style scoped>
.playback-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.95) 70%, rgba(255,255,255,0) 100%);
  padding: 20px 16px 12px;
  pointer-events: none;
}

.playback-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border-radius: 12px;
  padding: 8px 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  pointer-events: auto;
}

.frame-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  flex-shrink: 0;
}

.frame-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-structure {
  background: #e6f7ff;
  color: #1890ff;
}

.badge-process {
  background: #f6ffed;
  color: #52c41a;
}

.badge-logic {
  background: #fff7e6;
  color: #fa8c16;
}

.frame-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.frame-counter {
  font-size: 11px;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ctrl-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  color: #4b5563;
}

.ctrl-btn:hover:not(:disabled) {
  background: #f3f4f6;
  color: #1890ff;
}

.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.ctrl-icon {
  font-size: 12px;
  line-height: 1;
}

.play-btn {
  background: #1890ff !important;
  color: white !important;
  width: 38px;
  height: 38px;
  border-radius: 50%;
}

.play-btn:hover:not(:disabled) {
  background: #40a9ff !important;
  transform: scale(1.05);
}

.play-btn .ctrl-icon {
  font-size: 14px;
}

.progress-container {
  flex: 1;
  padding: 0 8px;
}

.progress-track {
  position: relative;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  cursor: pointer;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, #1890ff, #40a9ff);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-dot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #d1d5db;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 1;
}

.progress-dot:hover {
  border-color: #1890ff;
  transform: translate(-50%, -50%) scale(1.2);
}

.progress-dot.passed {
  border-color: #1890ff;
  background: #1890ff;
}

.progress-dot.active {
  border-color: #1890ff;
  background: #1890ff;
  transform: translate(-50%, -50%) scale(1.3);
  box-shadow: 0 0 0 4px rgba(24, 144, 255, 0.2);
}

.speed-control {
  flex-shrink: 0;
}

.speed-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  color: #4b5563;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-btn:hover {
  border-color: #1890ff;
  color: #1890ff;
}

.narration-bar {
  margin-top: 8px;
  padding: 8px 16px;
  background: rgba(24, 144, 255, 0.06);
  border-radius: 8px;
  border-left: 3px solid #1890ff;
  pointer-events: auto;
}

.narration-text {
  font-size: 12px;
  color: #4b5563;
  line-height: 1.5;
}
</style>
