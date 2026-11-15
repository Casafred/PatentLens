const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const protocol = require('../src/scripts/app/features/agent-transfer/task-protocol.js');
const refs = require('../src/scripts/app/features/agent-transfer/source-references.js');
function memory() { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; }
function envelope(task, payload, partId) { return JSON.stringify({ kind: 'patentlens-agent-result', schemaVersion: 1, taskId: task.taskId, taskType: task.taskType, sourceHash: task.sourceHash, payload, ...(partId ? { partId } : {}) }); }
function adapters() {
  const store = protocol.createStore(memory(), 'tasks', 32 * 1024 * 1024);
  const kb = { documents: [{ idx: 1, docId: 'OA1', name: 'Office Action', date: '2025-01-01' }, { idx: 2, docId: 'R1', name: 'Response' }], extractions: { 1: { text: 'The motor is not novel. ' + 'OCR '.repeat(6000) } }, analysis: '人工原分析' };
  const project = { id: 'project1', patents: [{ id: 'p1', patentNumber: 'CN1', fields: { abstract: { value: '一种处理器' } }, description: '处理器执行计算。', claims: [{ number: '1', text: '一种装置，包括处理器。' }], processedFields: [{ id: 'f1', label: '自定义', prompt: '只分析处理器', value: '人工已确认', reviewState: 'accepted' }] }] };
  const c = vm.createContext({ console, TextEncoder, crypto: webcrypto, AgentHandoffProtocol: protocol, AgentSourceReferences: refs,
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } },
    currentData: { application_number: 'APP1' }, _kanbanSelected: new Set([1, 2]), TransferContext: { getKanban: () => kb },
    AgentTaskWorkspace: { register() {}, getStore: () => store, ready: Promise.resolve(), flush: async () => {} },
    PatentShareAI: { getAIPrompt: () => '分析技术问题、技术方案、效果' },
    PatentShareStore: { getSnapshot: () => structuredClone(project), getAIContextScope: () => ({ abstract: true, claims: true, description: true, annotations: false }),
      addProcessedField: (id, label, prompt) => { const field = { id: 'new' + project.patents[0].processedFields.length, label, prompt }; project.patents[0].processedFields.push(field); return { ok: true, field }; },
      updateProcessedField: (id, fieldId, updates) => Object.assign(project.patents[0].processedFields.find(f => f.id === fieldId), updates), flush: async () => {} }
  });
  c.window = c; c._currentPatentData = { patent_number: 'CN1', description: '[0020] 处理器执行计算。', claims: [{ num: '1', text: '一种装置，包括处理器。' }] };
  for (const file of ['claim-support-analysis.js', 'agent-transfer/report-handoff.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts/app/features', file), 'utf8'), c);
  return { c, api: c.AgentReportHandoff, kb, project, store };
}
test('source splitting is lossless and reports reject fabricated or cross-task evidence', async () => {
  const original = 'a'.repeat(11999) + '😀' + '原文'.repeat(16000), sources = refs.textSources('d1', original, { documentName: 'doc' });
  assert.equal(sources.map(s => s.text).join(''), original);
  assert.equal(new Set(sources.map(s => s.id)).size, sources.length);
  const task = { input: { sources } };
  assert.throws(() => refs.report(task, { report: '结论', evidence: [{ sourceId: sources[0].id, quote: '虚构' }] }), /证据不在原文/);
  assert.throws(() => refs.report(task, { report: '结论', evidence: [{ sourceId: 'other', quote: '原文' }] }), /证据不在原文/);
});
test('partial reports survive reload and apply only after all parts; revisions and acceptance remain separate', async () => {
  const storage = memory(), store = protocol.createStore(storage, 'tasks');
  const task = await protocol.create({ taskType: 'report', label: 'long', instructions: 'report', input: { sources: refs.textSources('doc', 'x'.repeat(50000)) } });
  store.put(task); let calls = 0;
  const apply = async () => { calls++; return '已校验'; };
  await store.receive(envelope(task, { report: 'part1', evidence: [] }, task.parts[0].id), apply, null, refs.mergeReports);
  assert.equal(calls, 0);
  const reopened = protocol.createStore(storage, 'tasks');
  for (const part of task.parts.slice(1)) await reopened.receive(envelope(task, { report: part.id, evidence: [] }, part.id), apply, null, refs.mergeReports);
  assert.equal(calls, 1);
  let returned = reopened.list()[0]; assert.equal(returned.revisions.length, 1); assert.equal(returned.revisions[0].acceptance.length, 0);
  reopened.recordAcceptance(task.taskId, returned.revisions[0].hash, '已采用');
  await reopened.receive(envelope(task, { report: '修订结论', evidence: [] }), apply);
  returned = reopened.list()[0]; assert.equal(returned.revisions.length, 2); assert.equal(returned.revisions[0].acceptance.length, 1);
  assert.match(protocol.prompt(task, task.parts[0].id), /part-1/);
});
test('support return rejects fake quotes and stale description, and adopts into existing evidence cache', async () => {
  const { api, c } = adapters(), task = await api.createSupport('detail');
  const payload = { claims: [{ number: '1', result: { features: [{ claimText: '处理器', status: 'strong', evidence: [{ paragraph: '0020', quote: '处理器执行计算' }] }] } }] };
  await api.routes['claim-support'].apply(task, payload);
  const bad = structuredClone(payload); bad.claims[0].result.features[0].evidence[0].quote = '虚构原文';
  await assert.rejects(api.routes['claim-support'].apply(task, bad), /证据/);
  c._currentPatentData.description += '修改';
  await assert.rejects(api.routes['claim-support'].accept(task, payload), /一致/);
  c._currentPatentData.description = '[0020] 处理器执行计算。';
  await api.routes['claim-support'].accept(task, payload);
  assert.equal(c._currentPatentData._claimSupportAnalysis.claims['1'].result.features[0].status, 'strong');
});
test('review includes full OCR and missing material manifest; accepting preserves manual analysis and neutralizes stored HTML', async () => {
  const { api, kb, store } = adapters(), task = await api.createReview('重点看修改'); store.put(task);
  assert.equal(task.input.sources.map(s => s.text).join(''), kb.extractions[1].text);
  assert.equal(task.input.documents[1].hasText, false);
  const payload = { report: '### 争点\n<img src=x onerror=alert(1)> [x](javascript:alert(1))', evidence: [{ sourceId: task.input.sources[0].id, quote: 'The motor is not novel.' }] };
  await api.routes['review-report'].apply(task, payload);
  assert.equal(kb.analysis, '人工原分析');
  await api.routes['review-report'].accept(task, payload);
  assert.doesNotMatch(kb.analysis, /<img|\]\(javascript:/);
  assert.equal(store.list()[0].previousAnalyses[0].report, '人工原分析');
  kb.extractions[1].text += 'changed';
  await assert.rejects(api.routes['review-report'].accept(task, payload), /变化/);
});

