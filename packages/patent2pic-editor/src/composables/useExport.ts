import { graphEngine } from '@/services/graph/engine'
import type { ExportFormat } from '@/types/app'
import { exportInteractiveHTML } from '@/composables/useExportHTML'


export function useExport() {

  async function exportPNG(): Promise<Blob | null> {
    return graphEngine.toPNG({ padding: 40, scale: 4 })
  }

  function exportSVG(): string {
    return graphEngine.toSVG()
  }

  function exportHTML(): string {
    return exportInteractiveHTML()
  }

  async function downloadFile(format: ExportFormat): Promise<void> {
    await downloadViaBrowser(format)
  }


  async function downloadViaBrowser(format: ExportFormat): Promise<void> {
    switch (format) {
      case 'png': {
        const blob = await exportPNG()
        if (blob) downloadBlob(blob, 'patent2pic-graph.png')
        break
      }
      case 'svg': {
        const svg = exportSVG()
        const blob = new Blob([svg], { type: 'image/svg+xml' })
        downloadBlob(blob, 'patent2pic-graph.svg')
        break
      }
      case 'html': {
        const html = exportHTML()
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        downloadBlob(blob, 'patent2pic-interactive.html')
        break
      }
    }
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return {
    exportPNG,
    exportSVG,
    exportHTML,
    downloadFile,
  }
}