const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  let captured = null;
  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument(options) { captured = options; return { promise: Promise.resolve() }; },
  };
  const sandbox = { pdfjsLib, URL, console };
  sandbox.document = { baseURI: "http://127.0.0.1:4321/web.html" };
  const context = vm.createContext(sandbox);
  const file = path.resolve(__dirname, "../src/scripts/app/shared/pdf-runtime.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { pdfjsLib, captured: () => captured };
}

test("本地 worker 覆盖历史 CDN 地址", () => {
  const { pdfjsLib } = loadRuntime();
  assert.match(pdfjsLib.GlobalWorkerOptions.workerSrc, /scripts\/vendor\/pdf\.worker\.min\.js$/);
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  assert.match(pdfjsLib.GlobalWorkerOptions.workerSrc, /^http:\/\/127\.0\.0\.1:4321\/scripts\/vendor\/pdf\.worker\.min\.js$/);
});

test("getDocument 默认使用本地 CID CMap，否则文字层会为空", () => {
  const { pdfjsLib, captured } = loadRuntime();
  pdfjsLib.getDocument({ data: new Uint8Array([1, 2, 3]) });
  const options = captured();
  assert.equal(options.cMapUrl, "http://127.0.0.1:4321/scripts/vendor/cmaps/");
  assert.equal(options.cMapPacked, true);

  pdfjsLib.getDocument({ data: new Uint8Array([1]), cMapUrl: "custom/", cMapPacked: false });
  assert.equal(captured().cMapUrl, "custom/");
  assert.equal(captured().cMapPacked, false);
});
