const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadShareModules(patentData) {
  const root = path.resolve(__dirname, '../src/scripts/app/share');
  const window = { _currentPatentData: patentData || null };
  const context = vm.createContext({ window, Date, Math, JSON });
  for (const name of ['share-project-store.js', 'share-source-adapters.js']) {
    const file = path.join(root, name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return window;
}

test('share project snapshots are isolated and deduplicate patent numbers', () => {
  const { PatentShareStore } = loadShareModules();
  const before = PatentShareStore.getSnapshot();
  assert.equal(before.patents.length, 0);

  const record = {
    id: 'patent_1',
    patentNumber: 'US12030161B2',
    title: '示例专利',
    source: { type: 'google_patents', label: 'Google Patents', capturedAt: new Date().toISOString() },
  };
  assert.equal(PatentShareStore.addPatent(record).ok, true);
  assert.equal(PatentShareStore.addPatent({ ...record, id: 'patent_2' }).reason, 'duplicate');

  const snapshot = PatentShareStore.getSnapshot();
  snapshot.patents[0].title = '不应写回';
  assert.equal(PatentShareStore.getSnapshot().patents[0].title, '示例专利');
  assert.equal(PatentShareStore.removePatent('patent_1'), true);
  assert.equal(PatentShareStore.getSnapshot().sources.length, 0);
});

test('current GP data is copied into a normalized share snapshot', () => {
  const { PatentShareSources } = loadShareModules({
    patent_number: 'EP4252965A3',
    title: '用于测试的专利',
    abstract: '摘要内容',
    application_date: '2022-01-01',
    publication_date: '2023-10-11',
    assignees: ['申请人 A'],
    inventors: ['发明人 B'],
    claims: [{ num: '1', text: '一种装置', type: 'independent' }],
    data_source: 'Google Patents',
    url: 'https://patents.google.com/patent/EP4252965A3',
  });

  const snapshot = PatentShareSources.currentPatentSnapshot();
  assert.equal(snapshot.patentNumber, 'EP4252965A3');
  assert.equal(snapshot.title, '用于测试的专利');
  assert.equal(snapshot.fields.assignees.value, '申请人 A');
  assert.deepEqual({ ...snapshot.claims[0] }, { number: '1', text: '一种装置', type: 'independent' });
  assert.equal(snapshot.source.type, 'google_patents');
});
