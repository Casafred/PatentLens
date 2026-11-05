/*
 * PatentLens - 查询失败提示与重新查询（search-retry.js）单元测试
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../src/scripts/app/features/search-retry.js');

function loadModule() {
  const timers = [];
  const tabs = [];
  const ctx = {
    console,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    document: { readyState: 'complete' },
  };
  ctx.window = ctx;
  ctx._dossierTabs = tabs;
  ctx.parsePatentNumber = (input) => ({ raw: input });
  ctx._dossierMakeKey = (pn) => String(pn || '').trim().toUpperCase();
  ctx.isJPPatent = () => false;
  ctx.isCNPatent = () => false;
  ctx._dossierCloseTabByKey = (key) => {
    const idx = tabs.findIndex((tab) => tab.key === key);
    if (idx < 0) return false;
    tabs.splice(idx, 1);
    return true;
  };
  ctx._dossierNewTabFromSearch = (input) => {
    const key = ctx._dossierMakeKey(input);
    if (tabs.some((tab) => tab.key === key)) return false;
    tabs.push({ key, currentData: null });
    return true;
  };
  ctx._promptCacheChoice = async () => ({ choice: 'none', entry: null });
  ctx.doSearch = async function (input) {
    const ok = ctx.window.confirm('查询失败: boom\n\n点击【确定】重试，点击【取消】放弃');
    return ok ? 'retry' : 'notified';
  };
  ctx.confirm = () => { throw new Error('native confirm should not be called'); };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  timers.splice(0).forEach((fn) => fn());
  return { ctx, tabs };
}

test('query failure confirm is converted to an auto-dismiss result without retry', async () => {
  const { ctx } = loadModule();
  const result = await ctx.doSearch('EP123');
  assert.equal(result, 'notified');
  assert.equal(typeof ctx.confirm, 'function', 'confirm should be restored after doSearch');
});

test('searching a failed tab closes it and creates a fresh query tab', () => {
  const { ctx, tabs } = loadModule();
  tabs.push({ key: 'EP123', currentData: { warnings: ['文档列表查询失败: 503'] } });
  assert.equal(ctx._dossierNewTabFromSearch('EP123'), true);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].currentData, null);
});

test('searching a tab with successful data still switches without re-querying', () => {
  const { ctx, tabs } = loadModule();
  tabs.push({ key: 'EP123', currentData: { documents: { docs: [{ docId: '1' }] } } });
  assert.equal(ctx._dossierNewTabFromSearch('EP123'), false);
  assert.equal(tabs.length, 1);
  assert.ok(tabs[0].currentData.documents);
});

test('failed tab bypasses the local-cache choice dialog and reloads from network', async () => {
  const { ctx, tabs } = loadModule();
  tabs.push({ key: 'EP123', currentData: null });
  const result = await ctx._promptCacheChoice('EP123');
  assert.equal(result.choice, 'reload');
  assert.equal(result.entry, null);
});
