const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadShareModules(patentData) {
  const root = path.resolve(__dirname, '../src/scripts/app/share');
  const window = { _currentPatentData: patentData || null };
  const context = vm.createContext({ window, Date, Math, JSON });
  for (const name of ['share-field-merge.js', 'share-spreadsheet-import.js', 'share-module-registry.js', 'share-renderer.js', 'share-project-store.js', 'share-source-adapters.js']) {
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

test('manual review values are isolated from imported snapshots', () => {
  const { PatentShareStore } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'patent_1',
    patentNumber: 'US12030161B2',
    title: 'Imported title',
    fields: { title: { value: 'Imported title', source: 'google_patents' } },
    source: { type: 'google_patents', label: 'Google Patents' },
  });

  assert.equal(PatentShareStore.updatePatentField('patent_1', 'title', 'Reviewed title'), true);
  const field = PatentShareStore.getSnapshot().patents[0].fields.title;
  assert.equal(field.value, 'Reviewed title');
  assert.equal(field.source, 'manual');
  assert.equal(field.candidates.length, 2);
  assert.equal(field.candidates.some((candidate) => candidate.source === 'google_patents'), true);
  assert.equal(PatentShareStore.getSnapshot().patents[0].title, 'Reviewed title');
  assert.equal(PatentShareStore.updatePatentField('missing', 'title', 'Nope'), false);
});

test('field merge records conflicts instead of silently overwriting sources', () => {
  const { PatentShareFieldMerge } = loadShareModules();
  const first = PatentShareFieldMerge.createCandidate('First title', {
    source: 'google_patents', sourceRef: 'GP', capturedAt: '2026-08-01T00:00:00.000Z', confidence: 'high', reviewState: 'accepted',
  });
  const second = PatentShareFieldMerge.createCandidate('Spreadsheet title', {
    source: 'excel', sourceRef: 'Sheet1!A2', capturedAt: '2026-08-02T00:00:00.000Z', confidence: 'high', reviewState: 'pending',
  });
  const result = PatentShareFieldMerge.mergeField(first, second);
  assert.equal(result.hasConflict, true);
  assert.equal(result.field.source, 'excel');
  assert.equal(result.field.reviewState, 'conflict');
  assert.equal(result.field.candidates.length, 2);
});

test('manual candidate resolves a field conflict while retaining alternatives', () => {
  const { PatentShareFieldMerge } = loadShareModules();
  const imported = PatentShareFieldMerge.createCandidate('GP title', { source: 'google_patents', sourceRef: 'GP' });
  const spreadsheet = PatentShareFieldMerge.createCandidate('Excel title', { source: 'excel', sourceRef: 'Sheet1!A2' });
  const conflict = PatentShareFieldMerge.mergeField(imported, spreadsheet).field;
  const reviewed = PatentShareFieldMerge.mergeField(conflict, PatentShareFieldMerge.createCandidate('Reviewed title', {
    source: 'manual', sourceRef: 'review', reviewState: 'accepted',
  }));
  assert.equal(reviewed.hasConflict, false);
  assert.equal(reviewed.field.value, 'Reviewed title');
  assert.equal(reviewed.field.candidates.length, 3);
});

test('CSV import maps common fields, retains custom columns and parses quoted cells', () => {
  const { PatentShareSpreadsheetImport } = loadShareModules();
  const plan = PatentShareSpreadsheetImport.buildRecords(
    'Publication Number,Title,Applicant,Lab note\nUS12030161B2,"A title, with comma",Example Corp,Keep this',
    'patents.csv',
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].fields.title.value, 'A title, with comma');
  assert.equal(plan.records[0].fields.assignees.value, 'Example Corp');
  assert.equal(plan.records[0].customFields['csv:labnote'].field.value, 'Keep this');
  assert.deepEqual([...plan.unmappedHeaders], ['Lab note']);
});

test('CSV records merge with GP snapshots and report field conflicts', () => {
  const { PatentShareStore, PatentShareSpreadsheetImport } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'patent_1', patentNumber: 'US12030161B2', title: 'GP title',
    fields: { title: { value: 'GP title', source: 'google_patents', sourceRef: 'GP' } },
    source: { type: 'google_patents', label: 'Google Patents' },
  });
  const plan = PatentShareSpreadsheetImport.buildRecords('Patent Number,Title\nUS12030161B2,CSV title', 'patents.csv');
  const summary = PatentShareStore.importPatents(plan.records);
  assert.equal(summary.added, 0);
  assert.equal(summary.merged, 1);
  assert.equal(summary.conflicts, 1);
  const snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.patents.length, 1);
  assert.equal(snapshot.sources.length, 2);
  assert.equal(snapshot.patents[0].fields.title.reviewState, 'conflict');
});

test('spreadsheet row input reuses CSV mapping and accepts Excel extensions', () => {
  const { PatentShareSpreadsheetImport } = loadShareModules();
  const plan = PatentShareSpreadsheetImport.buildRecordsFromRows([
    ['公开号', '标题', '研发标签'],
    ['EP4252965A3', 'Excel 导入专利', '材料'],
  ], 'patents.xlsx', 'Excel', '专利清单');
  assert.equal(plan.ok, true);
  assert.equal(plan.records[0].source.label.includes('工作表 专利清单'), true);
  assert.equal(plan.records[0].fields.title.value, 'Excel 导入专利');
  assert.equal(plan.records[0].customFields['csv:研发标签'].field.value, '材料');
  assert.equal(PatentShareSpreadsheetImport.validateFile({ name: 'patents.xlsx', size: 10 }).ok, true);
  assert.equal(PatentShareSpreadsheetImport.validateFile({ name: 'patents.xls', size: 10 }).ok, true);
});

