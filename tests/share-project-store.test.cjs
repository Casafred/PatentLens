const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadShareModules(patentData) {
  const root = path.resolve(__dirname, '../src/scripts/app/share');
  const window = { _currentPatentData: patentData || null };
  const context = vm.createContext({ window, Date, Math, JSON });
  for (const name of ['share-field-merge.js', 'share-spreadsheet-import.js', 'share-module-registry.js', 'share-renderer.js', 'share-project-store.js', 'share-source-adapters.js', 'share-ai.js']) {
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
  // Regression: each source must be linked to the actual patent id so removePatent cleans up
  // every tracked source and the UI per-patent count is correct.
  assert.equal(snapshot.sources.every((s) => s.patentId === snapshot.patents[0].id), true);
  PatentShareStore.removePatent(snapshot.patents[0].id);
  assert.equal(PatentShareStore.getSnapshot().sources.length, 0);
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

test('AI drafts block share export until an IPR reviewer confirms them', () => {
  const { PatentShareStore, PatentShareModules, PatentShareRenderer } = loadShareModules();
  PatentShareStore.addPatent({ id: 'p1', patentNumber: 'US1', title: 'AI review', source: { type: 'manual', label: 'Manual' } });
  PatentShareStore.setAIAnalysis('p1', 'summary', { content: 'AI draft content', model: 'test-model' });
  const config = PatentShareModules.defaultConfig();
  config.modules.R1 = 'full';
  let rendered = PatentShareRenderer.render({ ...PatentShareStore.getSnapshot(), moduleConfig: config });
  assert.equal(rendered.findings.some((finding) => finding.includes('未审核 AI')), true);
  assert.equal(PatentShareStore.updateAIAnalysis('p1', 'summary', { reviewState: 'accepted' }), true);
  rendered = PatentShareRenderer.render({ ...PatentShareStore.getSnapshot(), moduleConfig: config });
  assert.equal(rendered.findings.some((finding) => finding.includes('未审核 AI')), false);
});

test('processed module order is persisted and changes export order', () => {
  const { PatentShareStore, PatentShareModules, PatentShareRenderer } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'p1', patentNumber: 'US1', title: 'Ordered modules', source: { type: 'manual', label: 'Manual' },
    aiAnalysis: {
      summary: { content: 'Summary draft', reviewState: 'accepted' },
      elements: { content: '{"components":[]}', parsed: { components: [] }, reviewState: 'accepted' },
    },
  });
  const config = PatentShareModules.defaultConfig();
  config.modules.R1 = 'full';
  config.modules.R2 = 'full';
  config.moduleOrder.processed = ['R2', 'R1'];
  PatentShareStore.setModuleConfig(config);
  const snapshot = PatentShareStore.getSnapshot();
  assert.deepEqual([...snapshot.moduleConfig.moduleOrder.processed.slice(0, 2)], ['R2', 'R1']);
  const rendered = PatentShareRenderer.render(snapshot);
  assert.equal(rendered.html.indexOf('技术要素与系统结构') < rendered.html.indexOf('技术解读（AI）'), true);
});

test('annotations use raw text offsets when content includes HTML-sensitive characters', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const config = PatentShareModules.defaultConfig();
  const rendered = PatentShareRenderer.render({
    name: 'Annotations', moduleConfig: config,
    patents: [{
      patentNumber: 'US1', title: 'Claim annotation', source: { type: 'manual', label: 'Manual' },
      claims: [{ number: '1', text: 'A & B', type: 'independent' }],
      claimsAnnotations: [{ id: 'a1', key: '1', type: 'highlight', start: 2, end: 3, text: '&' }],
    }],
  });
  assert.equal(rendered.html.includes('<mark class="anno-highlight">&amp;</mark>'), true);
});

