import type { NodeData } from '@/types/graph'
import { getDefaultNodeStyle } from './style-registry'

let _measureCanvas: HTMLCanvasElement | null = null

function measureTextWidth(text: string, fontSize: number, fontFamily: string, fontWeight: string): number {
  if (!_measureCanvas) {
    _measureCanvas = document.createElement('canvas')
  }
  const ctx = _measureCanvas.getContext('2d')
  if (!ctx) return text.length * fontSize * 0.7
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return ctx.measureText(text).width
}

export function calculateNodeSize(
  originalText: string,
  chineseText: string,
  isChinese: boolean,
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  minWidth: number = 100,
  minHeight: number = 40,
): { width: number; height: number } {
  let labelText: string
  if (isChinese) {
    labelText = chineseText || originalText
  } else {
    labelText = chineseText ? `${originalText}\n${chineseText}` : originalText
  }

  const lines = labelText.split('\n')
  let maxWidth = 0
  for (const line of lines) {
    const width = measureTextWidth(line, fontSize, fontFamily, fontWeight)
    if (width > maxWidth) maxWidth = width
  }

  const paddingH = 24
  const paddingV = 16
  const lineHeight = fontSize * 1.5

  const width = maxWidth + paddingH * 2
  const height = lines.length * lineHeight + paddingV * 2

  return {
    width: Math.max(Math.ceil(width), minWidth),
    height: Math.max(Math.ceil(height), minHeight),
  }
}

function getLabelText(data: NodeData, isChinese: boolean): string {
  if (isChinese) {
    return data.chineseText || data.originalText
  }
  if (!data.chineseText) return data.originalText
  return `${data.originalText}\n${data.chineseText}`
}

export function buildNode(data: NodeData, isChinese: boolean = false): Record<string, unknown> {
  const style = data.style || getDefaultNodeStyle(data.nodeType)
  const size = calculateNodeSize(
    data.originalText,
    data.chineseText,
    isChinese,
    style.fontSize,
    style.fontFamily,
    style.fontWeight,
    style.width,
    style.height,
  )

  // 方法类节点使用自定义 shape
  const shape = data.nodeType === 'decision' ? 'decision'
    : data.nodeType === 'condition' ? 'condition'
    : 'rect'

  // decision 节点需要更大的尺寸以容纳菱形
  const nodeWidth = data.nodeType === 'decision' ? Math.max(size.width, 140) : size.width
  const nodeHeight = data.nodeType === 'decision' ? Math.max(size.height, 100) : size.height

  // step 节点使用更大的圆角
  const borderRadius = data.nodeType === 'step' ? 16 : style.borderRadius

  return {
    id: data.id,
    x: data.x ?? 0,
    y: data.y ?? 0,
    width: nodeWidth,
    height: nodeHeight,
    shape,
    attrs: {
      body: {
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDasharray: style.strokeDasharray ?? undefined,
        rx: shape === 'rect' ? borderRadius : undefined,
        ry: shape === 'rect' ? borderRadius : undefined,
      },
      label: {
        text: getLabelText(data, isChinese),
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fill: style.fontColor,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
      },
    },
    ports: {
      groups: {
        top: { position: 'top', attrs: { circle: { r: 4, magnet: true, stroke: style.stroke, strokeWidth: 1, fill: '#fff' } } },
        bottom: { position: 'bottom', attrs: { circle: { r: 4, magnet: true, stroke: style.stroke, strokeWidth: 1, fill: '#fff' } } },
        left: { position: 'left', attrs: { circle: { r: 4, magnet: true, stroke: style.stroke, strokeWidth: 1, fill: '#fff' } } },
        right: { position: 'right', attrs: { circle: { r: 4, magnet: true, stroke: style.stroke, strokeWidth: 1, fill: '#fff' } } },
      },
      items: [
        { group: 'top', id: `${data.id}-top` },
        { group: 'bottom', id: `${data.id}-bottom` },
        { group: 'left', id: `${data.id}-left` },
        { group: 'right', id: `${data.id}-right` },
      ],
    },
    data: {
      originalText: data.originalText,
      chineseText: data.chineseText,
      nodeType: data.nodeType,
      hierarchyLevel: data.hierarchyLevel ?? 0,
      style: data.style,
    },
  }
}

export function updateNodeStyle(node: unknown, style: Partial<NodeData['style']>): void {
  const n = node as unknown as {
    attr: (pathOrObj: string | Record<string, unknown>, value?: unknown) => unknown
    getSize: () => { width: number; height: number }
    resize: (width: number, height: number) => void
    getData: () => Record<string, unknown> | undefined
    setData: (data: Record<string, unknown>) => void
  }

  const bodyAttrs: Record<string, unknown> = {}
  const labelAttrs: Record<string, unknown> = {}

  if (style.fill !== undefined) bodyAttrs.fill = style.fill
  if (style.stroke !== undefined) bodyAttrs.stroke = style.stroke
  if (style.strokeWidth !== undefined) bodyAttrs.strokeWidth = style.strokeWidth
  if (style.strokeDasharray !== undefined) bodyAttrs.strokeDasharray = style.strokeDasharray ?? ''
  if (style.borderRadius !== undefined) {
    bodyAttrs.rx = style.borderRadius
    bodyAttrs.ry = style.borderRadius
  }
  if (style.fontSize !== undefined) labelAttrs.fontSize = style.fontSize
  if (style.fontFamily !== undefined) labelAttrs.fontFamily = style.fontFamily
  if (style.fontColor !== undefined) labelAttrs.fill = style.fontColor
  if (style.fontWeight !== undefined) labelAttrs.fontWeight = style.fontWeight
  if (style.fontStyle !== undefined) labelAttrs.fontStyle = style.fontStyle

  if (Object.keys(bodyAttrs).length > 0) {
    n.attr({ body: bodyAttrs })
  }
  if (Object.keys(labelAttrs).length > 0) {
    n.attr({ label: labelAttrs })
  }

  if (style.width || style.height) {
    const size = n.getSize()
    n.resize(style.width || size.width, style.height || size.height)
  }

  const currentData = n.getData() || {}
  const currentStyle = (currentData.style as Record<string, unknown>) || {}
  n.setData({ ...currentData, style: { ...currentStyle, ...style } })
}
