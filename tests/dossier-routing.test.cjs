const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateHeaderValue } = require('node:http');
const { RequestPool, GdOriginalDocuments } = require('../dossier-network.cjs');
const source = fs.readFileSync(require.resolve('../electron-main.js'), 'utf8');
const slice = source.slice(source.indexOf('async function proxyGdApi('), source.indexOf('function httpsGetWithRedirect('));
function setup() {
  const pool = new RequestPool(), pdf = new Map(); let gdCalls = 0, epoCalls = 0;
  const context = {
    Buffer, Date, URLSearchParams, console: { log() {}, warn() {} },
    GD_API_BASE: 'https://gd.example', GD_SITE_URL: 'https://gd.example', EPO_REGISTER_BASE: 'https://register.epo.org', EPO_OFFICES: new Set(['EP', 'US']),
    _gdRequests: pool, _gdUnavailableUntil: 0, _gdFailedTokenStamp: 0, _gdTokenCache: { obtainedAt: 0 },
    _gdOriginalDocuments: new GdOriginalDocuments(),
    getCachedGdJson: key => pool.get(key), cacheGdJson: (key, body, src) => pool.set(key, body, src),
    getSessionPdf: key => pdf.get(key), cacheSessionPdf: (key, body) => pdf.set(key, body),
    getCachedEpoPdf: () => null, getCachedEpoPdfByEpoDocId: () => null,
    _gdTokenAgeMs: () => 99999, normalizeGdFamilyData() {}, notifyDataSourceIssue() {},
    httpsGet: async () => { gdCalls++; throw new Error('GD login required'); },
    epoFetchDocListViaBrowser: async () => { epoCalls++; await new Promise(r => setTimeout(r, 5)); return { docs: [{ docId: 'D1' }], totalDocs: 1 }; },
  };
  vm.createContext(context);
  const cacheStart = source.indexOf('function cacheGdJson(');
  vm.runInContext(source.slice(cacheStart, source.indexOf('\n}', cacheStart) + 2), context);
  vm.runInContext(slice, context);
  async function request(url) {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; for (const [k, v] of Object.entries(headers)) validateHeaderValue(k, v); }, end(body) { this.body = body; } };
    await context.proxyGdApi(url, response); return response;
  }
  return { context, request, pdf, counts: () => ({ gdCalls, epoCalls }) };
}
test('default GD failure asks the user instead of auto-EPO; explicit epoFallback is shared and cached', async () => {
  const { request, counts } = setup();
  const family = await request('/patent-family/svc/family/application/EP/19703079');
  assert.equal(family.status, 502);
  const body = JSON.parse(family.body);
  assert.equal(body.gdFailed, true);
  assert.equal(body.epoAvailable, true);
  assert.deepEqual(counts(), { gdCalls: 1, epoCalls: 0 });
  const url = '/doc-list/svc/doclist/EP/19703079/A?epoFallback=1';
  const [a, b] = await Promise.all([request(url), request(url)]);
  assert.equal(a.status, 200); assert.deepEqual(a.body, b.body);
  assert.deepEqual(counts(), { gdCalls: 1, epoCalls: 1 });
  const cached = await request(url);
  assert.equal(cached.headers['X-PatentLens-Cache'], 'HIT');
  assert.equal(cached.headers['X-PatentLens-Source'], 'epo');
  assert.deepEqual(counts(), { gdCalls: 1, epoCalls: 1 });
});
test('fresh login reopens GD circuit, successful PDF and session cache need no EPO', async () => {
  const { context, request } = setup();
  await request('/patent-family/svc/family/application/EP/19703079');
  context._gdTokenCache.obtainedAt = Date.now();
  let calls = 0;
  context.httpsGet = async url => { calls++; return { statusCode: 200, body: Buffer.from(url.includes('/doc-list/') ? '{"docs":[]}' : '%PDF-' + 'x'.repeat(120)) }; };
  const url = '/doc-content/svc/doccontent/EP/19703079/D1/1/PDF';
  const first = await request(url); const second = await request(url);
  assert.equal(first.headers['X-PatentLens-Source'], 'gd');
  assert.equal(first.headers['Content-Type'], 'application/pdf');
  assert.equal(second.headers['X-PatentLens-Cache'], 'HIT'); assert.equal(calls, 2);
});

