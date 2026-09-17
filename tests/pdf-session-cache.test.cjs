const assert = require('node:assert/strict');
const test = require('node:test');
const { PdfSessionCache } = require('../pdf-session-cache');

test('PDF session cache returns entries without copying and clears them on demand', () => {
  const cache = new PdfSessionCache({ maxBytes: 1024, maxEntryBytes: 1024 });
  const pdf = Buffer.from('%PDF-1.7 test');
  assert.equal(cache.set('document-a', pdf), true);
  assert.strictEqual(cache.get('document-a'), pdf);
  cache.clear();
  assert.equal(cache.get('document-a'), null);
});

test('PDF session cache evicts least recently used entries when capacity is reached', () => {
  const cache = new PdfSessionCache({ maxBytes: 10, maxEntryBytes: 10 });
  cache.set('a', Buffer.from('aaaaa'));
  cache.set('b', Buffer.from('bbbbb'));
  cache.get('a');
  cache.set('c', Buffer.from('ccccc'));
  assert.ok(cache.get('a'));
  assert.equal(cache.get('b'), null);
  assert.ok(cache.get('c'));
});