test('dependent-claim annotations use raw text offsets like independent claims', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const config = PatentShareModules.defaultConfig();
  // S4 defaults to "lite", which strips dependent claims; switch to "full" so the
  // dependent claim is actually rendered and its annotation offsets are exercised.
  config.modules.S4 = 'full';
  const rendered = PatentShareRenderer.render({
    name: 'Dependent annotations', moduleConfig: config,
    patents: [{
      patentNumber: 'US1', title: 'Dep claim', source: { type: 'manual', label: 'Manual' },
      claims: [
        { number: '1', text: 'Independent base', type: 'independent' },
        { number: '2', text: 'A & B C', type: 'dependent' },
      ],
      // Highlight the 'B' which sits after an HTML-sensitive '&' in the raw text.
      // Offsets must be computed against raw text; if applied to escaped text the
      // highlight would land on 'm' (inside &amp;) instead of 'B'.
      claimsAnnotations: [{ id: 'a1', key: '2', type: 'highlight', start: 4, end: 5, text: 'B' }],
    }],
  });
  assert.equal(rendered.html.includes('<mark class="anno-highlight">B</mark>'), true);
  assert.equal(rendered.html.includes('<mark class="anno-highlight">m</mark>'), false);
});

test('removeAnnotation deletes a single annotation while preserving the others', () => {
  const { PatentShareStore } = loadShareModules();
  PatentShareStore.addPatent({
    id: 'patent_1', patentNumber: 'US1', title: 'Anno patent', source: { type: 'manual', label: 'Manual' },
  });
  PatentShareStore.addAnnotation('patent_1', { field: 'claims', key: '1', type: 'underline', start: 0, end: 3, text: 'abc' });
  PatentShareStore.addAnnotation('patent_1', { field: 'claims', key: '1', type: 'highlight', start: 5, end: 8, text: 'def' });

  let snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.patents[0].claimsAnnotations.length, 2);
  const firstId = snapshot.patents[0].claimsAnnotations[0].id;

  // Removing a non-existent id is a no-op.
  assert.equal(PatentShareStore.removeAnnotation('patent_1', 'claims', 'missing_id'), false);
  assert.equal(PatentShareStore.getSnapshot().patents[0].claimsAnnotations.length, 2);

  // Remove only the first annotation; the second must remain intact with its own id.
  assert.equal(PatentShareStore.removeAnnotation('patent_1', 'claims', firstId), true);
  snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.patents[0].claimsAnnotations.length, 1);
  assert.equal(snapshot.patents[0].claimsAnnotations[0].text, 'def');
  assert.equal(snapshot.patents[0].claimsAnnotations[0].id !== firstId, true);

  // Removing the last annotation leaves an empty array (not undefined), so the
  // per-annotation deletion entry renders nothing afterwards.
  const lastId = snapshot.patents[0].claimsAnnotations[0].id;
  assert.equal(PatentShareStore.removeAnnotation('patent_1', 'claims', lastId), true);
  assert.equal(PatentShareStore.getSnapshot().patents[0].claimsAnnotations.length, 0);
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
  assert.equal(snapshot.claims[0].number, '1');
  assert.equal(snapshot.claims[0].text, '一种装置');
  assert.equal(snapshot.claims[0].type, 'independent');
  assert.equal(Array.isArray(snapshot.claims[0].references), true);
  assert.equal(snapshot.claims[0].references.length, 0);
  assert.equal(snapshot.source.type, 'google_patents');
});

test('S6 module is removed from registry and rendered HTML carries PatentLens watermark instead', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const modules = PatentShareModules.list();
  assert.equal(modules.some((m) => m.id === 'S6'), false);
  assert.equal(modules.some((m) => m.id === 'S7'), true);
  const config = PatentShareModules.defaultConfig();
  assert.equal(config.modules.S6, undefined);
  const rendered = PatentShareRenderer.render({
    name: 'Watermark', moduleConfig: config,
    patents: [{ patentNumber: 'US1', title: 'W', source: { type: 'manual', label: 'Manual' } }],
  });
  // 来源与声明模块的内容不应再出现
  assert.equal(rendered.html.includes('来源内容来自项目快照'), false);
  // 由 PatentLens 制作 水印必须出现在导出 HTML 中
  assert.equal(rendered.html.includes('patentlens-watermark'), true);
  assert.equal(rendered.html.includes('PatentLens</span>'), true);
});

