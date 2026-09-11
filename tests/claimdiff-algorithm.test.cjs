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

test('识别中日法德从属引用并展开编号范围', () => {
  const CD = loadClaimDiff();
  assert.deepEqual(Array.from(CD.extractDependencies('如权利要求1至3任一项所述的装置。')), ['1', '2', '3']);
  assert.deepEqual(Array.from(CD.extractDependencies('請求項1から3のいずれかに記載の装置。')), ['1', '2', '3']);
  assert.deepEqual(Array.from(CD.extractDependencies("Dispositif selon l'une quelconque des revendications 1 à 3.")), ['1', '2', '3']);
  assert.deepEqual(Array.from(CD.extractDependencies('Vorrichtung nach einem der Ansprüche 1 bis 3.')), ['1', '2', '3']);
});

test('日法德的父项映射可识别为仅引用序号变化', () => {
  const CD = loadClaimDiff();
  const samples = [
    ['請求項1に記載の装置であって、プロセッサが安全モジュールを含む。', '請求項2に記載の装置であって、プロセッサが安全モジュールを含む。'],
    ['Dispositif selon la revendication 1, dans lequel le processeur comprend un module de sécurité.', 'Dispositif selon la revendication 2, dans lequel le processeur comprend un module de sécurité.'],
    ['Vorrichtung nach Anspruch 1, wobei der Prozessor ein Sicherheitsmodul umfasst.', 'Vorrichtung nach Anspruch 2, wobei der Prozessor ein Sicherheitsmodul umfasst.'],
  ];
  samples.forEach(([before, after]) => {
    const result = CD.computeDiff([{ num: '1', text: 'base core' }, { num: '2', text: before }], [{ num: '2', text: 'base core' }, { num: '3', text: after }]);
    assert.equal(result.publicItems[1].status, 'reference_only');
  });
});

test('公开版是固定主轴，所有公开权项按原顺序保留', () => {
  const CD = loadClaimDiff();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器和存储器。' },
      { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，其中所述存储器为非易失性存储器。' },
      { num: '3', type: 'dependent', text: '根据权利要求1所述的装置，其中所述装置还包括安全模块。' }],
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器和存储器。' },
      { num: '2', type: 'independent', text: '一种装置，包括处理器和存储器，其中所述存储器为非易失性存储器。' },
      { num: '4', type: 'dependent', text: '根据权利要求2所述的装置，其中所述装置还包括安全模块。' }],
  );
  assert.deepEqual(result.publicItems.map((item) => item.base.num), ['1', '2', '3']);
  assert.equal(result.publicItems.length, 3);
  assert.equal(result.grantedOnly.length, 0);
  assert.equal(result.publicItems[1].status, 'promoted');
  assert.equal(result.publicItems[2].status, 'dependency_migrated');
});

test('局部文字修改使用 token 差异而不是整句替换', () => {
  const CD = loadClaimDiff();
  const diff = CD.buildFeatureDiff('一种装置，包括处理器和存储器。', '一种装置，包括控制器和存储器。');
  const modified = diff.rows.find((row) => row.type === 'replace');
  assert.ok(modified);
  assert.ok(modified.diff.ops.some((op) => op.type === 'equal'));
  const changed = modified.diff.ops.find((op) => op.type === 'replace');
  assert.ok(changed);
  assert.ok(changed.deleted.length < modified.diff.left.length);
  assert.ok(changed.inserted.length < modified.diff.right.length);
});

test('全角半角数字和常用标点不应被误判为文本变化', () => {
  const CD = loadClaimDiff();
  const diff = CD.tokenDiff('权利要求１：装置（处理器）；', '权利要求1:装置(处理器);');
  assert.ok(diff.ops.every((op) => op.type === 'equal'));
});

test('全角编号也可参与多语言从属关系识别', () => {
  const CD = loadClaimDiff();
  assert.deepEqual(Array.from(CD.extractDependencies('請求項１から３のいずれかに記載の装置。')), ['1', '2', '3']);
  assert.deepEqual(Array.from(CD.extractDependencies('Vorrichtung nach Anspruch １ bis ３.')), ['1', '2', '3']);
});

test('从权未形成独立授权项时识别附加限定并入', () => {
  const CD = loadClaimDiff();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种数据处理装置，包括处理器和存储器。' },
      { num: '2', type: 'dependent', text: '根据权利要求1所述的数据处理装置，其中所述处理器还包括安全认证模块。' }],
    [{ num: '1', type: 'independent', text: '一种数据处理装置，包括处理器、存储器和安全认证模块。' }],
  );
  const lineage = result.publicItems.find((item) => item.base.num === '2');
  assert.equal(lineage.status, 'merged_into');
  assert.equal(lineage.mergedInto.num, '1');
  assert.equal(result.stats.deleted, 0);
  assert.equal(result.stats.merged, 1);
});

test('父项编号变化但自身限定不变时标记为仅引用序号变化', () => {
  const CD = loadClaimDiff();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' },
      { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，其中所述处理器包括安全模块。' }],
    [{ num: '2', type: 'independent', text: '一种装置，包括处理器。' },
      { num: '3', type: 'dependent', text: '根据权利要求2所述的装置，其中所述处理器包括安全模块。' }],
  );
  const item = result.publicItems.find((entry) => entry.base.num === '2');
  assert.equal(item.status, 'reference_only');
  assert.equal(result.stats.referenceOnly, 1);
  assert.ok(item.reasons.includes('仅因父项映射更新引用序号'));
  assert.equal(item.featureDiff.counts.added, 0);
  assert.equal(item.featureDiff.counts.deleted, 0);
  assert.equal(item.featureDiff.counts.modified, 0);
});
