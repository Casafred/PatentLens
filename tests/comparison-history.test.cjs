const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCore() {
  const data = {};
  const context = vm.createContext({
    console,
    localStorage: {
      getItem(key) { return data[key] || null; },
      setItem(key, value) { data[key] = String(value); },
    },
    ComparisonUtils: {
      cleanText: (value) => String(value || ''),
      detectLanguage: () => 'zh',
      generateId: () => 'test-id',
    },
  });
  context.window = context;
  const file = path.resolve(__dirname, '../src/scripts/comparison/comparison-core.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.ComparisonCore;
}

test('本地变动定位保存两篇专利、模式和摘要到智能比对历史', () => {
  const core = loadCore();
  const entry = core.history.saveLocalDiff({
    inputMode: 'specdiff',
    analysisType: '说明书变动定位',
    firstPatent: 'CN100000001A',
    secondPatent: 'CN100000001B',
    anchorLabel: '公开版',
    compareLabel: '授权版',
    summary: '明显变化 2 处。',
  });

  assert.equal(entry.inputMode, 'specdiff');
  assert.deepEqual(Array.from(entry.patentNumbers), ['CN100000001A', 'CN100000001B']);
  assert.equal(entry.localSummary, '明显变化 2 处。');
  assert.equal(entry.itemsSummary.length, 2);
  assert.equal(core.history.getAll().length, 1);
});

test('本地变动定位历史最多保留 20 条最新记录', () => {
  const core = loadCore();
  for (let i = 0; i < 21; i++) {
    core.history.saveLocalDiff({
      inputMode: 'claimdiff',
      firstPatent: `CN${i}A`,
      secondPatent: `CN${i}B`,
    });
  }
  assert.equal(core.history.getAll().length, 20);
});
