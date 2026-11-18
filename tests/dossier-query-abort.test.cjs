const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  return {
    disabled: false,
    classList: { add() {}, remove() {} },
    parentNode: null,
  };
}

// 在浏览器里 window 就是全局对象；VM 里让二者指向同一对象，才能准确模拟
// 模块通过裸标识符（doSearch / gdFetch / _dossierTabs）访问全局函数的场景。
function loadAbortModule(configure) {
  const elements = {
    'search-btn': createElement(),
    'content-loading-overlay': createElement(),
    loading: createElement(),
  };
  elements['content-loading-overlay'].parentNode = { removeChild() {} };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    AbortController,
    DOMException,
    location: { href: 'http://127.0.0.1:8080/web.html' },
    getElementById(id) { return elements[id] || null; },
  };
  sandbox.window = sandbox;
  sandbox.document = sandbox;
  const context = vm.createContext(sandbox);
  if (configure) configure(context);
  const file = path.resolve(__dirname, '../src/scripts/app/features/dossier-query-abort.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { context, elements };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function installDossierMocks(context, request, hooks) {
  let observedSignal = null;
  context.fetch = function (input, init) {
    observedSignal = init && init.signal;
    return request.promise;
  };
  context.gdFetch = function () {
    return context.fetch('/api/gd/doc-list/svc/doclist/US/14342033/A');
  };
  context.doSearch = async function () {
    await context.gdFetch();
    hooks.onComplete();
  };
  context._dossierTabs = [{ key: 'TAB-A' }, { key: 'TAB-B' }];
  context._dossierActiveKey = 'TAB-A';
  context._dossierCloseTab = function (key) {
    context._dossierTabs = context._dossierTabs.filter((tab) => tab.key !== key);
  };
  context._dossierCloseTabByKey = context._dossierCloseTab;
  return () => observedSignal;
}

test('关闭正在查询的标签页会中止请求、恢复按钮并阻止后续副作用', async () => {
  const request = deferred();
  let completed = false;
  const { context, elements } = loadAbortModule((ctx) => {
    installDossierMocks(ctx, request, { onComplete() { completed = true; } });
  });

  context.doSearch('US14342033');
  await Promise.resolve();

  assert.equal(context.window.__dossierQueryAbort.isActive(), true);

  context._dossierCloseTab('TAB-A');
  await Promise.resolve();

  assert.equal(context.window.__dossierQueryAbort.isActive(), false);
  assert.equal(elements['search-btn'].disabled, false);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(completed, false, '被中断的查询不能继续执行看板/缓存写入');

  // 被中止的底层请求即使稍后返回，也不应再恢复 doSearch（Promise 保持 pending）。
  request.resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('关闭其他标签页不会终止当前查询', async () => {
  const request = deferred();
  const { context } = loadAbortModule((ctx) => {
    installDossierMocks(ctx, request, { onComplete() {} });
  });

  const running = context.doSearch('TAB-A');
  await Promise.resolve();
  context._dossierCloseTab('TAB-B');
  await Promise.resolve();

  assert.equal(context.window.__dossierQueryAbort.isActive(), true);

  request.resolve({ ok: true });
  await running;
  assert.equal(context.window.__dossierQueryAbort.isActive(), false);
});

test('新查询会取代上一次仍在进行的查询', async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const { context } = loadAbortModule((ctx) => {
    ctx.fetch = function (input, init) {
      call += 1;
      if (call === 1) {
        ctx.__firstSignal = init && init.signal;
        return first.promise;
      }
      return second.promise;
    };
    ctx.gdFetch = function () { return ctx.fetch('/api/gd/doc-list'); };
    ctx.doSearch = async function () { await ctx.gdFetch(); };
    ctx._dossierTabs = [{ key: 'TAB-A' }, { key: 'TAB-B' }];
    ctx._dossierActiveKey = 'TAB-A';
    ctx._dossierCloseTab = function () {};
  });

  const firstRun = context.doSearch('TAB-A');
  await Promise.resolve();
  context.doSearch('TAB-B');
  await Promise.resolve();

  assert.equal(context.__firstSignal.aborted, true);
  assert.equal(context.window.__dossierQueryAbort.isActive(), true);

  // 第一个查询已被中止，其 Promise 按设计保持 pending，不应等待它。
  void firstRun;
  second.resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
});
