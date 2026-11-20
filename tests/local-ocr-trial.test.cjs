const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { after } = require('node:test');
const vm = require('node:vm');

const {
  recognizeImage,
  recognizeWithTesseract,
  closeEngine,
  friendlyOcrError,
  unpackAsarPath,
  pngSize,
  tidyOcrText,
  tesseractLines,
} = require('../local-ocr-ipc.cjs');

function fakeElement(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    innerHTML: '',
    parentNode: null,
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

function loadRendererModule() {
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    Promise,
    navigator: {},
    document: {
      readyState: 'loading',
      head: fakeElement('head'),
      body: fakeElement('body'),
      createElement: (tag) => fakeElement(tag),
      getElementById() { return null; },
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const file = path.resolve(__dirname, '../src/scripts/app/features/local-ocr-trial.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

test('本地 OCR 主进程结果转换为前端可用结构', async () => {
  const engine = {
    async recognizeEncoded(buffer) {
      assert.equal(buffer.length, 8);
      return {
        imageWidth: 1000,
        imageHeight: 1400,
        modelBundleId: 'test-bundle',
        lines: [
          { text: '第一行', confidence: 0.98, box: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 40 }, { x: 10, y: 40 }] },
        ],
      };
    },
  };
  const result = await recognizeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), engine);
  assert.equal(result.ok, true);
  assert.equal(result.imageWidth, 1000);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].text, '第一行');
  assert.equal(result.modelBundleId, 'test-bundle');
  assert.equal(typeof result.durationMs, 'number');
});

test('本地 OCR 拒绝空数据', async () => {
  const engine = { async recognizeEncoded() { throw new Error('should not run'); } };
  await assert.rejects(recognizeImage(new Uint8Array(1), engine), /图片数据为空/);
});

test('双栏页面按左栏再右栏还原阅读顺序', () => {
  const context = loadRendererModule();
  const api = context.__plLocalOcr;
  assert.ok(api && typeof api.orderLines === 'function');

  const line = (text, x1, y1, x2, y2) => ({
    text,
    confidence: 0.99,
    box: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
  });
  const ordered = api.orderLines([
    line('右栏第一行', 700, 100, 1100, 130),
    line('左栏第一行', 60, 100, 500, 130),
    line('右栏第二行', 700, 150, 1100, 180),
    line('左栏第二行', 60, 150, 500, 180),
  ], 1200);
  assert.deepEqual(Array.from(ordered, (item) => item.text), [
    '左栏第一行', '左栏第二行', '右栏第一行', '右栏第二行',
  ]);
});

test('单栏跨行文本保持自上而下顺序', () => {
  const context = loadRendererModule();
  const line = (text, y) => ({
    text,
    confidence: 0.99,
    box: [{ x: 60, y }, { x: 1100, y }, { x: 1100, y: y + 30 }, { x: 60, y: y + 30 }],
  });
  const ordered = context.__plLocalOcr.orderLines([
    line('第二行', 150), line('第一行', 100),
  ], 1200);
  assert.deepEqual(Array.from(ordered, (item) => item.text), ['第一行', '第二行']);
});

test('OCR 坐标按画布显示尺寸缩放后生成文字层', () => {
  const context = loadRendererModule();
  const wrapper = fakeElement('div');
  wrapper.dataset.page = '2';
  const canvas = {
    getBoundingClientRect: () => ({ width: 500, height: 700 }),
    clientWidth: 500,
    clientHeight: 700,
  };
  wrapper.querySelector = (selector) => (selector === 'canvas' ? canvas : null);
  const count = context.__plLocalOcr.buildTextLayer(wrapper, [{
    text: '测试行',
    confidence: 0.95,
    box: [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 100, y: 300 }],
  }], 1000, 1400);
  assert.equal(count, 1);
  const layer = wrapper.children[0];
  assert.equal(layer.style.width, '500px');
  assert.equal(layer.style.height, '700px');
  const span = layer.children[0];
  assert.equal(span.style.left, '50px');
  assert.equal(span.style.top, '100px');
  assert.equal(span.style.width, '100px');
  assert.equal(span.style.height, '50px');
});

