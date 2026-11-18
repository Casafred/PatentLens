const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('GD/EPO network diagnostics records source, cache and elapsed headers', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/features/network-diagnostics.js'), 'utf8');
  const calls = [];
  const context = vm.createContext({
    console, Promise, Date, String, Number, Object, Array, Math, setTimeout, clearTimeout,
    document: { getElementById: () => null },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
  });
  context.window = context;
  context.window.dispatchEvent = () => {};
  context.window.fetch = async (url) => {
    calls.push(url);
    return {
      status: 200,
      headers: { get(name) { return { 'X-PatentLens-Source': 'epo', 'X-PatentLens-Cache': 'HIT', 'X-Epo-Fallback': '1' }[name] || null; } },
    };
  };
  vm.runInContext(source, context, { filename: 'network-diagnostics.js' });
  await context.window.fetch('/api/gd/doc-list/svc/doclist/EP/123/A');
  assert.deepEqual(calls, ['/api/gd/doc-list/svc/doclist/EP/123/A']);
  const item = context.window.__patentLensNetworkDiagnostics.getHistory()[0];
  assert.equal(item.source, 'epo');
  assert.equal(item.cache, 'HIT');
  assert.equal(item.stage, '审查文档列表');
  assert.equal(typeof item.elapsedMs, 'number');
});
