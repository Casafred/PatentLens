const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const protocol = require('../src/scripts/app/features/agent-transfer/task-protocol.js');
const refs = require('../src/scripts/app/features/agent-transfer/source-references.js');
function setup() {
  const snapshot = { dossier: 'US:123', document: { id: 'OA1', idx: 1, name: 'Office Action', pages: 3 }, attachment: { url: '/api/doc1', fileName: 'OA1.pdf' }, extraction: { text: 'A motor drives a housing.' } };
  let rows = [];
  const kb = { documents: [{ idx: 1, docId: 'OA1', name: 'Office Action', numberOfPages: 3 }], extractions: { 1: snapshot.extraction } };
  const c = vm.createContext({ console, TextEncoder, crypto: webcrypto, AgentHandoffProtocol: protocol, AgentSourceReferences: refs,
    document: { readyState: 'loading', addEventListener() {} }, currentData: { office: 'US', applicationNumber: '123' }, kanbanState: kb, pdfViewState: { currentDocIdx: 1 },
    TransferContext: { getKanban: () => kb }, TransferFileDock: { describePayloads: () => [snapshot.attachment] },
    AgentTaskWorkspace: { getStore: () => ({ list: () => rows, put: t => { rows = [t]; } }), flush: async () => {} }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/scripts/app/features/agent-transfer/reader-handoff.js'), 'utf8'), c);
  return { c, api: c.ReaderAgentHandoff, snapshot, kb, put: t => { rows = [t]; } };
}
test('reader OCR works without existing OCR and freezes PDF/document identity', async () => {
  const { api, snapshot } = setup(); snapshot.extraction = null;
  const task = await api.create('document-ocr', snapshot, '', 'zh');
  snapshot.document.id = 'changed';
  assert.equal(task.input.document.id, 'OA1');
  assert.match(protocol.prompt(task), /OA1.pdf/);
  assert.equal(task.input.sources.length, 0);
  api.validate(task, { pages: [{ page: 1, text: 'OCR' }] });
  for (const pages of [[{ page: 4, text: 'outside' }], [{ page: 1, text: '' }], [{ page: 1, text: 'a' }, { page: 1, text: 'b' }]]) assert.throws(() => api.validate(task, { pages }));
});
test('reader translation requires complete verbatim source coverage', async () => {
  const { api, snapshot } = setup();
  snapshot.extraction = { blocks: [{ block_id: '1', page: 1, content: 'First.' }, { block_id: '2', page: 2, content: 'Second.' }] };
  const task = await api.create('document-translation', snapshot, '', 'zh');
  const payload = { segments: task.input.sources.map(s => ({ sourceId: s.id, original: s.text, translated: '译文' })) };
  api.validate(task, payload);
  assert.throws(() => api.validate(task, { segments: payload.segments.slice(1) }), /完整覆盖/);
  assert.throws(() => api.validate(task, { segments: [{ ...payload.segments[0], original: 'invented' }] }), /原文/);
  const selected = await api.create('document-translation', snapshot, '', 'zh', ['2']);
  assert.equal(selected.input.sources.length, 1); assert.equal(selected.input.sources[0].text, 'Second.');
  await assert.rejects(api.create('document-translation', { ...snapshot, extraction: null }, '', 'zh'), /OCR/);
});
test('reader adoption refuses another dossier, changed OCR and changes during disk flush', async () => {
  const { c, api, snapshot, kb, put } = setup();
  const task = await api.create('document-qa', snapshot, 'What drives the housing?', 'zh'); put(task);
  const payload = { report: '电机。', evidence: [{ sourceId: task.input.sources[0].id, quote: 'A motor' }] };
  api.validate(task, payload);
  assert.throws(() => api.validate(task, { report: '回答', evidence: [{ sourceId: task.input.sources[0].id, quote: 'invented' }] }), /引文/);
  c.currentData.applicationNumber = '999'; await assert.rejects(api.accept(task, payload, 'revision'), /同一案卷/);
  c.currentData.applicationNumber = '123'; kb.extractions[1] = { text: 'new OCR' }; await assert.rejects(api.accept(task, payload, 'revision'), /已变化/);
  kb.extractions[1] = snapshot.extraction;
  c.AgentTaskWorkspace.flush = async () => { c.pdfViewState.currentDocIdx = 2; };
  await assert.rejects(api.accept(task, payload, 'revision'), /打开一篇|切换/);
});

test('reader handoff packs prompt and PDF into one quick panel', async () => {
  const { c, api } = setup();
  let captured = null;
  c.HandoffQuickPanel = { open: (options) => { captured = options; } };
  c.document.getElementById = (id) => ({ value: id === 'chat-input' ? 'What drives the housing?' : 'zh' });
  await api.open('document-qa');
  assert.ok(captured, '应打开一步打包面板');
  assert.match(captured.prompt, /What drives the housing\?/);
  assert.equal(captured.attachment.url, '/api/doc1');
  assert.equal(typeof captured.onImport, 'function');
});
