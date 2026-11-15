const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function load() {
  let uid = 0;
  const storage = new Map();
  const ctx = vm.createContext({ console, AbortController, Date, setTimeout,
    ComparisonUtils: { escapeHtml: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), cleanText: s => s, detectLanguage: () => 'en', generateId: () => 'i' + (++uid) },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, marked: { parse: s => s }
  });
  ctx.window = ctx;
  ['app/features/claimdiff-reader.js', 'comparison/comparison-claimdiff.js', 'app/features/family-scope.js', 'app/features/family-scope-view.js', 'comparison/comparison-prompts.js', 'comparison/comparison-core.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/scripts', file), 'utf8'), ctx, { filename: file });
  });
  return ctx;
}
function fixture() {
  const items = [
    { id: 'cn', label: 'CN 权1', patentNumber: 'CN1A', claimNumber: '1', originalText: '一种装置，包括处理器和存储器。' },
    { id: 'us', label: 'US claim 1', patentNumber: 'US1B', claimNumber: '1', originalText: 'A device comprising a processor and a memory.' }
  ];
  const raw = { version: 1, features: [{ id: 'F1', label: '处理器', aliases: ['processor'] }], claims: items.map(i => ({ itemId: i.id, category: '装置', scopeRelation: 'equivalent', combination: 'F1', cells: [{ featureId: 'F1', status: i.id === 'cn' ? 'present' : 'translation', confidence: 0.92, evidence: [{ sourceId: i.id, quote: i.id === 'cn' ? '处理器' : 'a processor', translation: '处理器' }] }] })) };
  return { items, raw };
}
function markdown(raw) { return '# 分析\n\n```json\n' + JSON.stringify({ familyScope: raw }) + '\n```\n\n```json\n{"similarityScores":[{"label":"US claim 1","score":98}]}\n```'; }

