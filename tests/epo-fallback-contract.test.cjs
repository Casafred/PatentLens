const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../electron-main.js'), 'utf8');

test('EPO browser flow does not cache a Global Dossier link before it is verified', () => {
  assert.doesNotMatch(source, /setCachedDossierUrl\(office,\s*docNumber,\s*gdLink\)/);
  assert.match(source, /setCachedDossierUrl/);
});

test('EPO failures only trigger verification prompts for real Cloudflare or rate limits', () => {
  assert.doesNotMatch(source, /cloudflare:\s*!epoDirect\s*&&\s*true/);
  assert.match(source, /cloudflare:\s*!!epoResult\.cloudflare/);
  assert.match(source, /rateLimited:\s*!!epoResult\.rateLimited/);
});

test('EPO browser windows terminate failed or stuck pages instead of waiting indefinitely', () => {
  assert.match(source, /did-fail-load/);
  assert.match(source, /EPO Register 页面加载失败/);
  assert.match(source, /45 秒内未加载出审查文档列表/);
  assert.match(source, /epoPolicy\.classifyEpoPage/);
});

test('EPO browser requests are de-duplicated per patent and purpose', () => {
  assert.match(source, /_epoBrowserFlights/);
  assert.match(source, /epoFetchViaBrowserWindow/);
});