test('module registry protects required modules and renderer produces escaped offline HTML', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const config = PatentShareModules.defaultConfig();
  assert.equal(PatentShareModules.setModuleMode(config, 'S1', 'off'), null);
  assert.equal(PatentShareModules.setModuleMode(config, 'R1', 'full').modules.R1, 'full');
  const result = PatentShareRenderer.render({
    name: '研发 <分享>',
    patents: [{
      id: 'p1', patentNumber: 'US1', title: '<危险标题>',
      fields: { abstract: { value: '<script>alert(1)</script>', source: 'manual', reviewState: 'accepted' } },
      claims: [{ number: '1', text: 'A claim <tag>' }],
      source: { type: 'google_patents', label: 'GP', capturedAt: '2026-08-04T00:00:00.000Z' },
    }],
    moduleConfig: config,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.html.includes('<script>alert(1)</script>'), false);
  assert.equal(result.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(result.html.includes('https://'), false);
});

test('renderer flags sensitive project material before export', () => {
  const { PatentShareRenderer } = loadShareModules();
  const findings = PatentShareRenderer.scanSensitive({ fields: { token: 'token=secret-value' } }, '');
  assert.equal(findings.length > 0, true);
});

test('review can select a conflicting source candidate and unblock export', () => {
  const { PatentShareStore, PatentShareSpreadsheetImport, PatentShareRenderer } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'patent_1', patentNumber: 'US12030161B2', title: 'GP title',
    fields: { title: { value: 'GP title', source: 'google_patents', sourceRef: 'GP' } },
    source: { type: 'google_patents', label: 'Google Patents' },
  });
  const plan = PatentShareSpreadsheetImport.buildRecords('Patent Number,Title,Team label\nUS12030161B2,CSV title,Research', 'patents.csv');
  PatentShareStore.importPatents(plan.records);
  const before = PatentShareStore.getSnapshot();
  assert.equal(PatentShareRenderer.findPendingConflicts(before).length, 1);
  assert.equal(PatentShareStore.selectPatentFieldCandidate('patent_1', 'title', 1), true);
  const after = PatentShareStore.getSnapshot();
  assert.equal(after.patents[0].fields.title.reviewState, 'accepted');
  assert.equal(PatentShareRenderer.findPendingConflicts(after).length, 0);
  const rendered = PatentShareRenderer.render(after);
  assert.equal(rendered.html.includes('Team label'), true);
});

test('lite module modes reduce exported technical detail', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const config = PatentShareModules.defaultConfig();
  config.modules.S2 = 'lite';
  config.modules.S3 = 'lite';
  config.modules.S4 = 'lite';
  const result = PatentShareRenderer.render({
    name: 'Lite',
    patents: [{
      patentNumber: 'US1', title: 'Title',
      fields: {
        abstract: { value: 'A'.repeat(500), source: 'manual' },
        inventors: { value: 'Hidden inventor', source: 'manual' },
      },
      claims: [{ number: '1', text: 'Independent', type: 'independent' }, { number: '2', text: 'Dependent', type: 'dependent' }],
    }],
    moduleConfig: config,
  });
  assert.equal(result.html.includes('Hidden inventor'), false);
  assert.equal(result.html.includes('Dependent'), false);
  assert.equal(result.html.includes('AAAA…'), true);
});

test('PDF OCR snapshot is associated with a patent without retaining PDF bytes', () => {
  const { PatentShareStore, PatentShareModules, PatentShareRenderer } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'patent_1', patentNumber: 'US12030161B2', title: 'OCR patent',
    source: { type: 'google_patents', label: 'Google Patents' },
  });
  const added = PatentShareStore.addOcrSource('patent_1', {
    engine: 'paddle_ocr_vl', text: 'OCR extracted text', markdown: '# OCR extracted text', blocks: [{ page: 1, content: 'OCR extracted text' }],
  }, 'material.pdf');
  assert.equal(added.ok, true);
  const snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.patents[0].ocrSources.length, 1);
  assert.equal(JSON.stringify(snapshot).includes('base64'), false);
  const config = PatentShareModules.defaultConfig();
  config.modules.R7 = 'full';
  const rendered = PatentShareRenderer.render({ ...snapshot, moduleConfig: config });
  assert.equal(rendered.html.includes('OCR extracted text'), true);
});

test('manual research summary is isolated and rendered only when R1 is enabled', () => {
  const { PatentShareStore, PatentShareModules, PatentShareRenderer } = loadShareModules();
  PatentShareStore.setResearchSummary({ problem: '降低热损失', approach: '优化层压结构', effect: '提升效率', openQuestions: '验证耐久性' });
  const snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.researchSummary.problem, '降低热损失');
  const disabled = PatentShareRenderer.render(snapshot);
  assert.equal(disabled.html.includes('降低热损失'), false);
  const config = PatentShareModules.defaultConfig();
  config.modules.R1 = 'full';
  const enabled = PatentShareRenderer.render({ ...snapshot, moduleConfig: config });
  assert.equal(enabled.html.includes('优化层压结构'), true);
});

test('store degrades to session memory when IndexedDB is unavailable', async () => {
  const { PatentShareStore } = loadShareModules();
  const initialized = await PatentShareStore.initialize();
  assert.equal(initialized, false);
  assert.deepEqual({ ...PatentShareStore.getPersistenceState() }, {
    mode: 'memory',
    error: 'IndexedDB unavailable',
  });
});

test('memory fallback exposes only the active project in its project list', async () => {
  const { PatentShareStore } = loadShareModules();
  await PatentShareStore.initialize();
  PatentShareStore.renameProject('Temporary project');
  const projects = await PatentShareStore.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Temporary project');
  const selected = await PatentShareStore.selectProject(projects[0].id);
  assert.equal(selected.ok, true);
  assert.equal(selected.project.name, 'Temporary project');
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
