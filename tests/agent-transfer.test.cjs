const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const DIR = path.resolve(__dirname, '../src/scripts/app/features/agent-transfer');

function loadModules() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const context = vm.createContext({ localStorage, console, Math, JSON, Date, String, Number, Array, Object, Set, Map, URL });
  context.window = context; // 模块底部通过 window 导出
  const files = [
    'transfer-templates.js',
    'transfer-context.js',
    'transfer-packager.js',
    'transfer-file-dock.js',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    vm.runInContext(src, context, { filename: f });
  }
  return context;
}

function fixtureFulltext() {
  const longDescription = '说明书'.repeat(9500); // 19000 字，超过 18000 截断阈值
  return {
    patent_number: 'US14412875B2',
    title: 'Test Apparatus',
    office: 'US',
    applicationNumber: '14/412875',
    assignees: ['Acme Corp'],
    inventors: [{ name: 'Alice' }, 'Bob'],
    filing_date: '2013-02-01',
    publication_date: '2015-08-18',
    abstract: '本专利摘要内容。',
    description: longDescription,
    claims: [
      { num: 1, text: 'An apparatus comprising A, B and C.', type: 'independent' },
      { num: 2, text: 'The apparatus of claim 1 further comprising D.', type: 'dependent' },
      { num: 3, text: '根据权利要求1所述的装置，其特征在于 E。' },
    ],
    patent_citations: [
      { patent_number: 'US1111111A', title: 'Prior One', assignee: 'Old Inc', publication_date: '2010-01-01' },
    ],
    cited_by: [{ patent_number: 'US2222222B', title: 'Later One', assignee: 'New Inc' }],
    drawings: ['https://example.com/fig1.png', 'https://example.com/fig2.png'],
    family_applications: [{ publication_number: 'EP2999999B1', title: 'Family Member', status: 'GRANTED' }],
  };
}

test('模板库：三个场景预置提示词存在且包含通用底线条款', () => {
  const { TransferTemplates } = loadModules();
  const ids = TransferTemplates.list().map((t) => t.id);
  assert.deepEqual(ids.sort(), ['dossier', 'fulltext', 'timeline']);
  for (const id of ids) {
    const rendered = TransferTemplates.render(id);
    assert.ok(rendered.includes('通用要求'), `${id} 缺少通用要求`);
    assert.ok(rendered.includes('禁止编造'), `${id} 缺少禁止编造条款`);
    assert.equal(TransferTemplates.isCustom(id), false);
  }
});

test('模板库：自定义保存后生效，重置后恢复预置', () => {
  const ctx = loadModules();
  const t = ctx.TransferTemplates;
  const original = t.presetBody('timeline');
  assert.equal(t.saveCustom('timeline', '我的自定义时间轴提示词'), true);
  assert.equal(t.isCustom('timeline'), true);
  assert.equal(t.get('timeline').body, '我的自定义时间轴提示词');
  t.reset('timeline');
  assert.equal(t.isCustom('timeline'), false);
  assert.equal(t.get('timeline').body, original);
});

test('上下文采集：独权/从权正确分组，从权兜底识别中文从属句式', () => {
  const { TransferContext } = loadModules();
  const blocks = TransferContext.buildFulltextBlocks(fixtureFulltext());
  const ind = blocks.find((b) => b.key === 'claims-independent');
  const dep = blocks.find((b) => b.key === 'claims-dependent');
  assert.equal(ind.available, true);
  assert.ok(ind.text.includes('权利要求1'));
  assert.ok(!ind.text.includes('权利要求2'));
  assert.ok(dep.text.includes('权利要求2'));
  assert.ok(dep.text.includes('权利要求3')); // 无 type 字段，中文句式兜底判为从属
  assert.ok(dep.label.includes('2 项'));
});

test('上下文采集：说明书超阈值截断并留标记', () => {
  const { TransferContext } = loadModules();
  const block = TransferContext.buildDescriptionBlock(fixtureFulltext());
  assert.equal(block.truncated, true);
  assert.ok(block.text.includes('已截断'));
  assert.ok(block.chars <= TransferContext.DESCRIPTION_MAX + 80);
});

test('上下文采集：引证、被引、附图、同族、基础信息块内容正确', () => {
  const { TransferContext } = loadModules();
  const blocks = TransferContext.buildFulltextBlocks(fixtureFulltext());
  const meta = blocks.find((b) => b.key === 'meta');
  assert.ok(meta.text.includes('US14412875B2'));
  assert.ok(meta.text.includes('Acme Corp'));
  assert.ok(meta.text.includes('Alice')); // 对象数组发明人
  assert.ok(meta.text.includes('Bob'));   // 字符串数组发明人
  const citations = blocks.find((b) => b.key === 'citations');
  assert.ok(citations.text.includes('US1111111A'));
  const citedBy = blocks.find((b) => b.key === 'cited-by');
  assert.ok(citedBy.text.includes('US2222222B'));
  const drawings = blocks.find((b) => b.key === 'drawings');
  assert.ok(drawings.text.includes('fig1.png'));
  assert.ok(drawings.note.includes('图片无法随文本粘贴'));
  const family = blocks.find((b) => b.key === 'family');
  assert.ok(family.text.includes('EP2999999B1'));
});

