const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAiSessionCache(env) {
  const file = path.resolve(__dirname, '../src/scripts/app/features/ai-session-cache.js');
  const source = fs.readFileSync(file, 'utf8');
  const store = new Map();
  const elements = new Map();
  const observers = [];

  function getEl(id) {
    if (!elements.has(id)) {
      const classList = new Set();
      const el = {
        classList: {
          list: classList,
          contains: (c) => classList.has(c),
          add: (c) => classList.add(c),
          remove: (c) => classList.delete(c),
        },
        className: '',
        textContent: '',
        innerHTML: '',
        children: [],
        dataset: {},
        style: {},
        disabled: false,
        getAttribute: () => null,
        setAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: function (c) { el.children.push(c); return c; },
        removeChild: function (c) {
          const i = el.children.indexOf(c);
          if (i >= 0) el.children.splice(i, 1);
          return c;
        },
        querySelector: () => null,
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }

  class MockMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() {}
    trigger() { try { this.cb(); } catch (e) { /* module wraps its own callbacks */ } }
  }

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => Array.from(store.keys())[i] || null,
  };
  Object.defineProperty(localStorage, 'length', { get: () => store.size });

  const context = vm.createContext({
    console,
    Date,
    JSON,
    String,
    Number,
    parseInt,
    isNaN,
    Math,
    Array,
    Object,
    Promise,
    Set,
    Map,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    localStorage,
    document: {
      getElementById: getEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: getEl('body'),
      createElement: (tag) => getEl('created-' + tag),
    },
    MutationObserver: MockMutationObserver,
    window: {},
    runPatentInterpretation: () => {},
    appendAnalysisChatMessage: () => {},
    renderMarkdown: (s) => s,
    renderMarkdownWithTrace: (s) => s,
    _loadPatentAskCache: () => null,
    _PATENT_ASK_CACHE_PREFIX: 'patentlens_ask_',
    _renderPatentAskMessages: () => {},
    kanbanState: env.kanbanState || {},
    currentData: env.currentData,
    analysisChatHistory: env.analysisChatHistory || [],
    chatHistory: env.chatHistory || [],
    pdfViewState: env.pdfViewState || {},
  });

  vm.runInContext(source, context, { filename: file });
  return { context, store, elements, observers };
}

test('analysis chat skips saving when currentData lacks patent identifiers', () => {
  const { store, elements, observers } = loadAiSessionCache({
    currentData: { office: undefined, applicationNumber: undefined, raw: '' },
    kanbanState: { analysis: 'test-analysis' },
    analysisChatHistory: [{ role: 'user', content: 'hello' }],
  });

  const sendBtn = elements.get('analysis-chat-send-btn');
  assert.ok(sendBtn, 'analysis send button should be observed');

  sendBtn.disabled = true;
  observers.forEach((o) => o.trigger());

  sendBtn.disabled = false;
  observers.forEach((o) => o.trigger());

  const keys = Array.from(store.keys());
  const badKeys = keys.filter((k) => k.includes('undefined') || k === 'patentlens-analysis-chat-');
  assert.deepEqual(badKeys, [], `unexpected keys written: ${JSON.stringify(keys)}`);
});

test('analysis chat writes a well-formed key when identifiers exist', () => {
  const { store, elements, observers } = loadAiSessionCache({
    currentData: { office: 'US', applicationNumber: '20240012345', raw: '' },
    kanbanState: { analysis: 'test-analysis' },
    analysisChatHistory: [{ role: 'user', content: 'hello' }],
  });

  const sendBtn = elements.get('analysis-chat-send-btn');
  sendBtn.disabled = true;
  observers.forEach((o) => o.trigger());

  const keys = Array.from(store.keys());
  assert.ok(keys.some((k) => k === 'patentlens-analysis-chat-US20240012345'), `expected key not found in ${JSON.stringify(keys)}`);
  const badKeys = keys.filter((k) => k.includes('undefined'));
  assert.deepEqual(badKeys, [], `no undefined fragments allowed: ${JSON.stringify(keys)}`);
});
