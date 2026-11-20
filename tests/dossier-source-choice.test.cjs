const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeElement(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    className: '',
    style: {},
    hidden: false,
    textContent: '',
    innerHTML: '',
    parentNode: null,
    children: [],
    _listeners: {},
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    querySelector(selector) {
      if (String(selector).indexOf('[data-action=') !== -1) return fakeElement('button');
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, handler) { (el._listeners[name] = el._listeners[name] || []).push(handler); },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    closest() { return null; },
  };
  return el;
}

function loadModule(configure) {
  const body = fakeElement('body');
  const head = fakeElement('head');
  const storage = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    sessionStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    document: {
      head,
      body,
      createElement: (tag) => fakeElement(tag),
      getElementById() { return null; },
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (configure) configure(context);
  const file = path.resolve(__dirname, '../src/scripts/app/features/dossier-source-choice.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { context, body };
}

test('默认不追加 EPO 标记；用户选择 EPO 后所有 /api/gd 请求显式降级', async () => {
  const calls = [];
  const { context } = loadModule((ctx) => {
    ctx.fetch = (input) => { calls.push(String(input)); return Promise.resolve({ ok: true }); };
  });

  await context.fetch('/api/gd/doc-list/svc/doclist/US/14342033/A');
  assert.equal(calls[0], '/api/gd/doc-list/svc/doclist/US/14342033/A');

  context.__plDossierSourceChoice.preferEpo(true);
  await context.fetch('/api/gd/doc-list/svc/doclist/US/14342033/A');
  assert.match(calls[1], /epoFallback=1/);

  await context.fetch('/api/gd/doc-list/svc/doclist/US/14342033/A?epoFallback=1');
  assert.equal((calls[2].match(/epoFallback=1/g) || []).length, 1);
});

test('GD 失败时只弹选择框，不自动打开 EPO 窗口', () => {
  let autoOpened = 0;
  const loaded = loadModule((ctx) => {
    ctx._promptGdEpoBrowserOpen = function () { autoOpened++; };
  });
  loaded.context._promptGdEpoBrowserOpen({ gdFailed: true, message: '需要先登录 GD', loginRequired: true }, '文档列表');
  assert.equal(autoOpened, 0);
  assert.ok(loaded.body.children.length > 0, '应展示数据源选择弹窗');
});

test('已选择 EPO 时保留 EPO 人机验证窗口流程', () => {
  let autoOpened = 0;
  const loaded = loadModule((ctx) => {
    ctx._promptGdEpoBrowserOpen = function () { autoOpened++; };
  });
  loaded.context.__plDossierSourceChoice.preferEpo(true);
  loaded.context._promptGdEpoBrowserOpen({ cloudflare: true, browserUrl: 'https://register.epo.org/x' }, '文档列表');
  assert.equal(autoOpened, 1);
});

test('gdFetch 错误会补回后端 gdFailed 标志供选择框识别', async () => {
  const { context } = loadModule((ctx) => {
    ctx.fetch = () => Promise.resolve({
      ok: false,
      status: 502,
      headers: { get: () => 'application/json' },
      clone() { return { json: async () => ({ gdFailed: true, loginRequired: true, epoAvailable: true, error: '需要登录' }) }; },
    });
    ctx.gdFetch = async () => {
      const resp = await ctx.fetch('/api/gd/doc-list/svc/doclist/US/14342033/A');
      throw new Error('API 请求失败: HTTP ' + resp.status);
    };
  });
  await assert.rejects(context.gdFetch('/api/gd/doc-list/svc/doclist/US/14342033/A'), (error) => {
    assert.equal(error.gdFailed, true);
    assert.equal(error.loginRequired, true);
    assert.equal(error.epoAvailable, true);
    return true;
  });
});
