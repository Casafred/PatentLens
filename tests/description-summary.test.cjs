/*!
 * PatentLens - 说明书实施例总结（description-summary.js）单元测试
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 覆盖两个历史 bug 的回归：
 *   1. rAF 时序 bug：流式渲染回调在 renderDone 之后执行，覆盖掉带段落号
 *      溯源链接的最终渲染 → 必须 cancelAnimationFrame
 *   2. 段落锚点缺失：说明书原文单换行连接（无空行）时 renderDescriptionHtml
 *      渲染成一个大 <p>（<br> 分隔）且无 .pd-para-num → DOM 后处理增强
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// ── 最小 DOM stub（支持元素/文本节点/后代组合器/异步 rAF） ──

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this._text = text;
    this.parentNode = null;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  remove() {
    if (this.parentNode) {
      const cs = this.parentNode.childNodes;
      cs.splice(cs.indexOf(this), 1);
    }
  }
}

function parseAttrs(el, attrStr) {
  const attrRe = /([a-z-]+)(?:="([^"]*)")?/gi;
  let am;
  while ((am = attrRe.exec(attrStr)) !== null) {
    if (am[1] === 'class') am[2].split(/\s+/).forEach(c => c && el.classList.add(c));
    else el.setAttribute(am[1], am[2] !== undefined ? am[2] : '');
  }
}

class Element {
  constructor(tag, attrs) {
    this.nodeType = 1;
    this.tagName = (tag || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = {};
    this._attrs = attrs || {};
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); return this._set.has(c); },
      contains(c) { return this._set.has(c); },
    };
    const self = this;
    Object.defineProperty(this, 'innerHTML', {
      get() { return self._html || ''; },
      set(html) {
        self._html = html;
        self.childNodes = [];
        if (html) parseHtml(self, html);
      },
    });
    Object.defineProperty(this, 'className', {
      get() { return Array.from(this.classList._set).join(' '); },
      set(v) {
        this.classList._set = new Set();
        String(v).split(/\s+/).forEach(c => c && this.classList._set.add(c));
      },
    });
  }
  get textContent() {
    if (this._textContent !== undefined) return this._textContent;
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this._textContent = String(v);
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] || null; }
  get dataset() {
    const ds = {};
    for (const k in this._attrs) {
      if (k.startsWith('data-')) {
        ds[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = this._attrs[k];
      }
    }
    return ds;
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, c); else this.childNodes.push(c);
    return c;
  }
  replaceChild(newNode, oldNode) {
    const i = this.childNodes.indexOf(oldNode);
    if (i >= 0) this.childNodes.splice(i, 1, newNode);
    newNode.parentNode = this;
    if (oldNode.parentNode === this) oldNode.parentNode = null;
    return oldNode;
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  dispatchClick(target) {
    const ev = { target };
    (this._listeners.click || []).forEach(fn => fn(ev));
  }
  closest(sel) {
    let el = this;
    while (el) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  matches(sel) {
    return sel.trim().split(/\s+/).length === 1 && sel.split(/(?=[.#\[])/).every(part => {
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      if (part.startsWith('#')) return this._attrs.id === part.slice(1);
      if (part.startsWith('[')) {
        const m = part.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
        if (!m) return false;
        const v = this._attrs[m[1]];
        return m[2] !== undefined ? v === m[2] : v !== undefined;
      }
      return this.tagName === part.toUpperCase();
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    const out = [];
    const walk = (el, idx) => {
      el.childNodes.forEach(c => {
        if (c.nodeType === 1) {
          if (c.matches(parts[idx])) {
            if (idx === parts.length - 1) out.push(c);
            else walk(c, idx + 1);
          }
          walk(c, idx);
        }
      });
    };
    walk(this, 0);
    return out;
  }
  remove() {
    if (this.parentNode) {
      const cs = this.parentNode.childNodes;
      cs.splice(cs.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  scrollIntoView() { this._scrolled = true; }
}

class DocumentFragment extends Element {
  constructor() { super('#document-fragment'); }
}

const VOID_TAGS = new Set(['BR', 'IMG', 'HR', 'INPUT', 'META', 'LINK', 'AREA', 'BASE', 'COL', 'EMBED', 'SOURCE', 'TRACK', 'WBR']);

function parseHtml(parent, html) {
  const tagRe = /<(\/?)([a-z0-9]+)((?:\s+[^<>]*?)?)\/?>/gi;
  const stack = [parent];
  let m, lastIndex = 0;
  const text = (t) => {
    if (t && stack[stack.length - 1]) {
      stack[stack.length - 1].appendChild(new TextNode(t));
    }
  };
  while ((m = tagRe.exec(html)) !== null) {
    text(html.slice(lastIndex, m.index));
    lastIndex = m.index + m[0].length;
    const [, close, tag, attrStr] = m;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const el = new Element(tag);
    parseAttrs(el, attrStr || '');
    stack[stack.length - 1].appendChild(el);
    // void 标签（<br> 等）无闭合标签，不入栈
    if (!/\/>$/.test(m[0]) && !VOID_TAGS.has(el.tagName)) stack.push(el);
  }
  text(html.slice(lastIndex));
}

// ── 测试环境构建 ──────────────────────────────────────────

function buildEnv() {
  const document = new Element('html');
  const body = new Element('body');
  document.appendChild(body);

  const detailRoot = new Element('div', { id: 'patent-detail-content' });
  body.appendChild(detailRoot);

  // 构建说明书面板结构（同 web-app.js renderPatentDetail + renderDescriptionPanelHtml）
  const descPanel = new Element('div');
  descPanel.classList.add('pd-tab-panel');
  descPanel.setAttribute('data-panel', 'description');
  detailRoot.appendChild(descPanel);

  const panelHeader = new Element('div');
  panelHeader.classList.add('pd-panel-header');
  descPanel.appendChild(panelHeader);
  const panelActions = new Element('div');
  panelActions.classList.add('pd-panel-actions');
  panelHeader.appendChild(panelActions);

  const panelBody = new Element('div');
  panelBody.classList.add('pd-tab-panel-body');
  panelBody.setAttribute('data-panel-body', 'description');
  descPanel.appendChild(panelBody);

  const descText = new Element('div');
  descText.classList.add('pd-description-text');
  panelBody.appendChild(descText);

  // 模拟 renderDescriptionHtml 对单换行说明书的输出（一个大 <p> 用 <br> 分隔）
  function renderSingleLineDesc(paras) {
    let html = '';
    // 第一段会被当作 section 标题（renderDescriptionHtml 的 section 逻辑）
    html += '<div class="pd-desc-section-title">' + paras[0] + '</div>';
    html += '<p>' + paras.slice(1).join('<br>') + '</p>';
    descText.innerHTML = html;
  }

  // 异步 rAF（模拟真实浏览器时序）+ cancelAnimationFrame
  const rafQueue = new Map();
  let rafId = 0;

  const ctx = {
    console,
    setTimeout,
    alert: () => {},
    localStorage: { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = v; } },
    requestAnimationFrame: (fn) => { const id = ++rafId; rafQueue.set(id, fn); return id; },
    cancelAnimationFrame: (id) => rafQueue.delete(id),
    flushRaf: () => { for (const fn of Array.from(rafQueue.values())) fn(); rafQueue.clear(); },
    document: {
      querySelector: (s) => document.querySelector(s),
      querySelectorAll: (s) => document.querySelectorAll(s),
      createElement: (tag) => new Element(tag),
      createDocumentFragment: () => new DocumentFragment(),
    },
    MutationObserver: function () { this.observe = () => {}; },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/scripts/app/features/description-summary.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'description-summary.js' });

  // marked stub：极简 markdown（保留 [00XX] 原样，加粗转 HTML）
  ctx.renderMarkdown = (t) => String(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .split('\n').filter(l => l.trim()).map(l => '<p>' + l + '</p>').join('\n');

  return { ctx, document, detailRoot, descPanel, panelBody, descText, renderSingleLineDesc };
}

function mockAI(ctx, summary) {
  ctx.window._currentPatentData = {
    patent_number: 'CN110000000A',
    title: '测试专利',
    description: 'mock',
    claims: [],
  };
  ctx.window.AI = {
    loadAIConfig: () => ({}),
    getCurrentProvider: () => ({ type: 'test', apiKey: 'k', baseUrl: 'u', model: 'm' }),
    streamChat: async function* () { yield { content: summary }; },
  };
}

const SUMMARY = '## 整体结构\n\n**技术领域** [0001]-[0003]：涉及数据处理。\n\n**实施例** [0011]-[0018]：方式甲。\n含不存在段落 [0099]。\n';

// ── 测试用例 ──────────────────────────────────────────────

test('回归1: rAF 流式渲染不得覆盖 renderDone 的溯源链接（异步 rAF 时序）', async () => {
  const env = buildEnv();
  // 说明书含 SUMMARY 引用的全部段落（[0001]-[0003]、[0011]-[0018]）
  const paras = ['[0001] 第一段。', '[0002] 第二段。', '[0003] 第三段。'];
  for (let i = 11; i <= 18; i++) paras.push('[' + String(i).padStart(4, '0') + '] 实施例第' + i + '段。');
  env.renderSingleLineDesc(paras);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);
  // 模拟 rAF 在 renderDone 之后才执行（修复前：pending 帧覆盖最终渲染）
  env.ctx.flushRaf();
  await new Promise(r => setTimeout(r, 10));

  const body = env.detailRoot.querySelector('.pd-desc-summary-body');
  const refs = body.querySelectorAll('.pd-desc-ref');
  // SUMMARY 含 [0001]-[0003]、[0011]-[0018]、[0099] 共 3 处引用
  assert.equal(refs.length, 3, '段落号应转为可点击标签');
  const missing = body.querySelectorAll('.pd-desc-ref.missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].dataset.para, '0099');
});

test('回归2: 单换行说明书增强出 .pd-para-num 锚点（大 <p> 按 <br> 拆分）', async () => {
  const env = buildEnv();
  const paras = [];
  for (let i = 1; i <= 10; i++) paras.push('[' + String(i).padStart(4, '0') + '] 第' + i + '段内容。');
  env.renderSingleLineDesc(paras);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);

  const nums = env.panelBody.querySelectorAll('.pd-para-num');
  // [0001] 成了标题，[0002]-[0010] 共 9 个锚点
  assert.equal(nums.length, 9);
  assert.equal(nums[0].textContent, '[0002]');
  // 大 <p> 已拆分为独立 <p>
  const ps = env.descText.querySelectorAll('p');
  assert.equal(ps.length, 9);
});

test('回归3: 点击段落号标签跳转滚动并高亮闪烁', async () => {
  const env = buildEnv();
  const paras = [];
  for (let i = 1; i <= 12; i++) paras.push('[' + String(i).padStart(4, '0') + '] 第' + i + '段内容。');
  env.renderSingleLineDesc(paras);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);

  const body = env.detailRoot.querySelector('.pd-desc-summary-body');
  const ref0011 = body.querySelectorAll('.pd-desc-ref').find(r => r.dataset.para === '0011');
  assert.ok(ref0011, '应存在 [0011] 标签');
  env.detailRoot.querySelector('.pd-desc-summary-panel').dispatchClick(ref0011);

  const flashing = env.panelBody.querySelectorAll('.pd-desc-ref-flash');
  assert.equal(flashing.length, 1);
  assert.ok(flashing[0].textContent.includes('[0011]'));
  assert.ok(flashing[0]._scrolled, '目标段落应滚动定位');
});

test('回归4: 首段被渲染为章节标题时跳转走标题 fallback', async () => {
  const env = buildEnv();
  env.renderSingleLineDesc(['[0001] 第一段。', '[0002] 第二段。', '[0003] 第三段。']);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);

  const body = env.detailRoot.querySelector('.pd-desc-summary-body');
  const ref0001 = body.querySelectorAll('.pd-desc-ref').find(r => r.dataset.para === '0001');
  assert.ok(ref0001, '[0001] 标签应存在（标题 fallback 判定存在）');
  assert.ok(!ref0001.classList.contains('missing'), '[0001] 不应标记 missing');

  env.detailRoot.querySelector('.pd-desc-summary-panel').dispatchClick(ref0001);
  const flashing = env.panelBody.querySelectorAll('.pd-desc-ref-flash');
  assert.equal(flashing.length, 1);
  assert.ok(flashing[0].classList.contains('pd-desc-section-title'), '应闪烁章节标题');
});

test('回归5: 段落增强幂等（重跑不产生重复拆分/包装）', async () => {
  const env = buildEnv();
  env.renderSingleLineDesc(['[0001] 第一段。', '[0002] 第二段。', '[0003] 第三段。']);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);
  const after1 = env.descText.querySelectorAll('.pd-para-num').length;
  const p1 = env.descText.querySelectorAll('p').length;

  // 再次触发（重新总结 → ensurePanel 再次增强）
  await env.ctx.DescriptionSummary.run('detail', true);
  const after2 = env.descText.querySelectorAll('.pd-para-num').length;
  const p2 = env.descText.querySelectorAll('p').length;

  assert.equal(after1, after2);
  assert.equal(p1, p2);
});

test('回归6: 数据源兜底——说明书原文含段落号则不标记 missing', async () => {
  const env = buildEnv();
  // DOM 渲染成无段落号的大 <p>（增强前），但原文数据含 [0005]
  env.renderSingleLineDesc(['[0001] 第一段。', '[0002] 第二段。']);
  mockAI(env.ctx, SUMMARY + '另见 [0005]。\n');
  env.ctx.window._currentPatentData.description = '[0001] 第一段。\n[0005] 第五段。';

  await env.ctx.DescriptionSummary.run('detail', false);

  const body = env.detailRoot.querySelector('.pd-desc-summary-body');
  const ref0005 = body.querySelectorAll('.pd-desc-ref').find(r => r.dataset.para === '0005');
  assert.ok(ref0005);
  assert.ok(!ref0005.classList.contains('missing'), '原文含 [0005] 不应 missing');
});

test('回归7: 缓存渲染后段落号标签仍可点击', async () => {
  const env = buildEnv();
  env.renderSingleLineDesc(['[0001] 第一段。', '[0002] 第二段。', '[0003] 第三段。', '[0011] 实施例。']);
  mockAI(env.ctx, SUMMARY);

  await env.ctx.DescriptionSummary.run('detail', false);   // 首次（写缓存）
  await env.ctx.DescriptionSummary.run('detail', false);   // 缓存命中

  const body = env.detailRoot.querySelector('.pd-desc-summary-body');
  const refs = body.querySelectorAll('.pd-desc-ref');
  assert.equal(refs.length, 3, '缓存渲染后链接应保留');
});