test('跨语言同义要素归一，保留各权项和对应原文，不把翻译差异当实质差异', () => {
  const { FamilyScope: F } = load(), { items, raw } = fixture();
  const { model, issues } = F.validate(raw, items, F.sourcesFor(items, {}), 'cn');
  assert.equal(model.claims.length, 2);
  assert.equal(model.claims[1].cells[0].status, 'translation');
  assert.equal(model.claims[1].cells[0].evidence[0].quote, 'a processor');
  assert.equal(F.isDifference('F1', model.claims), false);
  assert.equal(issues.length, 0);
});
test('缺失、截断及非法 JSON 无法生成树，但原报告保留', () => {
  const { FamilyScope: F } = load(), { items } = fixture();
  for (const output of ['旧报告', '```json\n{"familyScope":', '```json\n{"familyScope":null}\n```']) assert.equal(F.analyze(output, items, items, 'cn').model, null);
  assert.equal(F.stripBlocks('# 结论\n```json\n{"familyScope":'), '# 结论');
});
test('无法匹配引文、低置信度与未提供置信度均降为待核对', () => {
  const { FamilyScope: F } = load();
  for (const variant of ['quote', 'low', 'missing']) {
    const { items, raw } = fixture(), cell = raw.claims[1].cells[0];
    if (variant === 'quote') cell.evidence[0].quote = 'nonexistent chemical reactor';
    if (variant === 'low') cell.confidence = 0.4;
    if (variant === 'missing') delete cell.confidence;
    assert.equal(F.validate(raw, items, items, 'cn').model.claims[1].cells[0].status, 'uncertain');
  }
});
test('只允许引用祖先取证，拒绝跨成员与无关兄弟权项取证', () => {
  const { FamilyScope: F } = load();
  const items = [{ id: 'child', label: 'US 权3', patentNumber: 'US1B', claimNumber: '3', originalText: 'The device of claim 2, wherein the memory is a cache.' }];
  const sources = F.sourcesFor(items, { US1B: { claims: [
    { num: '1', text: 'A device comprising a processor.' },
    { num: '2', text: 'The device of claim 1, comprising a memory.' },
    { num: '3', text: items[0].originalText },
    { num: '4', text: 'The device of claim 1, comprising a reactor.' }
  ] } });
  assert.ok(sources[0].allowedSourceIds.includes('context:US1B:1'));
  assert.ok(!sources[0].allowedSourceIds.includes('context:US1B:4'));
  const raw = { version: 1, features: [{ id: 'F1', label: '处理器' }], claims: [{ itemId: 'child', cells: [{ featureId: 'F1', status: 'present', confidence: 0.9, evidence: [{ sourceId: 'context:US1B:1', quote: 'a processor' }] }] }] };
  assert.equal(F.validate(raw, items, sources, 'child').model.claims[0].cells[0].evidence[0].inherited, true);
  raw.claims[0].cells[0].evidence[0] = { sourceId: 'context:US1B:4', quote: 'a reactor' };
  assert.equal(F.validate(raw, items, sources, 'child').model.claims[0].cells[0].status, 'uncertain');
});
test('多项从属保留择一引用和参数表达，不将 OR 改写成 AND', () => {
  const { FamilyScope: F } = load(), { items, raw } = fixture();
  raw.claims[1].combination = '(F1 OR F2) AND F3，温度 10–20°C';
  raw.claims[1].dependencyNote = 'claims 1 or 2';
  const model = F.validate(raw, items, items, 'cn').model;
  assert.equal(model.claims[1].combination, raw.claims[1].combination);
  assert.equal(model.claims[1].dependencyNote, 'claims 1 or 2');
  assert.match(F.buildPrompt(items, items), /不能将同一成员的多个独权合并成一个 AND/);
});
test('重复或缺失的权项与单元格显示待核对，未见记载不冒充未采用', () => {
  const { FamilyScope: F } = load(), { items, raw } = fixture();
  raw.claims.push(raw.claims[1]);
  const parsed = F.validate(raw, items, items, 'cn');
  assert.equal(parsed.model.claims[1].cells[0].status, 'uncertain');
  assert.ok(parsed.issues.length);
  raw.claims = [raw.claims[0]];
  assert.equal(F.validate(raw, items, items, 'cn').model.claims[1].cells[0].status, 'uncertain');
  assert.equal(F.statuses.not_stated[0], '未见记载');
});
test('层级循环与不存在的父要素可恢复，筛选保留祖先以理解上下文', () => {
  const { FamilyScope: F, FamilyScopeView: V } = load(), { items, raw } = fixture();
  raw.features.push({ id: 'F2', parentId: 'F1', label: '安全处理器' });
  raw.features[0].parentId = 'F2';
  const parsed = F.validate(raw, items, items, 'cn');
  assert.equal(V.rows(parsed.model, 'all', '', new Set()).length, 2);
  assert.ok(parsed.issues.length);
  raw.features[0].parentId = null;
  const model = F.validate(raw, items, items, 'cn').model;
  assert.equal(V.rows(model, 'all', '安全', new Set(['F1'])).length, 2);
});
test('新增的成员特有要素也进入总树，缺失映射保持可见', () => {
  const { FamilyScope: F, FamilyScopeView: V } = load(), { items, raw } = fixture();
  raw.features.push({ id: 'F2', label: '成员特有模块' });
  const model = F.validate(raw, items, items, 'cn').model;
  assert.equal(model.features.length, 2);
  assert.equal(V.rows(model, 'differences', '', new Set())[0].feature.id, 'F2');
});
test('独立报告包含特征树、采用情况与原文，所有 AI 字段经过 HTML 转义', () => {
  const { FamilyScopeView: V } = load(), { items, raw } = fixture();
  raw.features[0].label = '<img src=x onerror=alert(1)>';
  raw.claims[0].combination = '</style><script>bad()</script>';
  const html = V.exportSection({ items, anchor: items[0], markdownContent: markdown(raw) });
  assert.match(html, /family-scope-table/); assert.match(html, /a processor/); assert.match(html, /未选权项/);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>bad'));
});
test('AI 调用加入结构化约定，结果隐藏机器 JSON，历史保留引用上下文可重建', async () => {
  const ctx = load(), { items, raw } = fixture();
  let request;
  ctx.AI = { loadAIConfig: () => ({}), getCurrentProvider: () => ({ type: 'mock' }), streamChat: async function* (...args) { request = args[3]; yield { content: markdown(raw) }; } };
  items.forEach(i => ctx.ComparisonCore.addItem(i));
  const result = await ctx.ComparisonCore.runComparison();
  assert.match(request.messages[1].content, /familyScope/);
  assert.ok(!result.htmlContent.includes('"familyScope"'));
  assert.equal(result.aiSimilarityScores['US claim 1'], 0.98);
  const entry = ctx.ComparisonCore.history.get(result.sessionId);
  assert.equal(entry.scopeSources.length, 2);
  assert.equal(ctx.FamilyScopeView.resolved({ ...entry, items: entry.itemsSummary, anchor: { id: entry.anchorId } }).model.claims.length, 2);
});
test('本地比对将父项改写传播到两级从权，保持自身文本与继承影响分开', () => {
  const { ComparisonClaimDiff: CD } = load();
  const before = [{ num: '1', type: 'independent', text: '一种装置，包括处理器和存储器。' }, { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，其中存储器包括缓存。' }, { num: '3', type: 'dependent', text: '根据权利要求2所述的装置，其中缓存为共享缓存。' }];
  const after = structuredClone(before); after[0].text = '一种装置，包括处理器、安全模块和存储器。';
  const result = CD.computeDiff(before, after);
  assert.equal(result.publicItems[1].status, 'inherited_changed');
  assert.equal(result.publicItems[2].status, 'inherited_changed');
  assert.equal(result.publicItems[2].inheritedFrom[0].baseNum, '1');
  assert.equal(result.publicItems[2].featureDiff.counts.modified, 0);
  assert.equal(result.stats.inherited, 2);
  assert.equal(CD.filterPublicItems(result, 'technical').length, 3);
  assert.equal(CD.filterPublicItems(result, 'numbering').length, 0);
});
test('纯父项重编号不会传播成继承内容变化', () => {
  const { ComparisonClaimDiff: CD } = load();
  const result = CD.computeDiff([{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，包括缓存。' }], [{ num: '3', type: 'independent', text: '一种装置，包括处理器。' }, { num: '4', type: 'dependent', text: '根据权利要求3所述的装置，包括缓存。' }]);
  assert.equal(result.stats.inherited, 0);
  assert.equal(result.publicItems[1].status, 'reference_only');
});

test('多项引用从 OR 改成 AND 不会被当作纯编号变化折叠', () => {
  const { ComparisonClaimDiff: CD } = load();
  const parents = [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '2', type: 'independent', text: '一种装置，包括控制器。' }];
  const result = CD.computeDiff([...parents, { num: '3', type: 'dependent', text: '根据权利要求1或2所述的装置，包括缓存。' }], [...parents, { num: '3', type: 'dependent', text: '根据权利要求1和2所述的装置，包括缓存。' }]);
  assert.equal(result.publicItems[2].status, 'dependency_migrated');
  assert.equal(result.publicItems[2].parentMigration.coherent, false);
});
