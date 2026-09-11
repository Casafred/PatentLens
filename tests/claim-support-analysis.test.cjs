const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSupportAnalysis() {
  const file = path.resolve(__dirname, '../src/scripts/app/features/claim-support-analysis.js');
  const context = vm.createContext({ console, setTimeout });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.ClaimSupportAnalysis;
}

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
