const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const protocol = require('../src/scripts/app/features/agent-transfer/task-protocol.js');

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
async function fixture() {
  const storage = memory(), store = protocol.createStore(storage, 'tasks');
  const task = await protocol.create({ taskType: 'claim-graph', label: '权利要求7', input: { claim: { rawText: 'A housing connected to a motor.' } }, instructions: 'Extract nodes and edges.', target: { fileId: 'f1' } });
  store.put(task);
  const envelope = payload => JSON.stringify({ kind: 'patentlens-agent-result', schemaVersion: 1, taskId: task.taskId, taskType: task.taskType, sourceHash: task.sourceHash, payload });
  return { storage, store, task, envelope };
}

test('Agent task freezes original input and hashes independently of object key order', async () => {
  const input = { claim: '原文', metadata: { b: 2, a: 1 } };
  const task = await protocol.create({ taskType: 'claim-graph', label: '图', input, instructions: 'go' });
  input.claim = '修改';
  assert.equal(task.input.claim, '原文');
  assert.equal(await protocol.hash({ x: 1, y: 2 }), await protocol.hash({ y: 2, x: 1 }));
  assert.match(protocol.prompt(task), new RegExp(task.sourceHash));
  assert.match(protocol.prompt(task), /payload/);
});

test('Agent result accepts fenced answers, preserves raw return and rejects duplicate imports across reload', async () => {
  const { storage, store, task, envelope } = await fixture();
  const raw = '分析完成\n```json\n' + envelope({ nodes: [1] }) + '\n```';
  let applied = 0;
  await store.receive(raw, async () => { applied++; return '图已生成'; });
  assert.equal(store.list()[0].lastAttempt.raw, raw);
  assert.equal(store.list()[0].status, 'returned');
  const reopened = protocol.createStore(storage, 'tasks');
  await assert.rejects(reopened.receive(raw, async () => { applied++; }), /已经导入/);
  assert.equal(applied, 1);
  assert.equal(reopened.list()[0].taskId, task.taskId);
  await reopened.receive(envelope({ nodes: [1, 2] }), async () => { applied++; });
  assert.equal(applied, 2, 'corrected results become a new version');
});

test('wrong source, changed task input, unknown task and wrong result type never reach the adapter', async () => {
  const { task, store, envelope } = await fixture();
  let applied = 0;
  const result = JSON.parse(envelope({ nodes: [] }));
  result.sourceHash = 'wrong';
  await assert.rejects(store.receive(JSON.stringify(result), async () => applied++), /版本不匹配/);
  assert.equal(store.list()[0].status, 'pending');
  assert.match(store.list()[0].lastAttempt.error, /版本不匹配/);
  result.sourceHash = task.sourceHash; result.taskType = 'family-comparison';
  await assert.rejects(store.receive(JSON.stringify(result), async () => applied++), /类型或原文/);
  result.taskType = task.taskType; result.taskId = 'not-here';
  await assert.rejects(store.receive(JSON.stringify(result), async () => applied++), /未找到/);
  task.input.claim.rawText = 'changed'; store.put(task);
  await assert.rejects(store.receive(envelope({ nodes: [] }), async () => applied++), /原文版本/);
  assert.equal(applied, 0);
});

test('failed adapter preserves answer for repair and retry; malformed envelopes are not repaired into partial results', async () => {
  const { store, envelope } = await fixture();
  const raw = envelope({ bad: true });
  await assert.rejects(store.receive(raw, async () => { throw new Error('节点原文缺失'); }), /原文缺失/);
  assert.equal(store.list()[0].lastAttempt.raw, raw);
  assert.match(store.list()[0].lastAttempt.error, /原文缺失/);
  await store.receive(raw, async () => 'fixed');
  assert.throws(() => protocol.parse(raw.slice(0, -4)), /完整/);
  assert.throws(() => protocol.parse('```json\n' + raw + '\n```\n```json\n' + raw + '\n```'), /一个完整/);
  assert.throws(() => protocol.parse('x'.repeat(protocol.MAX_TEXT + 1)), /4 MB/);
  const task = store.list()[0];
  await assert.rejects(store.receive('JSON 被截断：{', async () => {}, task.taskId), /完整/);
  assert.equal(protocol.createStore({ getItem: () => JSON.stringify(store.list()) }, 'tasks').list()[0].lastAttempt.raw, 'JSON 被截断：{');
});

