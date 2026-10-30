const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadOcrAutoMode(overrides) {
  const file = path.resolve(__dirname, '../src/scripts/app/features/ocr-auto-scan.js');
  const sandbox = Object.assign({ window: {}, Math }, overrides || {});
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window.__ocrAutoMode;
}

function createAiSandbox() {
  const sandbox = {
    window: {
      AI: {
        getOCRConfig(config) {
          if (!config.ocr) config.ocr = { engine: 'paddle_ocr_vl' };
          return config.ocr;
        },
      },
    },
    Math,
  };
  return sandbox;
}

test('统计文本层有效字符数（忽略空白）', () => {
  const { countTextChars } = loadOcrAutoMode();
  assert.equal(countTextChars(null), 0);
  assert.equal(countTextChars({ items: [{ str: 'Hello World' }] }), 10);
  assert.equal(countTextChars({ items: [{ str: '  A B  ' }, { str: 'C' }] }), 3);
  assert.equal(countTextChars({ items: [{ str: '' }, { notStr: true }] }), 0);
});

test('扫描件判定：平均每页字符过少视为无文字层', () => {
  const { isScannedChars, SCANNED_CHARS_PER_PAGE } = loadOcrAutoMode();
  assert.equal(isScannedChars(0, 3), true);
  assert.equal(isScannedChars(SCANNED_CHARS_PER_PAGE - 1, 1), true);
  assert.equal(isScannedChars(SCANNED_CHARS_PER_PAGE, 1), false);
  assert.equal(isScannedChars(SCANNED_CHARS_PER_PAGE * 2, 2), false);
  assert.equal(isScannedChars(0, 0), false);
});

test('未设置 autoOcr 时默认关闭，已显式保存的值保持不变', () => {
  const sandbox = createAiSandbox();
  loadOcrAutoMode(sandbox);

  const unsetConfig = {};
  const unsetOcr = sandbox.window.AI.getOCRConfig(unsetConfig);
  assert.equal(unsetOcr.autoOcr, false);

  const enabledConfig = { ocr: { autoOcr: true } };
  assert.equal(sandbox.window.AI.getOCRConfig(enabledConfig).autoOcr, true);

  const disabledConfig = { ocr: { autoOcr: false } };
  assert.equal(sandbox.window.AI.getOCRConfig(disabledConfig).autoOcr, false);
});

test('重复加载不会重复包裹 getOCRConfig', () => {
  const sandbox = createAiSandbox();
  loadOcrAutoMode(sandbox);
  loadOcrAutoMode(sandbox);
  const config = {};
  assert.equal(sandbox.window.AI.getOCRConfig(config).autoOcr, false);
});

function createViewerSandbox(options) {
  const opts = options || {};
  const idx = opts.idx == null ? 7 : opts.idx;
  const calls = { ocrPdf: 0, scope: [] };
  const pdfDoc = {
    numPages: opts.numPages || 2,
    async getPage() {
      return {
        async getTextContent() {
          return { items: [{ str: opts.pageText == null ? '' : opts.pageText }] };
        },
      };
    },
  };
  const pdfViewState = {
    active: true,
    currentDocIdx: idx,
    pdfDoc,
    totalPages: pdfDoc.numPages,
    traceJumpPending: !!opts.traceJump,
  };
  const kanbanState = { extractions: {} };
  if (opts.blocks) kanbanState.extractions[idx] = { blocks: opts.blocks };
  const sandbox = {
    window: {},
    Math,
    document: { getElementById: () => (opts.scopeOpen ? {} : null) },
    pdfViewState,
    kanbanState,
    ocrJobs: opts.job ? { [idx]: opts.job } : {},
    renderPdfView: async function () {},
    ocrPdf: function () { calls.ocrPdf++; },
    _showOcrScopeDialog: function (dialogIdx, total) { calls.scope.push([dialogIdx, total]); },
  };
  const context = vm.createContext(sandbox);
  const file = path.resolve(__dirname, '../src/scripts/app/features/ocr-auto-scan.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { context, calls, idx };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('文字版 PDF 不自动 OCR', async () => {
  const { context, calls } = createViewerSandbox({ pageText: 'This page has a real text layer.' });
  await context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(calls.ocrPdf, 0);
});

test('扫描件（无文字层）自动触发 OCR', async () => {
  const { context, calls } = createViewerSandbox({ pageText: '' });
  await context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(calls.ocrPdf, 1);
});

test('已有提取块或已有 OCR 任务时不重复触发', async () => {
  const withBlocks = createViewerSandbox({ pageText: '', blocks: [{}] });
  await withBlocks.context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(withBlocks.calls.ocrPdf, 0);

  const withJob = createViewerSandbox({ pageText: '', job: { status: 'done' } });
  await withJob.context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(withJob.calls.ocrPdf, 0);
});

test('扫描件页数较多时弹出 OCR 范围选择而不是直接全量 OCR', async () => {
  const { context, calls } = createViewerSandbox({ pageText: '', numPages: 12 });
  await context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(calls.ocrPdf, 0);
  assert.deepEqual(calls.scope, [[7, 12]]);
});

test('正在选择 OCR 页码或追踪跳转时不自动触发', async () => {
  const scopeOpen = createViewerSandbox({ pageText: '', scopeOpen: true });
  await scopeOpen.context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(scopeOpen.calls.ocrPdf, 0);

  const traceJump = createViewerSandbox({ pageText: '', traceJump: true });
  await traceJump.context.renderPdfView(7);
  await flushAsyncWork();
  assert.equal(traceJump.calls.ocrPdf, 0);
});