test('上下文采集：dossier 场景按勾选生成文档清单与 OCR 块，未 OCR 块不可用', () => {
  const { TransferContext } = loadModules();
  const data = { office: 'US', applicationNumber: '14/412875', patent_number: 'US14412875B2' };
  const documents = [
    { idx: 0, docCode: 'CTNF', name: '第一次审查意见', date: '2018-03-15', type: 'office_action', numberOfPages: 18, docId: 'd0' },
    { idx: 1, docCode: 'REM', name: '申请人答复', date: '2018-06-20', type: 'response', numberOfPages: 12, docId: 'd1' },
  ];
  const extractions = { 0: { text: 'OCR文本内容'.repeat(100), markdown: '' } };
  const blocks = TransferContext.buildDossierBlocks(data, documents, extractions, [0, 1]);
  const listBlock = blocks.find((b) => b.key === 'doc-list');
  assert.ok(listBlock.text.includes('已选文档 2 篇'));
  const ocr0 = blocks.find((b) => b.key === 'ocr-0');
  assert.equal(ocr0.available, true);
  const ocr1 = blocks.find((b) => b.key === 'ocr-1');
  assert.equal(ocr1.available, false);
  assert.ok(ocr1.note.includes('尚未 OCR'));
  const timeline = blocks.find((b) => b.key === 'timeline');
  assert.ok(timeline && timeline.text.includes('第一次审查意见'));
});

test('上下文采集：原文缓存字段别名仍能生成摘要、权项、说明书和附图块', () => {
  const { TransferContext } = loadModules();
  const blocks = TransferContext.buildFulltextBlocks({
    patentNumber: 'US1', abstractText: '摘要别名',
    claimsData: [{ num: 1, text: 'An apparatus.' }],
    specification: '说明书别名', figures: ['https://example.com/figure.png'],
    family: [{ publicationNumber: 'EP2', title: 'Family' }],
  });
  assert.equal(blocks.find((b) => b.key === 'abstract').available, true);
  assert.equal(blocks.find((b) => b.key === 'claims-independent').available, true);
  assert.equal(blocks.find((b) => b.key === 'description').available, true);
  assert.equal(blocks.find((b) => b.key === 'drawings').available, true);
  assert.equal(blocks.find((b) => b.key === 'family').available, true);
});

test('上下文采集：单篇 OCR 超 12000 字截断', () => {
  const { TransferContext } = loadModules();
  const documents = [{ idx: 0, docCode: 'CTNF', name: '审查意见', date: '2018-03-15', docId: 'd0' }];
  const extractions = { 0: { text: 'X'.repeat(20000) } };
  const blocks = TransferContext.buildOcrBlocks(documents, extractions, [0]);
  assert.equal(blocks[0].truncated, true);
  assert.ok(blocks[0].chars <= TransferContext.OCR_PER_DOC_MAX + 80);
});

test('打包器：信封结构、块统计与空选拦截', () => {
  const ctx = loadModules();
  const { TransferPackager, TransferContext, TransferTemplates } = ctx;
  const blocks = TransferContext.buildFulltextBlocks(fixtureFulltext());
  const pkg = TransferPackager.buildPackage({
    prompt: TransferTemplates.render('fulltext'),
    blocks: blocks,
    note: '重点看创造性',
    sceneLabel: '专利原文',
    data: fixtureFulltext(),
  });
  assert.ok(pkg.text.startsWith('# PatentLens 上下文交接 · 专利原文'));
  assert.ok(pkg.text.includes('## 一、任务指令'));
  assert.ok(pkg.text.includes('## 二、背景上下文'));
  assert.ok(pkg.text.includes('【块1｜'));
  assert.ok(pkg.text.includes('补充要求'));
  assert.ok(pkg.text.includes('重点看创造性'));
  assert.equal(pkg.blockCount, pkg.blockStats.length);
  assert.ok(pkg.chars > 1000);

  const empty = TransferPackager.buildPackage({ prompt: 'x', blocks: [], sceneLabel: '空', data: null });
  assert.ok(empty.text.includes('未勾选任何可用上下文块'));
  assert.equal(TransferPackager.sumBlockChars([]), 0);
});

