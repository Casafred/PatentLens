const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGuard() {
  const classes = new Set();
  const toolbar = { classList: { add: (name) => classes.add(name), contains: (name) => classes.has(name) } };
  const sandbox = {
    console,
    document: { getElementById: (id) => (id === "pdf-annot-multi-toolbar" ? toolbar : null) },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext("let pdfViewState = { selectedAnnotIds: [] };", context);
  vm.runInContext("window.__calls = 0; window.showAnnotMultiToolbar = function () { window.__calls++; };", context);
  const file = path.resolve(__dirname, "../src/scripts/app/features/pdf-annot-toolbar-guard.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, classes };
}

test("框选没有选中任何标注时不弹出标注工具栏", () => {
  const { context, classes } = loadGuard();
  context.showAnnotMultiToolbar();
  assert.equal(context.__calls, 0);
  assert.equal(classes.has("hidden"), true);
});

test("框选命中标注时仍展示标注工具栏", () => {
  const { context, classes } = loadGuard();
  vm.runInContext("pdfViewState.selectedAnnotIds.push('annot-1');", context);
  context.showAnnotMultiToolbar();
  assert.equal(context.__calls, 1);
  assert.equal(classes.has("hidden"), false);
});