test('renderMarkdownSimple supports GFM tables, fenced code blocks and inline formatting', () => {
  const { PatentShareRenderer } = loadShareModules();
  const render = PatentShareRenderer.renderMarkdownSimple;
  const tableMd = '| 维度 | 取值 |\n| --- | --- |\n| 温度 | 25℃ |\n| 压力 | 1atm |';
  const tableHtml = render(tableMd);
  assert.equal(tableHtml.includes('<table class="md-table">'), true);
  assert.equal(tableHtml.includes('<th>维度</th>'), true);
  assert.equal(tableHtml.includes('<td>25℃</td>'), true);

  const codeMd = '```js\nconst x = 1;\n```';
  const codeHtml = render(codeMd);
  assert.equal(codeHtml.includes('<pre class="md-code">'), true);
  assert.equal(codeHtml.includes('const x = 1;'), true);
  // 代码块内容不应被行内格式化规则误伤
  assert.equal(codeHtml.includes('<strong>'), false);

  const md = '## 标题\n**粗体** *斜体* `code`';
  const html = render(md);
  assert.equal(html.includes('<h3>标题</h3>'), true);
  assert.equal(html.includes('<strong>粗体</strong>'), true);
  assert.equal(html.includes('<em>斜体</em>'), true);
  assert.equal(html.includes('<code>code</code>'), true);
});

test('figure-text comparison: 图N references become clickable links and figure rail renders when S7 enabled', () => {
  const { PatentShareModules, PatentShareRenderer } = loadShareModules();
  const config = PatentShareModules.defaultConfig();
  config.modules.S4 = 'full';
  config.modules.S5 = 'full';
  config.modules.S7 = 'full';
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const rendered = PatentShareRenderer.render({
    name: '图文对照', moduleConfig: config,
    patents: [{
      patentNumber: 'US1', title: 'Figures', source: { type: 'manual', label: 'Manual' },
      claims: [{ number: '1', text: '参见 图1 所示的结构。', type: 'independent' }],
      description: '说明书提到 图2 的实施方式。',
      figures: [{ dataUrl: tinyPng, caption: '结构图' }, { dataUrl: tinyPng, caption: '实施方式' }],
    }],
  });
  // 正文「图1」「图2」被转换为可点击链接
  assert.equal(rendered.html.includes('class="fig-ref"'), true);
  assert.equal(rendered.html.includes('data-fig-index="1"'), true);
  assert.equal(rendered.html.includes('data-fig-index="2"'), true);
  // 左文右图分栏布局生效
  assert.equal(rendered.html.includes('source-split'), true);
  assert.equal(rendered.html.includes('source-figures'), true);
  assert.equal(rendered.html.includes('fig-mini'), true);
});

test('project-level AI prompt overrides persist and propagate to getAIPrompt', () => {
  const { PatentShareStore, PatentShareAI } = loadShareModules();
  // 默认值：getAIPrompt 返回内置默认
  const defaultSummary = PatentShareAI.getAIPrompt('summary');
  assert.equal(defaultSummary.length > 0, true);
  assert.equal(defaultSummary.includes('专利技术信息分析师'), true);

  // 覆盖单条组合判断提示词
  assert.equal(PatentShareStore.setAIPrompt('summary', '自定义技术解读提示词。'), true);
  assert.equal(PatentShareStore.getAIPrompt('summary'), '自定义技术解读提示词。');
  assert.equal(PatentShareAI.getAIPrompt('summary'), '自定义技术解读提示词。');

  // 未覆盖的项仍返回内置默认
  assert.equal(PatentShareAI.getAIPrompt('elements').includes('结构化技术要素'), true);

  // 非法 key 被拒绝
  assert.equal(PatentShareStore.setAIPrompt('unknown', 'x'), false);

  // 空字符串清除覆盖，回退到内置默认
  assert.equal(PatentShareStore.setAIPrompt('summary', ''), true);
  assert.equal(PatentShareAI.getAIPrompt('summary'), defaultSummary);
});

