const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

for (const shellName of ['src/web.html', 'src/index.html']) {
  test(`${shellName} exposes the custom provider entry point`, () => {
    const html = fs.readFileSync(path.join(root, shellName), 'utf8');

    assert.match(html, /<option value="custom">自定义供应商<\/option>/);
    assert.match(html, /id="custom-provider-open-btn"/);
    assert.match(html, /id="custom-provider-options"[^>]*hidden/);
    assert.match(html, /id="custom-provider-name"/);
    assert.match(html, /id="custom-provider-protocol"/);
    assert.match(html, /id="custom-provider-reasoning"/);
    assert.match(html, /scripts\/app\/features\/ai-model-settings\.js\?v=260912b/);
  });
}

test('the custom provider module contains a static and dynamic UI fallback', () => {
  const script = fs.readFileSync(path.join(root, 'src/scripts/app/features/ai-model-settings.js'), 'utf8');

  assert.match(script, /box\.id = "custom-provider-options"/);
  assert.match(script, /custom-provider-open-btn/);
  assert.match(script, /loadCustomProviderFields/);
  assert.match(script, /persistCustomForm/);
});
