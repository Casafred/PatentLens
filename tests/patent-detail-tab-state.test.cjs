const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  constructor(attrs = {}) {
    this.dataset = {};
    Object.keys(attrs).forEach((key) => {
      if (key.startsWith('data-')) this.dataset[key.slice(5)] = attrs[key];
    });
    this.classList = {
      values: new Set(),
      toggle: (name, force) => {
        if (force) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
      contains: (name) => this.classList.values.has(name),
    };
  }
}

function buildEnv() {
  const layout = new Element();
  const bookmarkTabs = ['overview', 'claims', 'description', 'references'].map((tab) => {
    const el = new Element({ 'data-tab': tab });
    if (tab === 'overview') el.classList.values.add('active');
    return el;
  });
  const panels = ['overview', 'claims', 'description', 'references'].map((tab) => {
    const el = new Element({ 'data-panel': tab });
    if (tab === 'overview') el.classList.values.add('active');
    return el;
  });
  layout.querySelector = (selector) => {
    if (selector === '.pd-bookmark-tab.active') return bookmarkTabs.find((el) => el.classList.contains('active')) || null;
    return null;
  };
  layout.querySelectorAll = (selector) => selector === '.pd-bookmark-tab' ? bookmarkTabs : panels;

  const ctx = {
    console,
    _pdActivePatent: 'US100A',
    document: {
      getElementById: () => null,
      querySelector: (selector) => selector === '#patent-detail-content .pd-tab-layout' ? layout : null,
    },
    window: {},
  };
  ctx.window.switchPatentTab = (tabName) => {
    bookmarkTabs.forEach((el) => el.classList.toggle('active', el.dataset.tab === tabName));
    panels.forEach((el) => el.classList.toggle('active', el.dataset.panel === tabName));
  };
  ctx.window.renderPatentDetail = () => {
    bookmarkTabs.forEach((el) => el.classList.toggle('active', el.dataset.tab === 'overview'));
    panels.forEach((el) => el.classList.toggle('active', el.dataset.panel === 'overview'));
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const file = path.resolve(__dirname, '../src/scripts/app/features/patent-detail-tab-state.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return { ctx, layout, bookmarkTabs };
}

function activeTab(env) {
  return env.layout.querySelector('.pd-bookmark-tab.active').dataset.tab;
}

test('原文多标签按专利号分别保留最后打开的栏目', () => {
  const env = buildEnv();
  const render = env.ctx.window.renderPatentDetail;
  const switchTab = env.ctx.window.switchPatentTab;

  render({ patent_number: 'US100A' });
  switchTab('claims');
  env.ctx._pdActivePatent = 'US200B';
  render({ patent_number: 'US200B' });
  switchTab('description');

  env.ctx._pdActivePatent = 'US100A';
  render({ patent_number: 'US100A' });
  assert.equal(activeTab(env), 'claims');

  env.ctx._pdActivePatent = 'US200B';
  render({ patent_number: 'US200B' });
  assert.equal(activeTab(env), 'description');
});

test('重新渲染同一原文标签不会丢失栏目状态', () => {
  const env = buildEnv();
  env.ctx._pdActivePatent = 'EP300C';
  env.ctx.window.renderPatentDetail({ patent_number: 'EP300C' });
  env.ctx.window.switchPatentTab('references');
  env.ctx.window.renderPatentDetail({ patent_number: 'EP300C' });
  assert.equal(activeTab(env), 'references');
});
