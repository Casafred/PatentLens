/**
 * 画布文字换行：按视觉宽度把一行限制在约 15 个汉字以内。
 * 中日韩字符按 1 个单位计，拉丁字符按 0.55 个单位计，
 * 这样中文每行 15 字、英文约 27 个字符，避免节点/线条标签被拉得过长。
 */
const MAX_LINE_UNITS = 15

function isWideChar(char: string): boolean {
  return /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char)
}

function charUnits(char: string): number {
  if (/\s/.test(char)) return 0.35
  return isWideChar(char) ? 1 : 0.55
}

function textUnits(text: string): number {
  let total = 0
  for (const char of text) total += charUnits(char)
  return total
}

function tokenize(line: string): string[] {
  const tokens: string[] = []
  let word = ''
  for (const char of line) {
    if (/\s/.test(char)) {
      if (word) { tokens.push(word); word = '' }
      tokens.push(char)
      continue
    }
    if (isWideChar(char)) {
      if (word) { tokens.push(word); word = '' }
      tokens.push(char)
      continue
    }
    word += char
  }
  if (word) tokens.push(word)
  return tokens
}

function wrapLine(line: string, maxUnits: number): string {
  if (!line) return ''
  const pieces: string[] = []
  let current = ''
  let width = 0
  let pendingSpace = false

  function flush(): void {
    const value = current.trimEnd()
    if (value) pieces.push(value)
    current = ''
    width = 0
    pendingSpace = false
  }

  for (const token of tokenize(line)) {
    if (/^\s+$/.test(token)) {
      pendingSpace = !!current
      continue
    }
    const units = textUnits(token)
    if (units > maxUnits) {
      // 超长单词 / 无分隔长串：逐字符硬换行
      for (const char of token) {
        const charWidth = charUnits(char)
        if (current && width + charWidth > maxUnits) flush()
        current += char
        width += charWidth
      }
      continue
    }
    const spaceWidth = pendingSpace ? 0.35 : 0
    if (current && width + spaceWidth + units > maxUnits) {
      flush()
    } else if (pendingSpace && current) {
      current += ' '
      width += 0.35
    }
    pendingSpace = false
    current += token
    width += units
  }
  flush()
  return pieces.join('\n')
}

export function wrapLabelText(text: string, maxUnits: number = MAX_LINE_UNITS): string {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => wrapLine(line, maxUnits))
    .join('\n')
}
