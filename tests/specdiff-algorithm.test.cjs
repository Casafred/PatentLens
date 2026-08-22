/*!
 * PatentLens - 说明书变动点定位算法（comparison-specdiff.js）单元测试
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSpecDiff() {
  const file = path.resolve(__dirname, '../src/scripts/comparison/comparison-specdiff.js');
  const source = fs.readFileSync(file, 'utf8');
  const context = vm.createContext({
    console,
    setTimeout,
    ComparisonUtils: {
      escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      normalizePatentNumber: (s) => String(s || '').trim().toUpperCase().replace(/[\s/]/g, ''),
      truncateText: (t, n) => (String(t).length <= n ? t : String(t).slice(0, n) + '...'),
    },
  });
  context.window = context;
  vm.runInContext(source, context, { filename: file });
  return context.ComparisonSpecDiff;
}

test('完全相同的说明书：无变化点', () => {
  const SD = loadSpecDiff();
  const desc = [
    '[0001] 本发明涉及一种数据处理装置。',
    '[0002] 现有技术存在效率低下的问题。',
    '[0003] 本发明提供一种高效的数据处理方法，包括步骤S1和步骤S2。',
  ].join('\n');
  const r = SD.computeDiff(desc, desc);
  assert.equal(r.changes.length, 0);
  assert.equal(r.stats.same, 3);
  assert.equal(r.stats.anchorTotal, 3);
  assert.equal(r.stats.compareTotal, 3);
});

test('删除1段+修改1段+新增1段：正确识别三类变化', () => {
  const SD = loadSpecDiff();
  const descA = [
    '[0001] 本发明涉及一种数据处理装置。',
    '[0002] 现有技术存在效率低下的问题。',
    '[0003] 本发明提供一种高效的数据处理方法，包括步骤S1和步骤S2。',
  ].join('\n');
  const descB = [
    '[0001] 本发明涉及一种数据处理装置。',
    // [0002] 被删除
    '[0003] 本发明提供一种超高效的数据处理方法，包括步骤S1、步骤S2和步骤S3。', // 修改
    '[0004] 上述方法可广泛应用于通信领域。', // 新增
  ].join('\n');
  const r = SD.computeDiff(descA, descB);
  assert.equal(r.changes.length, 3);
  assert.equal(r.stats.same, 1);
  const kinds = r.changes.map((c) => c.kind).sort();
  assert.ok(kinds.includes('delete'));
  assert.ok(kinds.includes('insert'));
  const del = r.changes.find((c) => c.kind === 'delete');
  assert.equal(del.aParas[0].num, '[0002]');
  const ins = r.changes.find((c) => c.kind === 'insert');
  assert.equal(ins.bParas[0].num, '[0004]');
});

test('句子级 inline diff：精确定位变化字词', () => {
  const SD = loadSpecDiff();
  const aText = '本发明提供一种高效的数据处理方法，包括步骤S1和步骤S2。该方法由处理器执行。';
  const bText = '本发明提供一种高效的数据处理方法，包括步骤S1、步骤S2和步骤S3。该方法由处理器执行。';
  const segs = SD.inlineSegments([aText], [bText]);
  const delSeg = segs.filter((s) => s.type === 'del').map((s) => s.text).join('');
  const insSeg = segs.filter((s) => s.type === 'ins').map((s) => s.text).join('');
  assert.equal(delSeg, '和步骤S2');
  assert.equal(insSeg, '、步骤S2和步骤S3');
  const eqSegs = segs.filter((s) => s.type === 'eq').map((s) => s.text).join('');
  assert.ok(eqSegs.includes('本发明提供一种高效的数据处理方法，包括步骤S1'));
  assert.ok(eqSegs.includes('该方法由处理器执行。'));
});

test('全角段落号【００２０】规范化为 [0020]', () => {
  const SD = loadSpecDiff();
  const paras = SD.splitParagraphs('【００２０】全角段落号测试。【００２１】第二段。');
  assert.equal(paras.length, 2);
  assert.equal(paras[0].num, '[0020]');
  const r = SD.computeDiff('【００２０】全角段落号测试。【００２１】第二段。', '[0020]全角段落号测试。\n[0021]第二段。');
  assert.equal(r.changes.length, 0);
  assert.equal(r.stats.same, 2);
});

test('段落顺序调换：产生变化点', () => {
  const SD = loadSpecDiff();
  const x = '[0001] 第一段内容。甲乙丙丁。\n[0002] 第二段内容。戊己庚辛。';
  const y = '[0001] 第二段内容。戊己庚辛。\n[0002] 第一段内容。甲乙丙丁。';
  const r = SD.computeDiff(x, y);
  assert.ok(r.stats.same <= 1);
  assert.ok(r.changes.length >= 1);
});

test('变化分级：一词之差为细微调整，完全改写为明显变化', () => {
  const SD = loadSpecDiff();
  const base = '[0001] 本发明涉及一种智能图像识别系统，该系统通过卷积神经网络提取图像特征并输出分类结果，识别准确率高。';
  const minor = '[0001] 本发明涉及一种智能图像识别装置，该系统通过卷积神经网络提取图像特征并输出分类结果，识别准确率高。';
  const major = '[0001] 本发明涉及一种语音交互方法，通过声纹识别验证用户身份，并支持多轮对话意图理解与知识图谱查询。';
  const rMinor = SD.computeDiff(base, minor);
  assert.equal(rMinor.changes.length, 1);
  assert.equal(rMinor.changes[0].kind, 'minor');
  const rMajor = SD.computeDiff(base, major);
  assert.equal(rMajor.changes.length, 1);
  assert.equal(rMajor.changes[0].kind, 'major');
});

test('无段落号的说明书：按空行切分', () => {
  const SD = loadSpecDiff();
  const paras = SD.splitParagraphs('第一段没有段落号。\n\n第二段也没有段落号。\n\n第三段。');
  assert.equal(paras.length, 3);
  const r = SD.computeDiff('第一段。\n\n第二段。\n\n第三段。', '第一段。\n\n第二段修改了。\n\n第三段。');
  assert.equal(r.changes.length, 1);
});

test('500 段大文本性能与正确性', () => {
  const SD = loadSpecDiff();
  const bigA = [];
  const bigB = [];
  for (let i = 1; i <= 500; i++) {
    const num = '[' + String(i).padStart(4, '0') + ']';
    bigA.push(num + ' 这是第' + i + '段的技术内容，描述了装置的组成部分' + (i % 7 === 0 ? '变体甲' : '') + '与工作原理。');
    if (i !== 250) bigB.push(num + ' 这是第' + i + '段的技术内容，描述了装置的组成部分' + (i % 7 === 0 ? '变体甲' : '') + '与工作原理。');
    if (i === 300) bigB.push(num + ' 这是全新插入的段落，描述了附加的实施方式。');
  }
  const t0 = Date.now();
  const r = SD.computeDiff(bigA.join('\n'), bigB.join('\n'));
  const cost = Date.now() - t0;
  assert.equal(r.stats.deleted, 1);
  assert.ok(r.stats.inserted >= 1);
  assert.ok(cost < 3000, '耗时 ' + cost + 'ms');
});

test('replace 块细粒度拆分：相邻删除+修改+新增不并成一张大卡', () => {
  const SD = loadSpecDiff();
  const anchor = [
    '[0001] 本发明涉及一种数据处理装置。',
    '[0002] 现有技术存在效率低下的问题，需要改进。',
    '[0003] 本发明提供一种高效的数据处理方法，包括步骤S1和步骤S2。',
    '[0004] 装置包括存储器和处理器。',
    '[0005] 处理器被配置为执行上述方法。',
  ].join('\n');
  // [0002] 删除、[0003] 改写、新增两段 —— 中间没有相同段隔开，粗 LCS 会并成一个大 replace 块
  const compare = [
    '[0001] 本发明涉及一种数据处理装置。',
    '[0003] 本发明提供一种超高速的数据处理方法，包括步骤S1、步骤S2和步骤S3。',
    '[0031] 新增的第一段实施例说明。',
    '[0032] 新增的第二段实施例说明。',
    '[0004] 装置包括存储器和处理器。',
    '[0005] 处理器被配置为执行上述方法。',
  ].join('\n');
  const r = SD.computeDiff(anchor, compare);
  assert.equal(r.stats.same, 3);
  assert.ok(r.changes.length >= 3, '变化点数=' + r.changes.length);
  assert.ok(r.stats.deleted >= 1);
  assert.ok(r.stats.inserted >= 2);
  const del = r.changes.find((c) => c.kind === 'delete');
  assert.ok(del && del.aParas.length === 1 && del.aParas[0].num === '[0002]');
  const rep = r.changes.find((c) => c.kind === 'major' || c.kind === 'minor');
  assert.ok(
    rep && rep.aParas.length === 1 && rep.bParas.length === 1 &&
    rep.aParas[0].num === '[0003]' && rep.bParas[0].num === '[0003]'
  );
  const insCount = r.changes.filter((c) => c.kind === 'insert').length;
  assert.equal(insCount, 2);
});