test('review defaults to loaded documents when the selection set is empty', async () => {
  const { api, c } = adapters();
  c._kanbanSelected.clear();
  const task = await api.createReview('');
  assert.deepEqual(Array.from(task.input.documents, d => d.idx), [1, 2]);
  assert.ok(task.input.sources.length);
});
test('share returns append pending editable drafts, preserve accepted manual fields and reject changed source', async () => {
  const { api, project } = adapters(), task = await api.createShare(['p1'], 'summary', '');
  const payload = { report: '总体', items: [{ patentId: 'p1', content: '技术解读草稿' }], evidence: [{ sourceId: task.input.sources[0].id, quote: '处理器' }] };
  await api.routes['share-processing'].apply(task, payload);
  assert.equal(project.patents[0].processedFields.length, 1);
  await api.routes['share-processing'].accept(task, payload, 'hash');
  assert.equal(project.patents[0].processedFields[0].value, '人工已确认');
  assert.equal(project.patents[0].processedFields[1].reviewState, 'pending');
  await api.routes['share-processing'].accept(task, payload, 'hash');
  assert.equal(project.patents[0].processedFields.length, 2, 'repeat adoption is idempotent');
  project.patents[0].description += '修改';
  await assert.rejects(api.routes['share-processing'].accept(task, payload, 'other'), /一致/);
});
test('durable IPC is main-frame-only, serializes writes, recovers backup and survives a port change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-ledger-')), handlers = {}; let port = 7865;
  require('../agent-handoff-ipc.cjs').registerAgentHandoffIPC({ ipcMain: { handle: (n, fn) => handlers[n] = fn }, clipboard: {}, userData: dir, getPort: () => port });
  const frame = { url: 'http://127.0.0.1:7865/web.html' }, event = { senderFrame: frame, sender: { mainFrame: frame } };
  try {
    assert.equal(await handlers['agent-handoff:load'](event), '[]');
    await Promise.all([handlers['agent-handoff:save'](event, '[1]'), handlers['agent-handoff:save'](event, '[2]')]);
    port = 9999; frame.url = 'http://127.0.0.1:9999/web.html';
    assert.equal(await handlers['agent-handoff:load'](event), '[2]');
    fs.writeFileSync(path.join(dir, 'agent-handoff-tasks.json'), '{');
    assert.equal(await handlers['agent-handoff:load'](event), '[1]');
    await assert.rejects(handlers['agent-handoff:load']({ ...event, senderFrame: { url: frame.url } }), /仅允许/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function ledger(initial = '[]', legacy) {
  let disk = initial;
  const localStorage = memory(); if (legacy) localStorage.setItem('patentlens-agent-comparison-tasks', JSON.stringify(legacy));
  const c = vm.createContext({ console, AgentHandoffProtocol: protocol, localStorage, document: { readyState: 'loading', addEventListener() {} }, electronAPI: { agentHandoffLoad: async () => disk, agentHandoffSave: async raw => { disk = raw; return { ok: true }; } } });
  c.parent = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts/app/features/agent-transfer/task-workspace.js'), 'utf8'), c);
  await c.AgentTaskWorkspace.ready;
  return { api: c.AgentTaskWorkspace, disk: () => disk };
}
test('workspace migrates old tasks and atomically imports portable revisions without dropping local work', async () => {
  const task = await protocol.create({ taskType: 'report', label: '迁移', instructions: '分析', input: { sources: refs.textSources('s', '原文') } });
  const first = await ledger('[]', [task]);
  assert.equal(first.api.getStore().list().length, 1);
  const portable = await ledger();
  await portable.api.importBundle(first.api.exportBundle());
  const store = portable.api.getStore();
  await store.receive(envelope(task, { report: '异机修订', evidence: [] }), async () => '已校验');
  await portable.api.flush();
  await first.api.importBundle(portable.api.exportBundle());
  assert.equal(first.api.getStore().list()[0].revisions.length, 1);
  assert.equal(first.api.getStore().list()[0].status, 'returned');
  const before = first.disk(), bundle = JSON.parse(first.api.exportBundle());
  const second = await protocol.create({ taskType: 'report', label: '第二项', instructions: '分析', input: { sources: refs.textSources('s', '材料') } });
  bundle.tasks.unshift(second); bundle.tasks[1].input.sources[0].text = '篡改';
  await assert.rejects(first.api.importBundle(JSON.stringify(bundle)), /校验失败/);
  assert.equal(first.disk(), before, 'invalid later task must not partially import earlier tasks');
  const reopened = await ledger(first.disk());
  assert.equal(reopened.api.getStore().list()[0].revisions[0].payload.report, '异机修订');
});
