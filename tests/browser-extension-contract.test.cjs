const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const file = path.resolve(__dirname, '../src/scripts/app/features/browser-extension.js');
const source = fs.readFileSync(file, 'utf8');

test('browser-extension feature keeps all public message handlers', () => {
  for (const name of ['handleExtensionData', 'handleExtensionAnalyze', 'showNotification', 'showDocumentContent']) {
    assert.match(source, new RegExp(`function\\s+${name}\\s*\\(`));
  }
});

test('browser-extension feature retains JP, DE and Espacenet branches', () => {
  assert.match(source, /data\.office === "JP"/);
  assert.match(source, /data\.office === "DE"/);
  assert.match(source, /data\.office === "EP"/);
  assert.match(source, /Espacenet/);
  assert.doesNotMatch(source, /tauri|__TAURI__/i);
});
