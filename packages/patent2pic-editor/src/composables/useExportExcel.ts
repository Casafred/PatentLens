import { useClaimStore } from '@/stores/claim'
import { useTranslationStore } from '@/stores/translation'
import { useGraphStore } from '@/stores/graph'
import type { Claim } from '@/types/claim'


export function useExportExcel() {
  const claimStore = useClaimStore()
  const translationStore = useTranslationStore()
  const graphStore = useGraphStore()

  async function exportToExcel(): Promise<void> {
    // 修复 D：优先从活动文件快照取数，保证导出内容属于当前文件的分析，
    // 即便全局 store 被其他分析污染也不影响；快照缺失时回退全局 store
    const file = graphStore.activeFile
    let claim: Claim | undefined
    const tabTransLookup: Record<string, string> = {}
    if (file && file.claims.length > 0) {
      // file.claimId 是该文件分析的权利要求（并行模式各文件不同），优先于 activeClaimId
      const preferredId = file.claimId ?? file.activeClaimId
      claim = file.claims.find(c => c.id === preferredId) ?? file.claims[0]
      const snap = file.translations?.[claim.id]
      if (snap) {
        for (const s of snap.sentences) {
          tabTransLookup[s.sentenceId] = s.translatedText
        }
      }
    }
    if (!claim) {
      claim = claimStore.getActiveClaim()
    }
    if (!claim || claim.sentences.length === 0) return

    const XLSX = await import('xlsx')
    const rows: (string | number)[][] = [['序号', '原文', '译文']]

    for (let i = 0; i < claim.sentences.length; i++) {
      const sentence = claim.sentences[i]
      const tabTrans = tabTransLookup[sentence.id]
      const storeTrans = translationStore.getSentenceTranslation(claim.id, sentence.id)
      const translatedText = tabTrans ?? (storeTrans?.translatedText || '')
      rows.push([i + 1, sentence.text, translatedText])
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)

    ws['!cols'] = [
      { wch: 6 },
      { wch: 60 },
      { wch: 60 },
    ]

    for (let i = 2; i <= rows.length; i++) {
      if (!ws[`A${i}`]) continue
      ws[`A${i}`].vAlign = 'top'
      ws[`B${i}`].vAlign = 'top'
      ws[`C${i}`].vAlign = 'top'
      ws[`B${i}`] && (ws[`B${i}`].wrapText = true)
      ws[`C${i}`] && (ws[`C${i}`].wrapText = true)
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '权利要求翻译')

    // 文件名带上画布文件标识，多分析场景下导出文件天然可区分
    let filename = `权利要求翻译_${claim.index}.xlsx`
    if (file && file.name) {
      const safeFileName = file.name.replace(/[\\/:*?"<>|]/g, '_').trim()
      filename = `权利要求翻译_${safeFileName}_${claim.index}.xlsx`
    }
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })

    downloadViaBrowser(buffer, filename)
  }

  function downloadViaBrowser(buffer: ArrayBuffer | Uint8Array | number[], filename: string): void {
    let arrayBuffer: ArrayBuffer
    if (buffer instanceof Array) {
      arrayBuffer = new Uint8Array(buffer).buffer as ArrayBuffer
    } else if (buffer instanceof Uint8Array) {
      arrayBuffer = buffer.buffer as ArrayBuffer
    } else {
      arrayBuffer = buffer
    }
    const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return { exportToExcel }
}
