const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const timers = [], intervals = [], listeners = {}, status = { hidden: true, querySelector: () => ({}) };
  const c = vm.createContext({ _googleTranslateActive: false, _googleTranslateInjected: false, _figLinkPollTimer: null, _gtActivationTriggered: false, _figLinkScope: null,
    _currentPatentData: { patent_number: 'CN1' }, _gentleDisableGt() {}, _updateGtButtonState() {},
    toggleGoogleTranslate() { c._googleTranslateActive = true; c.googleTranslateElementInit = () => { c.callbacks++; }; c._onGoogleTranslateActivated(); },
    callbacks: 0, activations: 0, _onGoogleTranslateActivated() { c.activations++; }, _pollSelectGoogleTranslateLang() {}, _pollForTranslationComplete() {},
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimeout: t => { if (t) t.cleared = true; },
    setInterval: fn => { const t = { fn }; intervals.push(t); return t; }, clearInterval: t => { t.cleared = true; },
    queueMicrotask, MutationObserver: class { observe() {} },
    document: { readyState: 'complete', head: { appendChild() {} }, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: tag => tag === 'style' ? {} : status, addEventListener: (name, fn) => { listeners[name] = fn; } }
  });
  c.window = c;
  vm.runInContext(fs.readFileSync(require.resolve('../src/scripts/app/features/google-translate-lifecycle.js'), 'utf8'), c);
  return { c, timers, intervals, status, listeners };
}
test('Google translation times out and ignores callbacks after cancellation, then can restart', () => {
  const { c, timers, status } = fixture();
  c.toggleGoogleTranslate('main'); assert.equal(c.activations, 1, 'synchronous activation is preserved'); assert.equal(status.hidden, false);
  const staleCallback = c.googleTranslateElementInit;
  assert.equal(timers.at(-1).ms, 35000); timers.at(-1).fn();
  assert.equal(c._googleTranslateActive, false); assert.equal(status.hidden, true); staleCallback(); assert.equal(c.callbacks, 0);
  c._onGoogleTranslateActivated(); assert.equal(c.activations, 1);
  c.toggleGoogleTranslate('main'); c.googleTranslateElementInit(); assert.equal(c.callbacks, 1); assert.equal(c.GoogleTranslateLifecycle.isActive(), true);
  c.toggleGoogleTranslate('main'); assert.equal(c.GoogleTranslateLifecycle.isActive(), false);
});
test('Google translation completes, handles script failure and exits on document change', () => {
  const { c, intervals, status, listeners } = fixture();
  c.toggleGoogleTranslate('main'); c._googleTranslateActive = false; intervals.at(-1).fn(); assert.equal(status.hidden, true);
  c.toggleGoogleTranslate('main'); listeners.error({ target: { id: 'google-translate-script' } }); assert.equal(c.GoogleTranslateLifecycle.isActive(), false);
  c.toggleGoogleTranslate('main'); c._currentPatentData = { patent_number: 'CN2' }; intervals.at(-1).fn(); assert.equal(c._googleTranslateActive, false);
});
