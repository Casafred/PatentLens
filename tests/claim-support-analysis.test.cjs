const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSupportAnalysis(options = {}) {
  const file = path.resolve(__dirname, '../src/scripts/app/features/claim-support-analysis.js');
  const context = vm.createContext({ console, setTimeout, ...options });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.ClaimSupportAnalysis;
}

test('AI 支撑结果随专利原文缓存保存并在原文一致时恢复', () => {
  const data = { patent_number: 'US100A', claims: [{ num: '1', text: 'A processor executes data processing.' }] };
  const entries = { US100A: { data, timestamp: 1 } };
  const window = { _currentPatentData: data };
  const CSA = loadSupportAnalysis({ window, GPCache: {
    getAll: () => entries,
    set: (key, value) => { entries[key] = { data: value, timestamp: 2 }; },
  } });
  const result = { features: [{ claimText: 'A processor', claimTextZh: '处理器', evidence: [] }], summary: 'source', summaryZh: '译文' };
  CSA.persistResult('detail', data.claims[0], result);
  assert.deepEqual(data._claimSupportAnalysis.claims['1'].result, result);
  CSA.restoreCachedResults('detail');
  assert.deepEqual(CSA.cachedResult('detail', data.claims[0]), result);
  data.claims[0].text = 'A changed claim.';
  CSA.restoreCachedResults('detail');
  assert.equal(CSA.cachedResult('detail', data.claims[0]), undefined);
});

test('AI 支撑结果只接受真实说明书段落号', () => {
  const CSA = loadSupportAnalysis();
  const result = CSA.validateResult({
    features: [{ id: 'F1', claimText: '处理器执行数据处理', label: '功能', status: 'strong', evidence: [
      { paragraph: '0021', quote: '处理器用于执行数据处理', explanation: '功能一致' },
      { paragraph: '9999', quote: '不存在的段落', explanation: '应忽略' },
    ] }],
    summary: '已定位证据',
  },
    '[0020] 一种数据处理装置包括处理器和存储器。\n[0021] 所述处理器用于执行数据处理并输出结果。',
    '一种数据处理装置，其中处理器执行数据处理。'
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].evidence.length, 1);
  assert.equal(result.features[0].evidence[0].paragraph.id, '0021');
});

test('AI 特征必须能在当前权利要求原文中验证', () => {
  const CSA = loadSupportAnalysis();
  assert.throws(() => CSA.validateResult({
    features: [{ claimText: '不存在的虚构模块', evidence: [] }],
  }, '[0020] 处理器执行数据处理。', '一种装置，包括处理器。'));
});

test('AI 结果可从 Markdown JSON 围栏中提取', () => {
  const CSA = loadSupportAnalysis();
  assert.equal(JSON.stringify(CSA.extractJson('```json\n{"features":[]}\n```')), '{"features":[]}');
});

test('AI 支撑结果保留原文并规范化译文字段', () => {
  const CSA = loadSupportAnalysis();
  const result = CSA.validateResult({
    features: [{ claimText: '处理器执行数据处理', claimTextZh: '处理器进行数据处理', status: 'strong', evidence: [
      { paragraph: '0021', quote: '处理器用于执行数据处理', quoteZh: '处理器用于进行数据处理', explanation: '功能一致', explanationZh: '功能相符' },
    ] }], summary: '原文摘要', summaryZh: '译文摘要',
  }, '[0021] 处理器用于执行数据处理。', '一种装置，包括处理器执行数据处理。');
  assert.equal(result.features[0].claimText, '处理器执行数据处理');
  assert.equal(result.features[0].claimTextZh, '处理器进行数据处理');
  assert.equal(result.features[0].evidence[0].quoteZh, '处理器用于进行数据处理');
  assert.equal(result.summaryZh, '译文摘要');
});

test('全部独权范围按权利要求关系选择，不受页面折叠状态影响', () => {
  const CSA = loadSupportAnalysis();
  const claims = [
    { num: '1', text: '一种装置。' },
    { num: '2', type: 'dependent', text: '根据权利要求1所述的装置。' },
    { num: '3', type: 'independent', text: '一种方法。' },
    { num: '4', dependent_on: '3', text: '根据权利要求3所述的方法。' },
  ];
  assert.deepEqual(Array.from(CSA.allIndependentIndexes(claims)), [0, 2]);
});