test('real doclist original PDF is used by the existing reader and Agent URL, with viewer fallback', async () => {
  const { context, request } = setup();
  const calls = [];
  let missingOriginal = false;
  context.httpsGet = async url => {
    calls.push(url);
    if (url.includes('/doc-list/')) return { statusCode: 200, body: Buffer.from(JSON.stringify({ docNumber: '19703079.A', docs: [
      { docId: 'D1', mimeTypeData: [{ mimeType: 'pdf', fileNames: ['native.pdf'] }] },
      { docId: 'D2', mimeTypeData: [{ mimeType: 'pdf', fileNames: ['unavailable.pdf'] }] },
    ] })) };
    if (missingOriginal && url.includes('/downloadFile/')) return { statusCode: 404, body: Buffer.from('not available') };
    return { statusCode: 200, body: Buffer.from('%PDF-' + (url.includes('/downloadFile/') ? 'native' : 'viewer').repeat(30)) };
  };
  await request('/doc-list/svc/doclist/EP/19703079/A');
  const native = await request('/doc-content/svc/doccontent/EP/19703079.A/D1/1/PDF');
  assert.equal(native.status, 200);
  assert.equal(native.headers['X-PatentLens-Pdf-Variant'], 'original');
  assert.match(native.body.toString(), /native/);
  assert.match(calls[1], /\/downloadFile\/EP\/19703079.A\/D1\/native.pdf$/);
  missingOriginal = true;
  const viewer = await request('/doc-content/svc/doccontent/EP/19703079.A/D2/1/PDF');
  assert.equal(viewer.status, 200); assert.match(viewer.body.toString(), /viewer/);
  assert.match(calls.at(-1), /\/svc\/doccontent\//);
});

test('PDF from a restored renderer discovers original metadata once within the same PDF budget', async () => {
  const { context, request } = setup();
  const calls = [];
  context.httpsGet = async (url, _headers, timeout) => {
    calls.push({ url, timeout });
    if (url.includes('/doc-list/')) return { statusCode: 200, body: Buffer.from(JSON.stringify({ docNumber: '201916976733.A', docs: [{ docId: 'D1', mimeTypeData: [{ mimeType: 'pdf', fileNames: ['native.pdf'] }] }] })) };
    return { statusCode: 200, body: Buffer.from('%PDF-' + 'native'.repeat(30)) };
  };
  const result = await request('/doc-content/svc/doccontent/US/16976733/D1/3/PDF');
  assert.equal(result.headers['X-PatentLens-Pdf-Variant'], 'original');
  assert.match(calls[0].url, /doclist\/US\/16976733\/A$/);
  assert.ok(calls[0].timeout <= 10000);
  assert.match(calls[1].url, /downloadFile\/16976733\/D1\/native.pdf$/);
  assert.ok(calls[1].timeout <= 60000);
  await request('/doc-content/svc/doccontent/US/16976733/D1/3/PDF');
  assert.equal(calls.length, 2);
});
test('EPO direct mode never acquires GD token or downloads via GD', async () => {
  const { request, counts } = setup();
  const response = await request('/doc-list/svc/doclist/EP/19703079/A?epoDirect=1');
  assert.equal(response.status, 200); assert.deepEqual(counts(), { gdCalls: 0, epoCalls: 1 });
});

test('pdfVariant=viewer skips the raw attachment so the GD viewer rendition can supply text', async () => {
  const { context, request } = setup();
  const calls = [];
  context.httpsGet = async (url) => {
    calls.push(url);
    if (url.includes('/doc-list/')) {
      return { statusCode: 200, body: Buffer.from(JSON.stringify({ docNumber: '16976733.A', docs: [
        { docId: 'D1', mimeTypeData: [{ mimeType: 'pdf', fileNames: ['native.pdf'] }] },
      ] })) };
    }
    return { statusCode: 200, body: Buffer.from('%PDF-' + 'viewer'.repeat(30)) };
  };
  await request('/doc-list/svc/doclist/US/16976733/A');
  const viewer = await request('/doc-content/svc/doccontent/US/16976733/D1/3/PDF?pdfVariant=viewer');
  assert.equal(viewer.status, 200);
  assert.equal(viewer.headers['X-PatentLens-Pdf-Variant'], 'viewer');
  assert.equal(calls.some(url => url.includes('/downloadFile/')), false);
});

test('fresh login bypasses a pending user-approved EPO request and late EPO data cannot replace successful GD cache', { timeout: 3000 }, async () => {
  const { context, request } = setup();
  let releaseEpo, epoStarted;
  const enteredEpo = new Promise(resolve => { epoStarted = resolve; });
  context.epoFetchDocListViaBrowser = async () => {
    epoStarted();
    await new Promise(resolve => { releaseEpo = resolve; });
    return { docs: [{ docId: 'old-epo' }], totalDocs: 1 };
  };
  const url = '/doc-list/svc/doclist/EP/19703079/A';
  const old = request(url + '?epoFallback=1');
  await enteredEpo;
  context._gdTokenCache.obtainedAt = Date.now();
  context.httpsGet = async () => ({ statusCode: 200, body: Buffer.from('{"docs":[{"docId":"fresh-gd"}]}') });
  try {
    const fresh = await request(url);
    assert.equal(fresh.headers['X-PatentLens-Source'], 'gd');
    assert.match(fresh.body.toString(), /fresh-gd/);
  } finally { releaseEpo(); }
  await old;
  const cached = await request(url);
  assert.equal(cached.headers['X-PatentLens-Source'], 'gd');
  assert.equal(cached.headers['X-PatentLens-Cache'], 'HIT');
  assert.match(cached.body.toString(), /fresh-gd/);
});

test('resolved EP applications go straight to Register while publication numbers retain resolution', () => {
  const start = source.indexOf('function epoBuildDocListUrl('), end = source.indexOf('function epoBuildPdfUrl(', start);
  const context = vm.createContext({ EPO_REGISTER_BASE: 'https://register.epo.org' }); vm.runInContext(source.slice(start, end), context);
  const direct = context.epoBuildDocListUrl('EP', '19703079', 'A');
  assert.equal(direct.viaEspacenet, false); assert.match(direct.url, /application\?number=EP19703079/);
  assert.equal(context.epoBuildDocListUrl('EP', '3762180', 'A').viaEspacenet, true);
  assert.equal(context.epoBuildDocListUrl('US', '12304032', 'A').viaEspacenet, true);
});