test('打包后的原生插件改为从 app.asar.unpacked 加载', () => {
  const packed = '/app/resources/app.asar/node_modules/@arcships/light-ocr-win32-x64/native/light_ocr_node.node';
  assert.equal(
    unpackAsarPath(packed),
    '/app/resources/app.asar.unpacked/node_modules/@arcships/light-ocr-win32-x64/native/light_ocr_node.node',
  );
  const plain = '/app/node_modules/@arcships/light-ocr-win32-x64/native/light_ocr_node.node';
  assert.equal(unpackAsarPath(plain), plain);
  assert.equal(
    unpackAsarPath('C:\\App\\resources\\app.asar\\node_modules\\@arcships\\light-ocr-win32-x64\\native\\light_ocr_node.node'),
    'C:\\App\\resources\\app.asar.unpacked\\node_modules\\@arcships\\light-ocr-win32-x64\\native\\light_ocr_node.node',
  );
});

test('原生插件加载失败时保留底层原因，便于定位缺失依赖', () => {
  const cause = Object.assign(new Error('The specified module could not be found.'), { code: 'ERR_DLOPEN_FAILED' });
  const error = Object.assign(new Error('Unable to load the verified native addon'), { cause });
  const friendly = friendlyOcrError(error);
  assert.match(friendly.message, /原生组件加载失败/);
  assert.match(friendly.message, /ERR_DLOPEN_FAILED/);
  assert.match(friendly.message, /The specified module could not be found/);
});

test('原生组件文件损坏时提示重新安装', () => {
  const error = new Error('Unable to load the verified native addon');
  error.message = 'Descriptor artifact hash mismatch';
  const friendly = friendlyOcrError(error);
  assert.match(friendly.message, /重新安装/);
});

test('缺少原生平台包时给出可操作的错误提示', async () => {
  const engine = {
    async recognizeEncoded() {
      throw new Error('Unable to locate @arcships/light-ocr-win32-x64');
    },
  };
  await assert.rejects(
    recognizeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), engine),
    /原生组件缺失.*npm install/,
  );
});

test('从 PNG 头部读取页面尺寸', () => {
  const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'ocr-sample.png'));
  assert.deepEqual(pngSize(png), { width: 1100, height: 200 });
  assert.equal(pngSize(Buffer.from('not a png')), null);
});

test('中文 OCR 结果去掉字符之间的空格', () => {
  assert.equal(tidyOcrText('本 发 明 涉 及 一 种 半导体 器件'), '本发明涉及一种半导体器件');
  assert.equal(tidyOcrText('权利 要求 1 所述 的 方法'), '权利要求 1 所述的方法');
  assert.equal(tidyOcrText('The present invention'), 'The present invention');
});

test('tesseract 行结果转换为页面文字层坐标', () => {
  const lines = tesseractLines({
    blocks: [{
      paragraphs: [{
        lines: [{
          text: '本发明涉及一种半导体器件\n',
          confidence: 92,
          bbox: { x0: 10, y0: 20, x1: 210, y1: 50 },
        }],
      }],
    }],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '本发明涉及一种半导体器件');
  assert.equal(lines[0].confidence, 0.92);
  assert.deepEqual(lines[0].box[0], { x: 10, y: 20 });
  assert.deepEqual(lines[0].box[2], { x: 210, y: 50 });
});

test('WASM 引擎可在离线环境识别印刷文字', async () => {
  const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'ocr-sample.png'));
  const result = await recognizeWithTesseract(png);
  assert.equal(result.imageWidth, 1100);
  assert.equal(result.imageHeight, 200);
  const text = result.lines.map((line) => line.text).join(' ');
  assert.match(text, /semiconductor device/);
  assert.match(text, /gate electrode structure/);
});

test('原生引擎不可用时识别请求自动回退并返回文本', async () => {
  const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'ocr-sample.png'));
  const result = await recognizeImage(png);
  assert.equal(result.ok, true);
  assert.ok(['native', 'tesseract'].includes(result.engine));
  const text = result.lines.map((line) => line.text).join(' ');
  assert.match(text, /semiconductor device/);
});

after(() => closeEngine());
