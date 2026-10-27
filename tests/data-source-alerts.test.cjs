/*
 * PatentLens - 数据源异常提醒（data-source-alerts.js）单元测试
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../src/scripts/app/features/data-source-alerts.js');

function createElement(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    className: '',
    style: {},
    parentNode: null,
    _html: '',
    setAttribute() {},
    set innerHTML(value) { this._html = String(value); },
    get innerHTML() { return this._html; },
    querySelector() { return { addEventListener() {} }; },
  };
}

function loadModule(options) {
  const banners = [];
  const registered = {};
  const bridge = options && options.bridge
    ? { onDataSourceIssue(cb) { registered.handler = cb; } }
    : undefined;
  const document = {
    readyState: 'complete',
    body: {
      appendChild(el) {
        el.parentNode = this;
        banners.push(el);
      },
      removeChild(el) {
        const idx = banners.indexOf(el);
        if (idx >= 0) banners.splice(idx, 1);
        el.parentNode = null;
      },
    },
    getElementById(id) {
      return banners.find((el) => el.id === id) || null;
    },
    createElement,
    addEventListener() {},
  };

  const context = vm.createContext({
    window: { electronAPI: bridge },
    document,
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    Date,
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { api: context.window.PatentLensDataSourceAlerts, banners, context, registered };
}

test('data source alerts map each source to an explicit upstream name', () => {
  const { api } = loadModule();
  assert.equal(api._sources.gp.label, 'Google Patents');
  assert.equal(api._sources.gd.label, 'USPTO Global Dossier');
  assert.equal(api._sources.epo.label, 'EPO Register');
  assert.equal(api._sources.gd_epo.label, 'USPTO Global Dossier / EPO Register');
});

test('default message makes clear the failure is not a PatentLens bug', () => {
  const { api } = loadModule();
  const body = api._buildBody('gd_epo', 'unavailable');
  assert.match(body, /USPTO \/ EPO 官方服务器/);
  assert.match(body, /不是 PatentLens 软件故障/);
  assert.match(body, /审查文档/);
});

test('cloudflare and rate limit reasons explain the EPO-side cause', () => {
  const { api } = loadModule();
  assert.match(api._buildBody('epo', 'cloudflare'), /人机验证/);
  assert.match(api._buildBody('epo', 'rate_limited'), /限制.*访问频率/);
});

test('report renders one banner and dedupes the same source', () => {
  const { api, banners } = loadModule();
  assert.equal(api.report({ source: 'gp', reason: 'unavailable', detail: 'HTTP 503' }), true);
  assert.equal(banners.length, 1);
  assert.match(banners[0].innerHTML, /Google Patents/);
  assert.match(banners[0].innerHTML, /HTTP 503/);

  assert.equal(api.report({ source: 'gp', reason: 'unavailable', detail: 'HTTP 503' }), false);
  assert.equal(banners.length, 1);
});

test('report ignores unknown sources and empty payloads', () => {
  const { api, banners } = loadModule();
  assert.equal(api.report(null), false);
  assert.equal(api.report({ source: 'unknown' }), false);
  assert.equal(banners.length, 0);
});

test('electron main and shell wire the alert module to GP/GD/EPO failures', () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../electron-main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8');
  const shellSource = fs.readFileSync(path.resolve(__dirname, '../src/web.html'), 'utf8');

  assert.match(mainSource, /function notifyDataSourceIssue\(/);
  assert.match(mainSource, /notifyDataSourceIssue\(\s*"gp"/);
  assert.match(mainSource, /notifyDataSourceIssue\(alertSource, "cloudflare"/);
  assert.match(mainSource, /notifyDataSourceIssue\(alertSource, "unavailable"/);
  assert.match(preloadSource, /onDataSourceIssue:/);
  assert.match(shellSource, /scripts\/app\/features\/data-source-alerts\.js/);
});

test('electron bridge delivers data-source-issue payloads to the banner', () => {
  const { banners, registered } = loadModule({ bridge: true });
  assert.equal(typeof registered.handler, 'function');

  registered.handler({
    source: 'epo',
    reason: 'cloudflare',
    detail: 'EPO Register 要求完成人机验证',
  });

  assert.equal(banners.length, 1);
  assert.match(banners[0].innerHTML, /EPO Register/);
  assert.match(banners[0].innerHTML, /人机验证/);
  assert.match(banners[0].innerHTML, /不是 PatentLens 软件故障/);
});