test('field preset prompt overrides surface through fieldPresets()', () => {
  const { PatentShareStore, PatentShareModules } = loadShareModules();
  const before = PatentShareModules.fieldPresets();
  const techProblem = before.find((p) => p.label === '技术问题');
  assert.equal(techProblem.modified, false);
  const originalPrompt = techProblem.prompt;

  // 覆盖预设提示词
  assert.equal(PatentShareStore.setFieldPresetPrompt('技术问题', '自定义问题提示词', 'text'), true);
  const after = PatentShareModules.fieldPresets();
  const overridden = after.find((p) => p.label === '技术问题');
  assert.equal(overridden.prompt, '自定义问题提示词');
  assert.equal(overridden.modified, true);
  assert.equal(overridden.defaultPrompt, originalPrompt);

  // 空字符串清除覆盖
  assert.equal(PatentShareStore.setFieldPresetPrompt('技术问题', '', 'text'), true);
  const reset = PatentShareModules.fieldPresets().find((p) => p.label === '技术问题');
  assert.equal(reset.prompt, originalPrompt);
  assert.equal(reset.modified, false);
});

test('project-level AI context scope normalizes and persists abstract/claims/description/annotations', () => {
  const { PatentShareStore } = loadShareModules();
  const defaults = PatentShareStore.getAIContextScope();
  assert.deepEqual(defaults, { abstract: true, claims: true, description: true, annotations: true });

  PatentShareStore.setAIContextScope({ abstract: false, claims: true, description: false });
  const next = PatentShareStore.getAIContextScope();
  // 缺失的 key 被补全为 true（保持历史行为）
  assert.equal(next.abstract, false);
  assert.equal(next.claims, true);
  assert.equal(next.description, false);
  assert.equal(next.annotations, true);

  // 持久化到快照
  const snapshot = PatentShareStore.getSnapshot();
  assert.equal(snapshot.aiContextScope.abstract, false);
});

test('field-level context scope inherits project default when null, or uses custom scope when set', () => {
  const { PatentShareStore } = loadShareModules();
  PatentShareStore.setAIContextScope({ abstract: false, claims: true, description: true, annotations: true });
  PatentShareStore.addPatent({ id: 'p1', patentNumber: 'US1', title: 'Scope', source: { type: 'manual', label: 'Manual' } });
  const addResult = PatentShareStore.addProcessedField('p1', '核心方案', '提取核心方案', 'list');
  assert.equal(addResult.ok, true);

  // 默认 contextScope 为 null（继承项目级）
  let snap = PatentShareStore.getSnapshot();
  assert.equal(snap.patents[0].processedFields[0].contextScope, null);

  // 设置字段级覆盖
  assert.equal(PatentShareStore.updateProcessedField('p1', snap.patents[0].processedFields[0].id, { contextScope: { abstract: true, claims: false, description: true, annotations: false } }), true);
  snap = PatentShareStore.getSnapshot();
  assert.deepEqual(snap.patents[0].processedFields[0].contextScope, { abstract: true, claims: false, description: true, annotations: false });

  // 恢复为继承项目级
  assert.equal(PatentShareStore.updateProcessedField('p1', snap.patents[0].processedFields[0].id, { contextScope: null }), true);
  snap = PatentShareStore.getSnapshot();
  assert.equal(snap.patents[0].processedFields[0].contextScope, null);
});

test('processed modules expose dataSource and analysisKey so users can trace content origin', () => {
  const { PatentShareModules } = loadShareModules();
  const list = PatentShareModules.list();
  const r1 = list.find((m) => m.id === 'R1');
  const r4 = list.find((m) => m.id === 'R4');
  const r5 = list.find((m) => m.id === 'R5');
  assert.equal(r1.dataSource.includes('技术解读'), true);
  assert.equal(r1.analysisKey, 'summary');
  assert.equal(r4.dataSource.includes('实施例与验证'), true);
  assert.equal(r4.analysisKey, 'embodiments');
  assert.equal(r5.dataSource.includes('多专利技术路线对比'), true);
  assert.equal(r5.analysisKey, 'comparison');
  // 基础模块不带 dataSource（来源是 GP/Excel/OCR，而非组合判断）
  const s2 = list.find((m) => m.id === 'S2');
  assert.equal(s2.dataSource, undefined);
});