test('task quota and corrupt storage do not silently discard pending tasks', async () => {
  const { storage, task } = await fixture();
  const small = protocol.createStore(storage, 'small', 100);
  assert.throws(() => small.put(task), /空间不足/);
  assert.equal(storage.getItem('small'), null);
  storage.setItem('corrupt', '{');
  assert.throws(() => protocol.createStore(storage, 'corrupt').list(), /无法读取/);
});

test('desktop clipboard IPC only accepts bounded text from the local main frame', () => {
  let handler, copied = '';
  require('../agent-handoff-ipc.cjs').registerAgentHandoffIPC({ ipcMain: { handle(_name, fn) { handler = fn; } }, clipboard: { writeText(text) { copied = text; } }, getPort: () => 7865 });
  const frame = { url: 'http://127.0.0.1:7865/web.html' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  assert.deepEqual(handler(event, '完整任务'), { ok: true });
  assert.equal(copied, '完整任务');
  assert.throws(() => handler({ ...event, senderFrame: { url: frame.url } }, 'bad'), /仅允许/);
  frame.url = 'https://example.com/web.html';
  assert.throws(() => handler(event, 'bad'), /仅允许/);
  frame.url = 'http://127.0.0.1:7865/web.html';
  assert.throws(() => handler(event, 'x'.repeat(8 * 1024 * 1024 + 1)), /过大/);
  assert.equal(copied, '完整任务');
});

function comparisonFixture() {
  const localStorage = memory();
  const context = vm.createContext({ console, localStorage, crypto: webcrypto, TextEncoder, Uint8Array, setTimeout, clearTimeout });
  context.window = context;
  context.ComparisonUI = { render() {} };
  const files = ['comparison/comparison-utils.js', 'app/features/family-scope.js', 'comparison/comparison-prompts.js', 'comparison/comparison-core.js', 'app/features/agent-transfer/task-protocol.js', 'app/features/agent-transfer/comparison-handoff.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts', file), 'utf8'), context, { filename: file });
  context.ComparisonCore.addItem({ id: 'c1', label: 'CN 权1', originalText: '一种装置，包括处理器。' });
  context.ComparisonCore.addItem({ id: 'c2', label: 'US claim1', originalText: 'An apparatus comprising a processor.' });
  return context;
}

test('family handoff returns to existing tree and history; unsupported evidence becomes uncertain and report HTML stays inert', async () => {
  const c = comparisonFixture(), task = await c.ComparisonHandoff.createTask();
  const payload = { report: '<img src=x onerror=alert(1)>', familyScope: { version: 1, features: [{ id: 'F1', label: '处理器' }],
    claims: task.input.items.map(item => ({ itemId: item.id, cells: [{ featureId: 'F1', status: 'present', confidence: 0.9,
      evidence: [{ sourceId: item.id, quote: item.id === 'c1' ? '处理器' : 'invented quotation' }] }] })) } };
  const outcome = await c.ComparisonHandoff.apply(task, payload, 'hash');
  assert.match(outcome, /需核对/);
  const result = c.ComparisonCore.getResult();
  const checked = c.FamilyScope.analyze(result.markdownContent, result.items, result.scopeSources, result.anchor.id);
  assert.equal(checked.model.claims[0].cells[0].status, 'present');
  assert.equal(checked.model.claims[1].cells[0].status, 'uncertain');
  assert.ok(c.ComparisonCore.history.get(result.sessionId));
  assert.doesNotMatch(result.htmlContent, /<img/);
  c.ComparisonCore.updateItem('c1', { originalText: '原文已经修改' });
  await assert.rejects(c.ComparisonHandoff.apply(task, payload, 'other'), /原文已修改/);
});

test('incomplete family return is rejected without creating an empty tree or replacing history', async () => {
  const c = comparisonFixture(), task = await c.ComparisonHandoff.createTask();
  await assert.rejects(c.ComparisonHandoff.apply(task, { familyScope: { version: 1, features: [{ id: 'F1', label: '处理器' }], claims: [] } }, 'h'), /遗漏/);
  assert.equal(c.ComparisonCore.getResult(), null);
  assert.equal(c.ComparisonCore.history.getAll().length, 0);
});
