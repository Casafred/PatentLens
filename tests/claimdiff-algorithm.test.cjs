/* PatentLens - 权利要求变动定位算法单元测试 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadClaimDiff() {
  const file = path.resolve(__dirname, '../src/scripts/comparison/comparison-claimdiff.js');
  const source = fs.readFileSync(file, 'utf8');
  const context = vm.createContext({
    console,
    setTimeout,
    ComparisonUtils: {
      escapeHtml: (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      normalizePatentNumber: (value) => String(value || '').trim().toUpperCase().replace(/[\s/]/g, ''),
    },
  });
  context.window = context;
  vm.runInContext(source, context, { filename: file });
  return context.ComparisonClaimDiff;
}

test('先按最相似文本对齐，识别编号变化而非新增删除', () => {
  const CD = loadClaimDiff();
  const before = [
    { num: '1', type: 'independent', text: '一种数据处理装置，包括处理器和存储器；所述处理器执行数据处理。' },
    { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，其中所述存储器包括缓存模块。' },
    { num: '3', type: 'independent', text: '一种数据处理方法，包括接收数据和输出结果。' },
  ];
  const after = [
    { num: '1', type: 'independent', text: '一种数据处理装置，包括处理器、安全模块和存储器；所述处理器执行数据处理。' },
    { num: '2', type: 'independent', text: '一种数据处理装置，其中所述存储器包括缓存模块。' },
    { num: '4', type: 'independent', text: '一种数据处理方法，包括接收数据和输出结果。' },
    { num: '5', type: 'dependent', text: '根据权利要求1所述的装置，其中安全模块执行认证。' },
  ];
  const result = CD.computeDiff(before, after);
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.deleted, 0);
  const renamed = result.items.find((item) => item.base && item.base.num === '3');
  assert.equal(renamed.compare.num, '4');
  assert.ok(renamed.reasons.includes('权项编号变化'));
  const promoted = result.items.find((item) => item.base && item.base.num === '2');
  assert.equal(promoted.status, 'promoted');
  assert.ok(promoted.reasons.includes('从属权利要求提升为独立权利要求'));
});

test('整条权利要求删除和新增分别保留为独立变化', () => {
  const CD = loadClaimDiff();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '2', type: 'independent', text: '一种方法，包括采集数据。' }],
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '3', type: 'independent', text: '一种系统，包括传感器和控制器。' }],
  );
  assert.equal(result.stats.deleted, 1);
  assert.equal(result.stats.added, 1);
  assert.ok(result.items.some((item) => item.status === 'deleted' && item.base.num === '2'));
  assert.ok(result.items.some((item) => item.status === 'added' && item.compare.num === '3'));
});

test('技术特征按分号对齐并定位新增内容', () => {
  const CD = loadClaimDiff();
  const diff = CD.buildFeatureDiff('一种装置，包括处理器；存储器；通信模块。', '一种装置，包括处理器；存储器；安全模块；通信模块。');
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.deleted, 0);
  assert.ok(diff.rows.some((row) => row.type === 'insert' && row.compare.includes('安全模块')));
});

test('识别中文和英文从属关系', () => {
  const CD = loadClaimDiff();
  assert.deepEqual(Array.from(CD.extractDependencies('根据权利要求1或2所述的装置。')), ['1', '2']);
  assert.deepEqual(Array.from(CD.extractDependencies('The apparatus of claims 3 and 4, wherein the processor is configured.')), ['3', '4']);
});
