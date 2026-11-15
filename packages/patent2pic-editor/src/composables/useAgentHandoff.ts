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
import { validateAgentGraph, validateAgentRedraw } from '@/services/ai/agent-result'
import { x6ToExtractResult } from '@/services/graph/x6-to-extract'
import { graphEngine } from '@/services/graph/engine'
import { buildRedrawMessages } from '@/services/ai/redraw-prompt'
import type { RedrawOptions } from '@/types/redraw'
import type { ExtractResult } from '@/types/ai'
import type { Claim } from '@/types/claim'
import type { AgentTask } from '@/types/agent'

export function useAgentHandoff(listenDrops = true) {
  const claimStore = useClaimStore(), graph = useGraphStore(), workspace = useWorkspaceStore(), ai = useAIStore()
  const translations = useTranslationStore()
  const protocol = window.AgentHandoffProtocol
  const shared = window.parent !== window ? window.parent.AgentTaskWorkspace : window.AgentTaskWorkspace
  if (shared) window.AgentTaskWorkspace = shared
  const legacyStore = protocol.createStore(editorStorage, 'patent2pic-agent-tasks', 6 * 1024 * 1024)
  const store = shared ? shared.getStore() : legacyStore
  const ready = shared ? shared.ready.then(async () => { const legacy = legacyStore.list(); if (legacy.length) { await shared.migrate(legacy); editorStorage.removeItem('patent2pic-agent-tasks'); await flushStorage() } }) : Promise.resolve()
  ready.catch(() => {})
  async function createTask(): Promise<AgentTask> {
    await ready
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
    await ready
    if (ai.isExtracting) throw new Error('请等待当前生成完成或终止后再导入')
    const input = task.input as { claim: Claim; baseGraph?: ExtractResult; changeInstructions?: string; options?: RedrawOptions }
    const file = workspace.getProjectFiles(task.target.projectId)?.find(item => item.id === task.target.fileId)
    if (!file) throw new Error('原项目或画布已删除，请重新创建交接任务')
    const currentClaim = file.claims.find(item => item.id === task.target.claimId)
    if (!currentClaim || currentClaim.rawText !== input.claim.rawText || JSON.stringify(currentClaim.source) !== JSON.stringify(input.claim.source)) {
      throw new Error('原权项已经修改或重新分析，请恢复原文或新建交接任务')
    }
    const result = task.taskType === 'graph-redraw' && input.baseGraph
      ? validateAgentRedraw(payload, input.claim.rawText, input.baseGraph, input.changeInstructions || '')
      : validateAgentGraph(payload, input.claim.rawText)
    if (task.taskType === 'graph-redraw' && !file.versions.some(v => v.id === task.target.sourceVersionId)) throw new Error('交接基准版本已删除，请绑定当前画布后再导入')
    if (input.options?.keepFrames && input.baseGraph?.frames) {
      const nodes = new Set(result.nodes.map(n => n.id)), edges = new Set(result.edges.map(e => e.id))
      result.frames = input.baseGraph.frames.map(f => ({ ...f, highlightNodeIds: f.highlightNodeIds.filter(id => nodes.has(id)), highlightEdgeIds: f.highlightEdgeIds.filter(id => edges.has(id)) }))
    }
    ai.isExtracting = true
    try {
      await save()
      workspace.switchProject(task.target.projectId)
      graph.activateFile(file.id)
      const target = graph.activeFile!
      const existing = target.versions.find(version => version.agentResultHash === resultHash && version.agentTaskId === task.taskId)
      if (existing) { graph.setActiveVersion(target.id, existing.id); await save(); return '这份结果已生成，已切换到对应版本。' }
      result.claimId = currentClaim.id
      const version = graph.appendVersion(target.id, { label: (task.taskType === 'graph-redraw' ? 'Agent 修改 · ' : 'Agent 分析 · ') + (target.versions.length + 1), extractResult: result,
        sourceVersionId: task.target.sourceVersionId, redrawInstructions: input.changeInstructions })
      version.agentTaskId = task.taskId
      version.agentResultHash = resultHash
      graph.updateFileMeta(target.id, { claimId: currentClaim.id, isChinese: /[\u4e00-\u9fff]/.test(input.claim.rawText) })
      claimStore.setActiveClaim(currentClaim.id)
      if (result.sentencePairs.length) {
        const sentences = result.sentencePairs.map((pair, index) => ({ id: `${currentClaim.id}-sent-${index + 1}`, text: pair.original, nodeIds: [], edgeIds: [] }))
        claimStore.updateClaimSentences(currentClaim.id, sentences)
        const originals = Object.fromEntries(sentences.map(sentence => [sentence.id, sentence.text]))
        translations.initClaimTranslation(currentClaim.id, sentences.map(sentence => sentence.id), originals)
        result.sentencePairs.forEach((pair, index) => translations.setSentenceTranslation(currentClaim.id, { sentenceId: sentences[index].id,
          originalText: pair.original, translatedText: pair.translation, status: 'done', error: null }))
        const translation = translations.getClaimTranslation(currentClaim.id)
        if (translation) translation.overallStatus = 'done'
        graph.updateFileClaimSentences(target.id, currentClaim.id, sentences)
        graph.mergeFileTranslation(target.id, currentClaim.id, translations.getClaimTranslation(currentClaim.id))
      }
      claimStore.collapseInput()
      await save()
      return `已生成可编辑图：${result.nodes.length} 个节点、${result.edges.length} 条关系。旧版本已保留。` + (result.changes?.length ? '\n' + result.changes.join('；') : '')
    } finally { ai.isExtracting = false }
  }
  async function rebind(task: AgentTask): Promise<string> {
    const file = graph.activeFile, claim = file?.claims.find(c => c.id === file.claimId) || claimStore.getActiveClaim()
    const input = task.input as { claim: Claim }
    if (!file || !claim || claim.rawText !== input.claim.rawText || JSON.stringify(claim.source) !== JSON.stringify(input.claim.source)) throw new Error('当前画布必须使用与交接时完全相同的权项原文和来源')
    if (task.taskType === 'graph-redraw' && !file.activeVersionId) throw new Error('请先选择可用基准版本')
    task.target = { projectId: workspace.activeProjectId, fileId: file.id, claimId: claim.id, ...(task.taskType === 'graph-redraw' ? { sourceVersionId: file.activeVersionId! } : {}) }
    store.put(task); if (shared) await shared.flush()
    return '已将任务绑定当前画布，回流会追加新版本'
  }
  async function createRedrawTask(fileId: string, instructions: string, options: RedrawOptions): Promise<AgentTask> {
    await ready
    if (ai.isExtracting || !instructions.trim()) throw new Error('请等待生成结束并填写修改要求')
    const file = graph.files.find(f => f.id === fileId), version = file?.versions.find(v => v.id === file.activeVersionId)
    const claim = file?.claims.find(c => c.id === file.claimId)
    if (!file || !version || !claim) throw new Error('请先生成图并关联原权项')
    await save()
    let base = version.extractResult
    if (options.base === 'current') {
      const serialized = file.id === graph.activeFileId ? graphEngine.toJSON() : version.serializedGraph
      if (serialized) { const converted = x6ToExtractResult(serialized, { frames: base?.frames, translatedClaim: base?.translatedClaim, sentencePairs: base?.sentencePairs }); if (converted.nodes.length) base = converted }
    }
    if (!base?.nodes.length) throw new Error('当前基准没有可用节点')
    const messages = buildRedrawMessages(base, instructions, 'custom', { claimText: options.includeClaimContext ? claim.rawText : undefined })
    return protocol.create({ taskType: 'graph-redraw', label: file.name + ' · ' + instructions.slice(0, 40),
      input: { claim: JSON.parse(JSON.stringify(claim)), baseGraph: JSON.parse(JSON.stringify(base)), changeInstructions: instructions, options },
      target: { projectId: workspace.activeProjectId, fileId: file.id, claimId: claim.id, sourceVersionId: version.id },
      instructions: messages.map(m => m.content).join('\n\n') + '\n最终返回完整 ExtractResult 和 changes，不是补丁。保留未修改对象ID及原文证据；现有手工节点可保留。对于原权项无法验证的新增/修改部件或关系，必须增加 proposals:[{id,reason}] 明确说明是用户要求的示意修改，不得伪造原文。软件会在图中加【示意】标记。' })
  }
  async function open(initialRaw?: string, initialError?: string, redraw?: { fileId: string; instructions: string; options: RedrawOptions }): Promise<void> {
    await ready
    let type = redraw ? 'graph-redraw' : 'claim-graph'
    if (initialRaw) { try { if (protocol.parse(initialRaw).taskType === 'graph-redraw') type = 'graph-redraw' } catch (_) { /* Panel displays parsing errors. */ } }
    window.AgentHandoffPanel.open({ title: type === 'graph-redraw' ? 'Agent 自然语言修改图' : 'Agent 权利要求生图', taskType: type, store,
      createTask: redraw ? () => createRedrawTask(redraw.fileId, redraw.instructions, redraw.options) : createTask, apply, accept: apply, rebind,
      initialRaw,
      initialError,
      description: type === 'graph-redraw' ? '交接当前图（含手工编辑）和修改要求；返回后追加可编辑版本并保留旧图。示意新增将明确标记。' : '将当前选中权项交给外部 Agent。结果拖回后自动布局成图，可继续编辑和导出，无需模型 API。' })
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
  if (shared) { shared.register('claim-graph', { apply, accept: apply }); shared.register('graph-redraw', { apply, accept: apply }) }
  onMounted(() => { if (listenDrops) { document.addEventListener('dragover', dragover, true); document.addEventListener('drop', drop, true) } })
  onBeforeUnmount(() => { if (listenDrops) { document.removeEventListener('dragover', dragover, true); document.removeEventListener('drop', drop, true) } })
  return { open, createTask, createRedrawTask, apply, store }
}
