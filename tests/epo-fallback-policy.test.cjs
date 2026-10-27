const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isEpoCloudflareTitle,
  isEpoCloudflareBody,
  classifyEpoPage,
  isUsableEpoDossierCacheUrl,
} = require('../epo-fallback-policy');

test('detects Cloudflare waiting pages by title and body separately', () => {
  assert.equal(isEpoCloudflareTitle('Just a moment...'), true);
  assert.equal(isEpoCloudflareTitle('EPO Register - Bibliographic data'), false);
  assert.equal(isEpoCloudflareBody('<title>Just a moment...</title><div>Ray ID: abc</div><p>Cloudflare</p>'), true);
  assert.equal(isEpoCloudflareBody('<p>Documents are being retrieved</p>'), false);
});

test('classifies retrieving and empty dossier pages before checking doc links', () => {
  const retrieving = classifyEpoPage({
    html: '<h1>Documents</h1><p>Dossier documents are being retrieved</p>',
    flags: { hasDocLinks: true, hasDocList: true },
  });
  assert.equal(retrieving, 'retrieving');

  const empty = classifyEpoPage({ html: '<p>No files were found for this application</p>' });
  assert.equal(empty, 'empty');

  const ready = classifyEpoPage({ html: '<table class="docListTable"></table>', flags: { hasDocLinks: true } });
  assert.equal(ready, 'ready');

  const waiting = classifyEpoPage({ html: '<html><body>Loading application shell</body></html>' });
  assert.equal(waiting, 'waiting');
});

test('classifies Cloudflare before all other page markers', () => {
  assert.equal(classifyEpoPage({ title: 'Just a moment...', html: '<p>No files were found</p>' }), 'cloudflare');
});

test('accepts only real EPO Register dossier entry URLs for caching', () => {
  assert.equal(isUsableEpoDossierCacheUrl('https://register.epo.org/ipfwretrieve?apn=US.202519389359.A&lng=en'), true);
  assert.equal(isUsableEpoDossierCacheUrl('https://register.epo.org/application?number=EP19703079&lng=en&tab=doclist'), true);

  assert.equal(isUsableEpoDossierCacheUrl('https://worldwide.espacenet.com/patent/search?q=EP3762180'), false);
  assert.equal(isUsableEpoDossierCacheUrl('https://register.epo.org/espacenet/regviewer?PN=EP3762180'), false);
  assert.equal(isUsableEpoDossierCacheUrl('https://register.epo.org/documentView?number=EP1&documentId=x'), false);
  assert.equal(isUsableEpoDossierCacheUrl('https://register.epo.org/'), false);
  assert.equal(isUsableEpoDossierCacheUrl('not a url'), false);
});