test('buildPatentContext filters content by AI context scope', () => {
  const { PatentShareStore, PatentShareAI } = loadShareModules();
  const patent = {
    patentNumber: 'US1', title: 'Scope filter',
    fields: { abstract: { value: '摘要内容', source: 'manual' } },
    claims: [{ number: '1', text: '权项内容', type: 'independent' }],
    description: '说明书内容',
    claimsAnnotations: [],
    descriptionAnnotations: [],
  };
  // 全部纳入
  const full = PatentShareAI.buildPatentContext(patent, {}, { abstract: true, claims: true, description: true, annotations: true });
  assert.equal(full.includes('摘要内容'), true);
  assert.equal(full.includes('权项内容'), true);
  assert.equal(full.includes('说明书内容'), true);

  // 仅摘要
  const onlyAbs = PatentShareAI.buildPatentContext(patent, {}, { abstract: true, claims: false, description: false, annotations: false });
  assert.equal(onlyAbs.includes('摘要内容'), true);
  assert.equal(onlyAbs.includes('权项内容'), false);
  assert.equal(onlyAbs.includes('说明书内容'), false);

  // 关闭所有
  const empty = PatentShareAI.buildPatentContext(patent, {}, { abstract: false, claims: false, description: false, annotations: false });
  assert.equal(empty.includes('摘要内容'), false);
  assert.equal(empty.includes('权项内容'), false);
  assert.equal(empty.includes('说明书内容'), false);
});

test('multiple patents each carry independent processedFields for batch AI processing', () => {
  const { PatentShareStore } = loadShareModules();
  // 模拟一次输入 N 篇专利的批量场景：每篇都应有独立的加工字段槽位，
  // 字段级 contextScope 缺省为 null（继承项目级），便于批量处理时统一按项目级范围抽取。
  PatentShareStore.setAIContextScope({ abstract: true, claims: true, description: false, annotations: false });
  ['US1', 'US2', 'US3'].forEach(function (num, i) {
    PatentShareStore.addPatent({
      id: 'p' + i, patentNumber: num, title: 'T' + i,
      source: { type: 'manual', label: 'Manual' },
    });
  });
  const snap1 = PatentShareStore.getSnapshot();
  snap1.patents.forEach(function (p, i) {
    const r = PatentShareStore.addProcessedField(p.id, '核心方案', '提取核心方案', 'list');
    assert.equal(r.ok, true);
  });
  const snap2 = PatentShareStore.getSnapshot();
  // 每篇都恰好 1 个加工字段，且 contextScope 默认 null（继承项目级 description=false）
  snap2.patents.forEach(function (p) {
    assert.equal(p.processedFields.length, 1);
    assert.equal(p.processedFields[0].contextScope, null);
    assert.equal(p.processedFields[0].label, '核心方案');
  });
  // 每篇独立写入 AI 结果，互不影响（批量并发写入的安全性）
  assert.equal(PatentShareStore.updateProcessedField('p0', snap2.patents[0].processedFields[0].id, { value: 'v0', source: 'ai' }), true);
  assert.equal(PatentShareStore.updateProcessedField('p2', snap2.patents[2].processedFields[0].id, { value: 'v2', source: 'ai' }), true);
  const snap3 = PatentShareStore.getSnapshot();
  assert.equal(snap3.patents[0].processedFields[0].value, 'v0');
  assert.equal(snap3.patents[0].processedFields[0].source, 'ai');
  assert.equal(snap3.patents[2].processedFields[0].value, 'v2');
  // 中间那篇未写入，仍是空值
  assert.equal(snap3.patents[1].processedFields[0].value, '');
  assert.equal(snap3.patents[1].processedFields[0].source, 'manual');
});
