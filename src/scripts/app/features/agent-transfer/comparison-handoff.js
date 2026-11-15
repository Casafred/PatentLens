/* External Agent adapter. Comparison state and the legacy renderer stay untouched. */
var ComparisonHandoff = (function () {
  'use strict';
  var store, timer;
  function getStore() { return typeof AgentTaskWorkspace !== 'undefined' ? AgentTaskWorkspace.getStore() : store || (store = AgentHandoffProtocol.createStore(localStorage, 'patentlens-agent-comparison-tasks')); }
  function snapshot(item) {
    return { id: item.id, label: item.label, source: item.source || '', patentNumber: item.patentNumber || '', claimNumber: item.claimNumber || '',
      originalText: item.originalText || '', originalLang: item.originalLang || '', isSelected: true };
  }
  async function createTask() {
    if (ComparisonCore.isLoading()) throw new Error('请等待当前比对完成或终止后再交接');
    var items = ComparisonCore.getSelectedItems().map(snapshot), anchor = ComparisonCore.getAnchor();
    if (items.length < 2 || !anchor || !items.some(function (item) { return item.id === anchor.id; })) throw new Error('请先选中至少两条权项，并设置锚点');
    var state = ComparisonCore.getState();
    var sources = FamilyScope.sourcesFor(items, Object.assign({}, state.loadedPatents, state.fetchedPatents || {}));
    return AgentHandoffProtocol.create({ taskType: 'family-comparison', label: anchor.label + ' 等 ' + items.length + ' 项',
      input: { items: items, anchorId: anchor.id, sources: sources },
      instructions: ComparisonPrompts.SYSTEM_PROMPT + '\n\n' + ComparisonPrompts.buildAnchorPrompt(anchor, items.filter(function (i) { return i.id !== anchor.id; })) +
        FamilyScope.buildPrompt(items, sources) + '\n最终 payload 必须包含 familyScope 对象和 report 字符串，可选 similarityScores。', target: {} });
  }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  async function apply(task, payload, resultHash) {
    if (ComparisonCore.isLoading()) throw new Error('请等待当前比对完成后再导入');
    var input = task.input, state = ComparisonCore.getState();
    var currentSources = FamilyScope.sourcesFor(state.items, Object.assign({}, state.loadedPatents, state.fetchedPatents || {}));
    input.sources.forEach(function (source) {
      var current = currentSources.find(function (s) { return s.id === source.id; });
      if (current && current.originalText !== source.originalText) throw new Error('当前权项原文已修改，请恢复原文或新建任务后重新分析');
    });
    var checked = FamilyScope.validate(payload.familyScope, input.items, input.sources, input.anchorId);
    if (!checked.model) throw new Error(checked.issues.join('\n'));
    // Missing columns or duplicate identifiers are not a usable return. Evidence failures remain visible as uncertain.
    var raw = payload.familyScope;
    if (raw.features.length !== checked.model.features.length || raw.claims.length !== input.items.length || input.items.some(function (item) {
      return raw.claims.filter(function (c) { return c && c.itemId === item.id; }).length !== 1;
    })) throw new Error('统一要素或权项列有遗漏、重复或无效编号，请让 Agent 返回完整映射');
    var report = typeof payload.report === 'string' ? payload.report : '外部 Agent 统一特征分析';
    var markdown = report + '\n\n```json\n' + JSON.stringify({ familyScope: raw }) + '\n```';
    var anchor = input.items.find(function (item) { return item.id === input.anchorId; });
    var scores = ComparisonCore.parseAiSimilarityScores('```json\n' + JSON.stringify({ similarityScores: payload.similarityScores }) + '\n```');
    var result = { sessionId: task.taskId + '-' + resultHash.slice(0, 16), timestamp: Date.now(), anchor: anchor, items: input.items,
      others: input.items.filter(function (item) { return item.id !== input.anchorId; }), scopeSources: input.sources,
      markdownContent: markdown, htmlContent: '<p><b>Agent 回流 · 基于交接时的原文快照</b></p><pre style="white-space:pre-wrap;font:inherit">' + esc(report) + '</pre>',
      aiSimilarityScores: scores, aiSimilarityMatrix: ComparisonCore.buildAiSimilarityMatrix(input.items, anchor, scores) };
    ComparisonCore.history.save(result, '', {});
    if (!ComparisonCore.history.get(result.sessionId)) throw new Error('比对历史未能保存，请整理本地空间后重试');
    ComparisonCore.setResult(result);
    ComparisonUI.render();
    return '已生成统一特征树并保存到比对历史。' + (checked.issues.length ? '\n有 ' + checked.issues.length + ' 项映射需核对，可在树中查看证据和待核对标记。' : '');
  }
  async function open(initialRaw, initialError) {
    if (typeof AgentTaskWorkspace !== 'undefined') await AgentTaskWorkspace.ready;
    AgentHandoffPanel.open({ title: 'Agent 同族权利要求比对', taskType: 'family-comparison', store: getStore(), createTask: createTask, apply: apply, accept: apply,
      initialRaw: typeof initialRaw === 'string' ? initialRaw : '',
      initialError: initialError || '',
      description: '将选中权项与引用上下文交给外部 Agent，返回后生成统一特征树和采用矩阵。无需配置模型 API。' });
  }
  function ensure() {
    var actions = document.querySelector('#comparison-section .comparison-header-actions');
    if (!actions || actions.querySelector('.comparison-agent-handoff')) return;
    var mode = ComparisonCore.getState().inputMode;
    if (mode === 'claimdiff' || mode === 'specdiff') return;
    var button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary btn-small comparison-agent-handoff';
    button.textContent = '交给 Agent / 导入结果'; button.addEventListener('click', open); actions.prepend(button);
  }
  function install() {
    if (typeof AgentTaskWorkspace !== 'undefined') AgentTaskWorkspace.register('family-comparison', { apply: apply, accept: apply });
    ensure();
    var section = document.getElementById('comparison-section');
    if (section) {
      new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(ensure, 30); }).observe(section, { childList: true, subtree: true });
      section.addEventListener('dragover', function (e) { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
      section.addEventListener('drop', async function (e) {
        if (document.querySelector('.agent-task-overlay') || !e.dataTransfer.files.length) return;
        e.preventDefault();
        var files = e.dataTransfer.files;
        if (files.length !== 1 || files[0].size > AgentHandoffProtocol.MAX_TEXT) { open('', '请每次拖入一个不超过 4 MB 的结果文件'); return; }
        try { open(await files[0].text()); } catch (error) { open('', '文件读取失败：' + error.message); }
      });
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }
  return { open: open, createTask: createTask, apply: apply, getStore: getStore, ensure: ensure };
})();