test('文件交接：文件名清洗与 PDF URL 构造（GD 链路）', () => {
  const { TransferFileDock } = loadModules();
  assert.equal(
    TransferFileDock.sanitizeFileName('a/b:c*d?.pdf'),
    'a_b_c_d_.pdf'
  );
  const data = { office: 'US', applicationNumber: '14412875', patent_number: 'US14412875B2' };
  const doc = { idx: 0, docCode: 'CTNF', date: '2018/03/15', docId: 'doc123', numberOfPages: 18, docFormat: 'PDF' };
  const url = TransferFileDock.buildDocPdfUrl(data, doc);
  assert.ok(url.startsWith('/api/gd/doc-content/svc/doccontent/US/14412875/doc123/18/PDF'));
  const fileName = TransferFileDock.buildFileName(data, doc);
  assert.ok(fileName.endsWith('.pdf'));
  assert.ok(fileName.includes('US14412875B2'));
  // JP/DE 在 Electron 版不支持，返回 null
  assert.equal(TransferFileDock.buildDocPdfUrl({ office: 'JP' }, doc), null);
  assert.equal(TransferFileDock.buildDocPdfUrl({ office: 'DE' }, doc), null);
  // ticketId 格式
  assert.match(TransferFileDock.newTicketId(), /^TK-\d{14}-[a-z0-9]{6}$/);
});

test('文件交接：附图载荷描述、扩展名识别与非法地址拦截', () => {
  const { TransferFileDock } = loadModules();
  // 扩展名从 URL 路径识别，默认 png
  assert.equal(TransferFileDock.imageExtFromUrl('https://patentimages.storage.googleapis.com/x/US1-A.jpeg'), '.jpg');
  assert.equal(TransferFileDock.imageExtFromUrl('https://example.com/no-ext'), '.png');
  assert.equal(TransferFileDock.imageExtFromUrl('https://example.com/a.TIFF'), '.tiff');

  const data = { patent_number: 'US14412875B2', drawings: [
    'https://patentimages.storage.googleapis.com/x/US14412875B2-00001.png',
    'https://patentimages.storage.googleapis.com/x/US14412875B2-00002.jpg',
    'ftp://bad-scheme.png',
  ] };
  const payloads = TransferFileDock.describeImagePayloads(data);
  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].status, 'pending');
  assert.equal(payloads[0].fileName, 'US14412875B2_图1.png');
  assert.equal(payloads[1].fileName, 'US14412875B2_图2.jpg');
  assert.equal(payloads[0].docName, '说明书附图 图1');
  // 非 http(s) 地址标记为不可用
  assert.equal(payloads[2].status, 'unsupported');
  assert.equal(payloads[2].url, '');

  // 无附图时返回空数组
  assert.equal(TransferFileDock.describeImagePayloads({ patent_number: 'X' }).length, 0);
});

test('上下文采集：附图块提示指向文件交接区', () => {
  const { TransferContext } = loadModules();
  const block = TransferContext.buildDrawingsBlock({
    drawings: ['https://example.com/fig1.png'],
  });
  assert.ok(block.note.includes('附图文件交接'));
});

test('原文交接按入口读取详情和弹窗，审查概要不会覆盖原文缓存', () => {
  const ctx = loadModules();
  ctx.currentData = { office: 'US', patent_number: 'US999A', title: '审查概要' };
  ctx._currentPatentData = fixtureFulltext();
  ctx._patentPopupData = { ...fixtureFulltext(), patent_number: 'EP222B1', title: '其他弹窗' };
  assert.equal(ctx.TransferContext.getCurrentData(), ctx.currentData);
  assert.equal(ctx.TransferContext.getFulltextData('detail').patent_number, 'US14412875B2');
  assert.equal(ctx.TransferContext.getFulltextData('popup').patent_number, 'EP222B1');
  const blocks = ctx.TransferContext.readFulltextBlocks('detail');
  for (const key of ['abstract', 'claims-independent', 'claims-dependent', 'description', 'drawings']) {
    assert.equal(blocks.find(b => b.key === key).available, true, key);
  }
  assert.ok(!blocks[0].text.includes('EP222B1'));
});

test('原文交接只补齐同文献的内存和磁盘缓存，不修改缓存与当前数据', () => {
  const ctx = loadModules();
  const cached = fixtureFulltext();
  ctx._currentPatentData = { patent_number: cached.patent_number, title: '当前标题', claims: [], description: '' };
  ctx._pdActivePatent = cached.patent_number;
  ctx._pdPatentCache = { [cached.patent_number]: cached };
  ctx.GPCache = { get: () => ({ ...cached, abstract: '磁盘摘要' }) };
  const data = ctx.TransferContext.getFulltextData('detail');
  assert.equal(data.title, '当前标题');
  assert.equal(data.claims.length, 3);
  assert.equal(data.drawings.length, 2);
  assert.equal(data.description, cached.description);
  assert.equal(ctx._currentPatentData.claims.length, 0);
  assert.equal(cached.title, 'Test Apparatus');

  ctx._pdActivePatent = 'US333A';
  assert.equal(ctx.TransferContext.getFulltextData('detail'), null);
  ctx._patentPopupData = null;
  assert.equal(ctx.TransferContext.getFulltextData('popup'), null);
});
