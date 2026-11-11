export type RedrawBase = 'current' | 'original'

export interface RedrawOptions {
  /** 基准来源：current=当前画布（含手动编辑），original=原始抽取结果 */
  base: RedrawBase
  /** 引用权利要求原文作为参考上下文 */
  includeClaimContext: boolean
  /** 保留原图 frames 动画帧（否则使用 AI 重新编排的帧） */
  keepFrames: boolean
}

export const DEFAULT_REDRAW_OPTIONS: RedrawOptions = {
  base: 'current',
  includeClaimContext: true,
  keepFrames: true,
}
