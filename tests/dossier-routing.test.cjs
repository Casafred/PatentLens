const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateHeaderValue } = require('node:http');
const { RequestPool } = require('../dossier-network.cjs');
const source = fs.readFileSync(require.resolve('../electron-main.js'), 'utf8');
const slice = source.slice(source.indexOf('async function proxyGdApi('), source.indexOf('function httpsGetWithRedirect('));
function setup() {
  const pool = new RequestPool(), pdf = new Map(); let gdCalls = 0, epoCalls = 0;
  const context = {
    Buffer, Date, URLSearchParams, console: { log() {}, warn() {} },
    GD_API_BASE: 'https://gd.example', GD_SITE_URL: 'https://gd.example', EPO_REGISTER_BASE: 'https://register.epo.org', EPO_OFFICES: new Set(['EP', 'US']),
    _gdRequests: pool, _gdUnavailableUntil: 0, _gdFailedTokenStamp: 0, _gdTokenCache: { obtainedAt: 0 },
    getCachedGdJson: key => pool.get(key), cacheGdJson: (key, body, src) => pool.set(key, body, src),
    getSessionPdf: key => pdf.get(key), cacheSessionPdf: (key, body) => pdf.set(key, body),
    getCachedEpoPdf: () => null, getCachedEpoPdfByEpoDocId: () => null,
    _gdTokenAgeMs: () => 99999, normalizeGdFamilyData() {}, notifyDataSourceIssue() {},
    httpsGet: async () => { gdCalls++; throw new Error('GD login required'); },
    epoFetchDocListViaBrowser: async () => { epoCalls++; await new Promise(r => setTimeout(r, 5)); return { docs: [{ docId: 'D1' }], totalDocs: 1 }; },
  };
  vm.createContext(context); vm.runInContext(slice, context);
  async function request(url) {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; for (const [k, v] of Object.entries(headers)) validateHeaderValue(k, v); }, end(body) { this.body = body; } };
    await context.proxyGdApi(url, response); return response;
  }
  return { context, request, pdf, counts: () => ({ gdCalls, epoCalls }) };
}
test('failed GD family skips repeat GD login for doclist; concurrent EPO fallback is shared and cached', async () => {
  const { request, counts } = setup();
  const family = await request('/patent-family/svc/family/application/EP/19703079');
  assert.equal(family.status, 200); assert.equal(family.headers['X-PatentLens-Source'], 'epo');
  const url = '/doc-list/svc/doclist/EP/19703079/A';
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
  context.httpsGet = async () => { calls++; return { statusCode: 200, body: Buffer.from('%PDF-' + 'x'.repeat(120)) }; };
  const url = '/doc-content/svc/doccontent/EP/19703079/D1/1/PDF';
  const first = await request(url); const second = await request(url);
  assert.equal(first.headers['X-PatentLens-Source'], 'gd');
  assert.equal(first.headers['Content-Type'], 'application/pdf');
  assert.equal(second.headers['X-PatentLens-Cache'], 'HIT'); assert.equal(calls, 1);
});
test('EPO direct mode never acquires GD token or downloads via GD', async () => {
  const { request, counts } = setup();
  const response = await request('/doc-list/svc/doclist/EP/19703079/A?epoDirect=1');
  assert.equal(response.status, 200); assert.deepEqual(counts(), { gdCalls: 0, epoCalls: 1 });
});

test('resolved EP applications go straight to Register while publication numbers retain resolution', () => {
  const start = source.indexOf('function epoBuildDocListUrl('), end = source.indexOf('function epoBuildPdfUrl(', start);
  const context = vm.createContext({ EPO_REGISTER_BASE: 'https://register.epo.org' }); vm.runInContext(source.slice(start, end), context);
  const direct = context.epoBuildDocListUrl('EP', '19703079', 'A');
  assert.equal(direct.viaEspacenet, false); assert.match(direct.url, /application\?number=EP19703079/);
  assert.equal(context.epoBuildDocListUrl('EP', '3762180', 'A').viaEspacenet, true);
  assert.equal(context.epoBuildDocListUrl('US', '12304032', 'A').viaEspacenet, true);
});
