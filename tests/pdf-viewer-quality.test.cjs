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

function matchesSelector(node, selector) {
  if (selector.startsWith('.')) return !!node.classList && node.classList.contains(selector.slice(1));
  return node.tagName === String(selector).toUpperCase();
}

function makeFakeElement(tagName) {
  const classes = new Set();
  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    _connected: false,
    _text: '',
    _className: '',
    get className() { return el._className; },
    set className(value) {
      el._className = String(value);
      classes.clear();
      el._className.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener() {},
    appendChild(child) {
      child.parentElement = el;
      child._connected = el._connected;
      if (el._connected && typeof child._propagateConnected === 'function') child._propagateConnected();
      el.children.push(child);
      return child;
    },
    _propagateConnected() {
      el._connected = true;
      for (const child of el.children) {
        if (typeof child._propagateConnected === 'function') child._propagateConnected();
      }
    },
    get textContent() { return el._text; },
    set textContent(value) { el._text = String(value); },
    getBoundingClientRect() {
      // 只有真正挂到文档上的元素才有布局宽度。旧实现正是在未挂载时测量，
      // 导致宽度恒为 0、scaleX 永远不生效。
      return { width: el._connected ? Math.max(1, el._text.length * 10) : 0, height: 10 };
    },
    querySelector(selector) {
      const stack = [...el.children];
      while (stack.length) {
        const node = stack.shift();
        if (matchesSelector(node, selector)) return node;
        stack.push(...(node.children || []));
      }
      return null;
    },
    querySelectorAll(selector) {
      const result = [];
      const stack = [...el.children];
      while (stack.length) {
        const node = stack.shift();
        if (matchesSelector(node, selector)) result.push(node);
        stack.push(...(node.children || []));
      }
      return result;
    },
  };
  return el;
}

test('文字层会先挂到页面再测量宽度，保证 scaleX 对齐生效', async () => {
  const file = path.resolve(__dirname, '../src/scripts/app/features/pdf-viewer-quality.js');
  const wrapper = makeFakeElement('div');
  wrapper._connected = true;
  wrapper.dataset.page = '1';
  const container = makeFakeElement('div');
  container._connected = true;
  container.appendChild(wrapper);
  container.querySelectorAll = (selector) => (selector === '.pdf-page-wrapper' ? [wrapper] : []);

  const documentMock = {
    getElementById(id) {
      if (id === 'reader-pdf-container') return container;
      return null;
    },
    createElement: (tag) => makeFakeElement(tag),
  };
  const sandbox = {
    window: { localStorage: { getItem: () => null } },
    document: documentMock,
    Math,
  };
  sandbox.window.document = documentMock;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

  const page = {
    getViewport: () => ({ width: 200, height: 300, scale: 1, transform: [1, 0, 0, 1, 0, 0] }),
    getTextContent: async () => ({
      items: [{ str: 'Hello', transform: [1, 0, 0, 1, 10, 20], width: 60, fontName: 'f1' }],
      styles: { f1: { fontFamily: 'serif' } },
    }),
  };
  const pdfDoc = { getPage: async () => page };

  await context.window.__pdfViewerQuality.addTextLayers(pdfDoc, 1);

  const layer = wrapper.querySelector('.pdf-text-layer');
  assert.ok(layer, '应生成文字层');
  assert.ok(wrapper.classList.contains('has-text-layer'));
  const span = layer.querySelectorAll('span').find((node) => node._text === 'Hello');
  assert.ok(span, '应生成文字片段');
  assert.match(span.style.transform, /scaleX\(/, '文字片段宽度应被缩放到 PDF 实际宽度');
});
