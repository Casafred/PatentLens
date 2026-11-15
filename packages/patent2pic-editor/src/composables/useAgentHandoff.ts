import '../../../../src/scripts/app/features/agent-transfer/task-protocol.js'
import '../../../../src/scripts/app/features/agent-transfer/task-panel.js'
import { nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useClaimStore } from '@/stores/claim'
import { useGraphStore } from '@/stores/graph'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAIStore } from '@/stores/ai'
import { useTranslationStore } from '@/stores/translation'
import { editorStorage, flushStorage } from '@/services/host/storage'
import { waitForCanvasRender } from '@/services/graph/render-state'
import { buildMessages } from '@/services/ai/prompt'
import { predictClaimType } from '@/utils/claim-type'
import { validateAgentGraph } from '@/services/ai/agent-result'
import type { Claim } from '@/types/claim'
import type { AgentTask } from '@/types/agent'

export function useAgentHandoff() {
  const claimStore = useClaimStore(), graph = useGraphStore(), workspace = useWorkspaceStore(), ai = useAIStore()
  const translations = useTranslationStore()
  const protocol = window.AgentHandoffProtocol
  const store = protocol.createStore(editorStorage, 'patent2pic-agent-tasks', 6 * 1024 * 1024)
  async function createTask(): Promise<AgentTask> {
    if (ai.isExtracting) throw new Error('请等待当前生成完成后再交接')
    const claim = claimStore.getActiveClaim(), file = graph.activeFile
    if (!claim || !claim.rawText.trim() || !file) throw new Error('请先输入并选择一条权利要求')
    const messages = buildMessages(claim.rawText, undefined, predictClaimType(claim.rawText))
    const task = await protocol.create({ taskType: 'claim-graph', label: (claim.source?.publicationNumber || file.name) + ' · 权利要求 ' + claim.index,
      input: { claim: JSON.parse(JSON.stringify(claim)) }, target: { projectId: workspace.activeProjectId, fileId: file.id, claimId: claim.id },
      instructions: messages.map(message => message.content).join('\n\n') +
        '\n最终 payload 使用上述 ExtractResult 结构（nodes、edges、groups、sentencePairs 等）。' +
        '每个节点的 sourceSentence 必须逐字摘自输入权项，originalText 也必须能在原文中找到。每条边的 originalText 必须逐字摘自关系原文。' +
        '不得添加原文不存在的部件或关系。sentencePairs 按原文顺序覆盖全文，中文原文可以不提供翻译。' })
    return task
  }
  async function save(): Promise<void> {
    await nextTick()
    await waitForCanvasRender()
    workspace.saveActiveProject()
    await flushStorage()
  }
  async function apply(task: AgentTask, payload: Record<string, unknown>, resultHash: string): Promise<string> {
    if (ai.isExtracting) throw new Error('请等待当前生成完成或终止后再导入')
    const input = task.input as { claim: Claim }
    const file = workspace.getProjectFiles(task.target.projectId)?.find(item => item.id === task.target.fileId)
    if (!file) throw new Error('原项目或画布已删除，请重新创建交接任务')
    const currentClaim = file.claims.find(item => item.id === task.target.claimId)
    if (!currentClaim || currentClaim.rawText !== input.claim.rawText || JSON.stringify(currentClaim.source) !== JSON.stringify(input.claim.source)) {
      throw new Error('原权项已经修改或重新分析，请恢复原文或新建交接任务')
    }
    const result = validateAgentGraph(payload, input.claim.rawText)
    ai.isExtracting = true
    try {
      await save()
      workspace.switchProject(task.target.projectId)
      graph.activateFile(file.id)
      const target = graph.activeFile!
      const existing = target.versions.find(version => version.agentResultHash === resultHash && version.agentTaskId === task.taskId)
      if (existing) { graph.setActiveVersion(target.id, existing.id); await save(); return '这份结果已生成，已切换到对应版本。' }
      result.claimId = input.claim.id
      const version = graph.appendVersion(target.id, { label: 'Agent 分析 · ' + (target.versions.length + 1), extractResult: result })
      version.agentTaskId = task.taskId
      version.agentResultHash = resultHash
      graph.updateFileMeta(target.id, { claimId: input.claim.id, isChinese: /[\u4e00-\u9fff]/.test(input.claim.rawText) })
      claimStore.setActiveClaim(input.claim.id)
      if (result.sentencePairs.length) {
        const sentences = result.sentencePairs.map((pair, index) => ({ id: `${input.claim.id}-sent-${index + 1}`, text: pair.original, nodeIds: [], edgeIds: [] }))
        claimStore.updateClaimSentences(input.claim.id, sentences)
        const originals = Object.fromEntries(sentences.map(sentence => [sentence.id, sentence.text]))
        translations.initClaimTranslation(input.claim.id, sentences.map(sentence => sentence.id), originals)
        result.sentencePairs.forEach((pair, index) => translations.setSentenceTranslation(input.claim.id, { sentenceId: sentences[index].id,
          originalText: pair.original, translatedText: pair.translation, status: 'done', error: null }))
        const translation = translations.getClaimTranslation(input.claim.id)
        if (translation) translation.overallStatus = 'done'
        graph.updateFileClaimSentences(target.id, input.claim.id, sentences)
        graph.mergeFileTranslation(target.id, input.claim.id, translations.getClaimTranslation(input.claim.id))
      }
      claimStore.collapseInput()
      await save()
      return `已生成可编辑图：${result.nodes.length} 个节点、${result.edges.length} 条关系。旧版本已保留。`
    } finally { ai.isExtracting = false }
  }
  function open(initialRaw?: string, initialError?: string): void {
    window.AgentHandoffPanel.open({ title: 'Agent 权利要求生图', taskType: 'claim-graph', store, createTask, apply,
      initialRaw,
      initialError,
      description: '将当前选中权项交给外部 Agent。结果拖回后自动布局成图，可继续编辑和导出，无需模型 API。' })
  }
  function dragover(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  }
  async function drop(event: DragEvent): Promise<void> {
    if (event.defaultPrevented || document.querySelector('.agent-task-overlay') || !event.dataTransfer?.files.length) return
    event.preventDefault()
    event.stopPropagation()
    const files = event.dataTransfer.files
    if (files.length !== 1 || files[0].size > 4 * 1024 * 1024) { open('', '请每次拖入一个不超过 4 MB 的结果文件'); return }
    try { open(await files[0].text()) }
    catch (error) { open('', error instanceof Error ? error.message : '文件读取失败') }
  }
  onMounted(() => { document.addEventListener('dragover', dragover, true); document.addEventListener('drop', drop, true) })
  onBeforeUnmount(() => { document.removeEventListener('dragover', dragover, true); document.removeEventListener('drop', drop, true) })
  return { open, createTask, apply, store }
}
