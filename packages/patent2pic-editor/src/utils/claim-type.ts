import type { ClaimType } from '@/types/graph'

interface SignalRule {
  pattern: RegExp
  weight: number
  type: 'method' | 'structure'
}

const SIGNAL_RULES: SignalRule[] = [
  // 方法类信号词
  { pattern: /步骤/g, weight: 3, type: 'method' },
  { pattern: /方法[，,；;其]/g, weight: 2, type: 'method' },
  { pattern: /流程/g, weight: 2, type: 'method' },
  { pattern: /过程/g, weight: 2, type: 'method' },
  { pattern: /当[^。，,;；]+时/g, weight: 2, type: 'method' },
  { pattern: /若[^。，,;；]+则/g, weight: 2, type: 'method' },
  { pattern: /如果[^。，,;；]+就/g, weight: 2, type: 'method' },
  { pattern: /首先|然后|接着|随后|最后/g, weight: 2, type: 'method' },
  { pattern: /判断|检测|确定|比较/g, weight: 1.5, type: 'method' },
  { pattern: /重复|返回|回退/g, weight: 1.5, type: 'method' },
  // 英文方法类信号词
  { pattern: /step\s+of/gi, weight: 3, type: 'method' },
  { pattern: /method\s+(for|of|comprising)/gi, weight: 2, type: 'method' },
  { pattern: /process\s+(for|of|comprising)/gi, weight: 2, type: 'method' },
  { pattern: /wherein\s+said\s+\w+\s+(is|are)\s+(determined|detected|compared|calculated)/gi, weight: 1.5, type: 'method' },
  { pattern: /first.*?second.*?third/gi, weight: 1.5, type: 'method' },
  { pattern: /determining|detecting|comparing|calculating/gi, weight: 1.5, type: 'method' },

  // 结构类信号词
  { pattern: /装置|设备|系统|结构/g, weight: 3, type: 'structure' },
  { pattern: /设置于|位于|连接于/g, weight: 2, type: 'structure' },
  { pattern: /包括|包含|具有/g, weight: 1.5, type: 'structure' },
  { pattern: /由[^，,；;]+组成|由[^，,；;]+构成/g, weight: 2, type: 'structure' },
  { pattern: /设有/g, weight: 1.5, type: 'structure' },
  // 英文结构类信号词
  { pattern: /apparatus|device|system|structure/gi, weight: 3, type: 'structure' },
  { pattern: /disposed\s+(on|in|at)|positioned\s+(on|in|at)|connected\s+to/gi, weight: 2, type: 'structure' },
  { pattern: /comprising\s+(a|an|the)\s+\w+\s+(having|including)/gi, weight: 1.5, type: 'structure' },
]

/**
 * 预判权利要求类型
 * 基于关键词加权匹配，区分方法类、结构类和混合类权利要求
 * 混合类：装置/设备类权利要求中嵌套了方法/流程步骤
 */
export function predictClaimType(text: string): ClaimType {
  let methodScore = 0
  let structureScore = 0

  for (const rule of SIGNAL_RULES) {
    const matches = text.match(rule.pattern)
    if (matches) {
      const score = rule.weight * matches.length
      if (rule.type === 'method') {
        methodScore += score
      } else {
        structureScore += score
      }
    }
  }

  // 检查前序部分（"一种XXX方法" vs "一种XXX装置"），前序部分权重翻倍
  const preambleMatch = text.match(/一种([^，,；;。\n]+?)(方法|装置|设备|系统|结构|流程|过程)/)
  if (preambleMatch) {
    const preambleType = preambleMatch[2]
    if (['方法', '流程', '过程'].includes(preambleType)) {
      methodScore += 6
    } else if (['装置', '设备', '系统', '结构'].includes(preambleType)) {
      structureScore += 6
    }
  }

  // 英文前序部分
  const enPreambleMatch = text.match(/A\s+(method|process|apparatus|device|system)\s+(for|of|comprising)/i)
  if (enPreambleMatch) {
    const preambleType = enPreambleMatch[1].toLowerCase()
    if (['method', 'process'].includes(preambleType)) {
      methodScore += 6
    } else if (['apparatus', 'device', 'system'].includes(preambleType)) {
      structureScore += 6
    }
  }

  // 混合类型判断：当结构类和方法类信号都较强时
  // 典型场景：装置类权利要求中包含"其中处理器基于...进行分类，以及基于...确定路径"等方法步骤
  const minScore = 4
  if (structureScore >= minScore && methodScore >= minScore) {
    // 前序是装置/设备/系统，但内容中有显著的方法步骤信号 → 混合型
    if (structureScore > methodScore && methodScore >= structureScore * 0.4) {
      return 'mixed'
    }
    // 前序是方法/流程，但内容中有显著的结构组件信号 → 也可能是混合型
    if (methodScore > structureScore && structureScore >= methodScore * 0.4) {
      return 'mixed'
    }
  }

  return methodScore > structureScore ? 'method' : 'structure'
}
