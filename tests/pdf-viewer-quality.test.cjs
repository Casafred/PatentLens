const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadQualityHelpers(overrides) {
  const file = path.resolve(__dirname, '../src/scripts/app/features/pdf-viewer-quality.js');
  const sandbox = Object.assign({ window: {}, Math }, overrides || {});
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window.__pdfViewerQuality;
}

test('canvas 渲染倍率跟随设备像素比，并在高倍率缩放时停止叠加', () => {
  const { computeCanvasDpr } = loadQualityHelpers();
  assert.equal(computeCanvasDpr(1, 1), 1);
  assert.equal(computeCanvasDpr(1, 2), 2);
  assert.equal(computeCanvasDpr(1, 3), 2);
  assert.equal(computeCanvasDpr(2, 2), 1);
  assert.equal(computeCanvasDpr(0, 0), 1);
});

test('仿射矩阵乘法与 pdf.js 坐标变换一致', () => {
  const { multiplyTransform } = loadQualityHelpers();
  assert.deepEqual(Array.from(multiplyTransform([1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 5, 7])), [1, 0, 0, 1, 5, 7]);
  assert.deepEqual(Array.from(multiplyTransform([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 10, 20])), [2, 0, 0, 2, 20, 40]);
});

test('文本片段按 viewport 变换得到选择层坐标和宽度', () => {
  const { buildTextItems } = loadQualityHelpers();
  const viewport = { transform: [2, 0, 0, 2, 0, 0], scale: 2 };
  const textContent = {
    items: [{ str: 'Hello', transform: [1, 0, 0, 1, 10, 20], width: 30, fontName: 'f1', hasEOL: true }],
    styles: { f1: { fontFamily: 'serif' } },
  };
  const items = buildTextItems(textContent, viewport);
  assert.equal(items.length, 1);
  assert.equal(items[0].str, 'Hello');
  assert.equal(items[0].left, 20);
  assert.equal(items[0].top, 38);
  assert.equal(items[0].fontSize, 2);
  assert.equal(items[0].targetWidth, 60);
  assert.equal(items[0].fontFamily, 'serif');
  assert.equal(items[0].angle, 0);
  assert.equal(items[0].eol, true);
});

test('缺少 hasEOL 时按基线位置识别换行', () => {
  const { buildTextItems } = loadQualityHelpers();
  const viewport = { transform: [1, 0, 0, 1, 0, 0], scale: 1 };
  const textContent = {
    items: [
      { str: 'Line1', transform: [1, 0, 0, 1, 10, 20], width: 20 },
      { str: 'Line2', transform: [1, 0, 0, 1, 10, 40], width: 20 },
    ],
    styles: {},
  };
  const items = buildTextItems(textContent, viewport);
  assert.equal(items.length, 2);
  assert.equal(items[0].eol, true);
});

test('文字选择模式默认开启，可被 localStorage 关闭', () => {
  assert.equal(loadQualityHelpers().isTextSelectModeEnabled(), true);
  const disabled = loadQualityHelpers({
    window: { localStorage: { getItem: () => 'false' } },
  });
  assert.equal(disabled.isTextSelectModeEnabled(), false);
});

test('空文本或空内容不生成文本片段', () => {
  const { buildTextItems } = loadQualityHelpers();
  assert.deepEqual(Array.from(buildTextItems(null, { transform: [1, 0, 0, 1, 0, 0], scale: 1 })), []);
  assert.deepEqual(Array.from(buildTextItems({ items: [{ str: '' }] }, { transform: [1, 0, 0, 1, 0, 0], scale: 1 })), []);
});
