const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../packages/patent2pic-editor/node_modules/typescript');
function load(name) {
  const filename = path.join(__dirname, '../packages/patent2pic-editor/src/services/ai', name + '.ts');
  const context = { exports: {}, require: name => load(name.replace('./', '')) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, context, { filename });
  return context.exports;
}
const { validateAgentGraph, validateAgentRedraw } = load('agent-result');
const original = 'A device comprising a housing and a motor connected to the housing.';
const base = () => ({ claimType: 'structure', nodes: [
  { id: 'n1', originalText: 'housing', chineseText: '壳体', nodeType: 'component', sourceSentence: 'a housing' },
  { id: 'n2', originalText: 'motor', chineseText: '电机', nodeType: 'component', sourceSentence: 'a motor connected to the housing' }],
  edges: [{ id: 'e1', source: 'n2', target: 'n1', originalText: 'connected to', chineseText: '连接于', relationType: 'position' }],
  groups: [], sentencePairs: [{ original, translation: '一种装置，包括壳体和连接于壳体的电机。' }] });

test('external graph retains editable semantic structure and exact bilingual sentence coverage', () => {
  const result = validateAgentGraph(base(), original);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges[0].source, 'n2');
  assert.equal(result.sentencePairs[0].original, original);
});

test('external graph rejects invented source text, broken edges and incomplete sentence coverage', () => {
  let data = base(); data.nodes[0].sourceSentence = 'invented component';
  assert.throws(() => validateAgentGraph(data, original), /原文/);
  data = base(); data.edges[0].source = 'missing';
  assert.throws(() => validateAgentGraph(data, original), /不存在/);
  data = base(); data.edges[0].originalText = 'wirelessly coupled';
  assert.throws(() => validateAgentGraph(data, original), /原文/);
  data = base(); data.sentencePairs[0].original = 'A device';
  assert.throws(() => validateAgentGraph(data, original), /未完整覆盖/);
});

test('external graph rejects cross-kind duplicate IDs and unknown group/frame references instead of dropping them', () => {
  let data = base(); data.edges[0].id = 'n1';
  assert.throws(() => validateAgentGraph(data, original), /重复/);
  data = base(); data.groups.push({ id: 'g1', label: { original: 'device', chinese: '装置' }, memberNodeIds: ['n1', 'unknown'] });
  assert.throws(() => validateAgentGraph(data, original), /分组引用/);
  data = base(); data.frames = [{ title: '结构', highlightNodeIds: ['unknown'], highlightEdgeIds: [] }];
  assert.throws(() => validateAgentGraph(data, original), /分步展示/);
  data = base(); data.nodes[0].nodeType = 'decision';
  assert.throws(() => validateAgentGraph(data, original), /类型不符合/);
});

test('external redraw preserves manual base vocabulary and labels new unsupported schematic objects', () => {
  const manual = base(); manual.nodes[0].originalText = 'hand edited housing'; manual.nodes[0].sourceSentence = '';
  const data = structuredClone(manual);
  data.nodes.push({ id: 'n-new-1', originalText: 'reducer', chineseText: '减速器', nodeType: 'component', sourceSentence: 'invented original' });
  assert.throws(() => validateAgentRedraw(data, original, manual, '增加减速器示意'), /proposals/);
  data.proposals = [{ id: 'n-new-1', reason: '用户要求增加示意减速器' }];
  const result = validateAgentRedraw(data, original, manual, '增加减速器示意');
  assert.equal(result.nodes[2].chineseText, '【示意】减速器');
  assert.equal(result.nodes[2].sourceSentence, '用户修改要求：增加减速器示意');
  assert.match(result.changes.join(''), /示意修改/);
  const next = structuredClone(result); next.nodes[2].chineseText = '重命名减速器';
  assert.equal(validateAgentRedraw(next, original, result, '重命名减速器').nodes[2].chineseText, '【示意】重命名减速器');
});
