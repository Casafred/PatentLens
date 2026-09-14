/* PatentLens - 权利要求演变树单元测试 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModules() {
  const context = vm.createContext({
    console,
    setTimeout,
    ComparisonUtils: {
      escapeHtml: (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      normalizePatentNumber: (value) => String(value || '').trim().toUpperCase().replace(/[\s/]/g, ''),
    },
  });
  context.window = context;
  const claimDiffFile = path.resolve(__dirname, '../src/scripts/comparison/comparison-claimdiff.js');
  const treeFile = path.resolve(__dirname, '../src/scripts/app/features/claimdiff-tree.js');
  vm.runInContext(fs.readFileSync(claimDiffFile, 'utf8'), context, { filename: claimDiffFile });
  vm.runInContext(fs.readFileSync(treeFile, 'utf8'), context, { filename: treeFile });
  return { CD: context.ComparisonClaimDiff, Tree: context.ClaimDiffTree };
}

function findNode(tree, num) {
  return tree.nodes.find((node) => node.num === num);
}

test('依赖树按独从权关系嵌套并保持文档顺序', () => {
  const { Tree } = loadModules();
  const tree = Tree.buildClaimTree([
    { num: '1', type: 'independent', text: '一种装置，包括处理器。' },
    { num: '2', type: 'dependent', dependencies: ['1'], text: '根据权利要求1所述的装置，其中包括缓存。' },
    { num: '3', type: 'dependent', dependencies: ['2'], text: '根据权利要求2所述的装置，其中包括安全模块。' },
    { num: '4', type: 'independent', text: '一种方法，包括采集数据。' },
  ]);
  assert.equal(tree.roots.length, 2);
  assert.equal(tree.roots[0].num, '1');
  assert.equal(tree.roots[0].children.length, 1);
  assert.equal(tree.roots[0].children[0].num, '2');
  assert.equal(tree.roots[0].children[0].children[0].num, '3');
  assert.equal(tree.roots[1].num, '4');
});

test('多引从权挂在第一个存在的父项下并保留全部引用', () => {
  const { Tree } = loadModules();
  const tree = Tree.buildClaimTree([
    { num: '1', type: 'independent', text: '一种装置。' },
    { num: '2', type: 'independent', text: '一种方法。' },
    { num: '3', type: 'dependent', dependencies: ['1', '2'], text: '根据权利要求1或2所述。' },
  ]);
  const node3 = findNode(tree, '3');
  assert.equal(node3.parent.num, '1');
  assert.deepEqual(node3.dependencies, ['1', '2']);
});

test('引用缺失父项时兜底为根并标记 orphan', () => {
  const { Tree } = loadModules();
  const tree = Tree.buildClaimTree([
    { num: '1', type: 'independent', text: '一种装置。' },
    { num: '2', type: 'dependent', dependencies: ['9'], text: '根据权利要求9所述。' },
  ]);
  const node2 = findNode(tree, '2');
  assert.equal(node2.parent, null);
  assert.equal(node2.orphan, true);
  assert.ok(tree.roots.some((node) => node.num === '2'));
});

test('循环引用安全兜底不会死循环', () => {
  const { Tree } = loadModules();
  const tree = Tree.buildClaimTree([
    { num: '1', type: 'independent', text: '一种装置。' },
    { num: '2', type: 'dependent', dependencies: ['3'], text: '根据权利要求3所述。' },
    { num: '3', type: 'dependent', dependencies: ['2'], text: '根据权利要求2所述。' },
  ]);
  assert.equal(tree.nodes.length, 3);
  // 环在任意一处断开即可：节点2脱离为根，节点3改挂在节点2下，最终无环。
  assert.equal(findNode(tree, '2').parent, null);
  assert.equal(findNode(tree, '2').orphan, true);
  assert.ok(!findNode(tree, '3').parent || findNode(tree, '3').parent.num === '2');
  tree.nodes.forEach((node) => {
    const seen = new Set();
    let cur = node.parent;
    while (cur) {
      assert.ok(!seen.has(cur.num), '树中不应存在祖先环');
      seen.add(cur.num);
      cur = cur.parent;
    }
  });
});

test('演变连线覆盖配对、删除与授权新增', () => {
  const { CD, Tree } = loadModules();
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
  const links = Tree.buildTreeLinks(result);
  assert.equal(links.filter((link) => link.kind === 'pair').length, 3);
  assert.equal(links.filter((link) => link.kind === 'added').length, 1);
  assert.ok(links.some((link) => link.kind === 'pair' && link.fromNum === '3' && link.toNum === '4' && link.status === 'renumbered'));
  assert.ok(links.some((link) => link.kind === 'pair' && link.fromNum === '2' && link.status === 'promoted'));
  assert.ok(links.some((link) => link.kind === 'added' && link.toNum === '5'));
});

test('整项删除生成无去向的 deleted 连线', () => {
  const { CD, Tree } = loadModules();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '2', type: 'independent', text: '一种方法，包括采集数据。' }],
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }],
  );
  const links = Tree.buildTreeLinks(result);
  const deleted = links.find((link) => link.kind === 'deleted');
  assert.ok(deleted);
  assert.equal(deleted.fromNum, '2');
  assert.equal(deleted.toNum, null);
  assert.equal(links.find((link) => link.kind === 'pair').status, 'same');
});

test('权项编号前导零在树与连线中统一为规范编号', () => {
  const { CD, Tree } = loadModules();
  const before = [
    { num: '0001', type: 'independent', text: '一种装置，包括处理器。' },
    { num: '0002', type: 'dependent', text: '根据权利要求1所述的装置，其中所述存储器包括缓存模块。' },
  ];
  const after = [
    { num: '1', type: 'independent', text: '一种装置，包括处理器和安全模块。' },
    { num: '2', type: 'dependent', text: '根据权利要求1所述的装置，其中所述存储器包括缓存模块和安全模块。' },
  ];
  const result = CD.computeDiff(before, after);
  const links = Tree.buildTreeLinks(result);
  assert.ok(links.every((link) => !/^0/.test(link.fromNum || 'x') && !/^0/.test(link.toNum || 'x')));
  const tree = Tree.buildClaimTree(result.publicItems.map((item) => item.base));
  assert.equal(findNode(tree, '2').parent.num, '1');
});

test('筛选函数与状态标签可被树视图复用', () => {
  const { CD } = loadModules();
  const result = CD.computeDiff(
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '2', type: 'independent', text: '一种方法，包括采集数据。' }],
    [{ num: '1', type: 'independent', text: '一种装置，包括处理器。' }, { num: '3', type: 'independent', text: '一种系统，包括传感器和控制器。' }],
  );
  assert.equal(CD.filterPublicItems(result, 'all').length, 2);
  assert.equal(CD.filterPublicItems(result, 'changed').length, 1);
  assert.equal(CD.statusLabel('reference_only'), '仅引用序号变化');
  const item = result.items.find((entry) => entry.status === 'deleted');
  assert.ok(CD.renderItemBody(item).includes('claimdiff-item-body'));
  assert.ok(CD.renderGrantedOnly(result.grantedOnly[0]).includes('claimdiff-granted-only'));
});
