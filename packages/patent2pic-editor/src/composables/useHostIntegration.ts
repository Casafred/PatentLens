import { nextTick } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGraphStore } from '@/stores/graph'
import { useClaimStore } from '@/stores/claim'
import { useAIStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { parseSingleClaim, newClaimSessionId } from '@/services/claim/parser'
import { getHost } from '@/services/host/bridge'
import { flushStorage } from '@/services/host/storage'
import { waitForCanvasRender } from '@/services/graph/render-state'
import type { ClaimSource, LaunchRequest } from '@/types/host'

function identity(source: ClaimSource): string {
  return JSON.stringify([source.publicationNumber, source.language, source.source, source.sourceUrl, source.documentId, source.sourceClaimNumber, source.originalText])
}
export function useHostIntegration() {
  const workspace = useWorkspaceStore()
  const graph = useGraphStore()
  const claim = useClaimStore()
  const ai = useAIStore()
  const editor = useEditorStore()
  const received = new Set<string>()
  async function save(): Promise<void> {
    await nextTick()
    await waitForCanvasRender()
    // Always snapshot the current canvas, even if a text-only change did not mark dirty.
    workspace.saveActiveProject()
    await flushStorage()
    editor.markClean()
  }
  async function launch(request: LaunchRequest): Promise<void> {
    if (!request || request.schemaVersion !== 1 || !Array.isArray(request.claims) || !request.claims.length) throw new Error('无法导入无效的权利要求')
    if (received.has(request.requestId)) return
    if (ai.isExtracting) throw new Error('请等待当前生成完成或终止后，再导入其他权利要求')
    for (const source of request.claims) {
      if (!source.publicationNumber || !source.originalText?.trim() || !/^\d+$/.test(source.sourceClaimNumber)) throw new Error('权利要求文献号、编号或原文不完整')
    }
    await save()
    const sourceIds = request.claims.map(identity)
    // Search all projects so re-entering a patent resumes its existing edited graph.
    for (const project of workspace.projects) {
      const files = workspace.getProjectFiles(project.id) || []
      const existing = files.find(file => file.claims.length === sourceIds.length && file.claims.every((item, index) => item.source && identity(item.source) === sourceIds[index]))
      if (existing) {
        workspace.switchProject(project.id)
        graph.activateFile(existing.id)
        received.add(request.requestId)
        ai.refreshProfiles()
        return
      }
    }
    const session = newClaimSessionId()
    const parsed = request.claims.map((source, index) => {
      const prefix = new RegExp('^\\s*' + source.sourceClaimNumber + '\\s*[.、．]\\s*')
      return { ...parseSingleClaim(source.originalText.replace(prefix, ''), Number(source.sourceClaimNumber), `claim-${session}-${index + 1}`), source: { ...source } }
    })
    const rawText = parsed.map(item => `${item.index}. ${item.rawText}`).join('\n\n')
    const first = request.claims[0]
    const file = graph.addFile(first.publicationNumber + ' · 权利要求 ' + request.claims.map(source => source.sourceClaimNumber).join('、'))
    claim.setText(rawText)
    claim.setClaims(parsed)
    claim.setActiveClaim(parsed[0].id)
    graph.updateFileMeta(file.id, { claimId: parsed[0].id })
    claim.expandInput()
    ai.refreshProfiles()
    await nextTick()
    await save()
    received.add(request.requestId)
  }
  async function openRecord(target: { projectId: string; fileId: string; versionId?: string; claimId?: string }): Promise<void> {
    if (ai.isExtracting) throw new Error('请先等待生成完成或终止当前任务')
    const file = workspace.getProjectFiles(target.projectId)?.find(item => item.id === target.fileId)
    if (!file) throw new Error('该成图记录已被删除')
    await save()
    workspace.switchProject(target.projectId)
    graph.activateFile(target.fileId)
    if (target.versionId && file.versions.some(version => version.id === target.versionId)) graph.setActiveVersion(file.id, target.versionId)
    if (target.claimId) claim.setActiveClaim(target.claimId)
    await save()
  }
  function connect(): void { getHost().ready({ launch, save, openRecord, isBusy: () => ai.isExtracting }) }
  return { save, connect }
}
