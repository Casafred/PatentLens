const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestPool, fetchBuffer, GdTransport, GdOriginalDocuments } = require('../dossier-network.cjs');

test('request coordination includes fallback work, evicts cache and releases failures', async () => {
  const pool = new RequestPool({ maxEntries: 2, maxBytes: 10 });
  let count = 0, release;
  const operation = () => { count++; return new Promise(resolve => { release = resolve; }); };
  const a = pool.run('same', operation), b = pool.run('same', operation);
  await Promise.resolve(); assert.equal(count, 1); release('ok');
  assert.deepEqual(await Promise.all([a, b]), ['ok', 'ok']);
  await assert.rejects(pool.run('same', () => { throw new Error('failed'); }));
  assert.equal(await pool.run('same', () => 'retry'), 'retry');
  pool.set('a', Buffer.from('1234'), 'gd'); pool.set('b', Buffer.from('1234'), 'epo');
  pool.get('a'); pool.set('c', Buffer.from('1234'), 'gd');
  assert.equal(pool.get('b'), null); assert.equal(pool.get('a').source, 'gd');
  pool.cache.get('a').timestamp -= pool.ttl; assert.equal(pool.get('a'), null);
});

test('network deadline covers body reads even when headers arrived immediately', async () => {
  let signal;
  const request = fetchBuffer(async (_, init) => {
    signal = init.signal;
    return { status: 200, headers: new Map(), arrayBuffer: () => new Promise(() => {}) };
  }, 'https://example.test/pdf', {}, 30);
  await assert.rejects(request, /timeout/); assert.equal(signal.aborted, true);
});

test('buffer fetch preserves HTTP errors, headers and bytes for routing', async () => {
  const response = await fetchBuffer(async () => ({ status: 403, headers: new Map([['x-test', 'challenge']]), arrayBuffer: async () => Buffer.from('verification') }), 'https://example.test', {}, 1000);
  assert.equal(response.statusCode, 403); assert.equal(response.headers['x-test'], 'challenge');
  assert.equal(response.body.toString(), 'verification');
});

const reply = (status = 200, value = 'dossier') => ({ status, headers: new Map(), arrayBuffer: async () => Buffer.from(value) });
function transportSetup({ proxy = 'PROXY 127.0.0.1:7897', systemFetch, directFetch, now = Date.now, ...options } = {}) {
  const calls = [];
  const transport = new GdTransport({
    systemSession: () => ({ resolveProxy: async () => proxy, fetch: async (...args) => { calls.push('system'); return systemFetch ? systemFetch(...args) : reply(); } }),
    directSession: async () => ({ fetch: async (...args) => { calls.push('direct'); return directFetch ? directFetch(...args) : reply(); } }),
    now, ...options,
  });
  return { transport, calls, request: (timeout = 1000) => transport.request('https://gd.example/family', { headers: { 'x-authorization-token': 'Bearer fixture' } }, timeout) };
}

test('broken system proxy recovers via direct and subsequent requests reuse the working route', async () => {
  let clock = 100;
  const { transport, calls, request } = transportSetup({ now: () => clock, routeTtl: 500, systemFetch: async () => { throw new Error('net::ERR_FAILED'); } });
  assert.equal((await request()).networkRoute, 'direct');
  assert.equal((await request()).networkRoute, 'direct');
  assert.deepEqual(calls, ['system', 'direct', 'direct']);
  assert.equal(transport.diagnostics().preferredRoute, 'direct');
  clock += 501;
  assert.equal(transport.diagnostics().preferredRoute, 'system');
  await request();
  assert.deepEqual(calls.slice(-2), ['system', 'direct']);
});

test('stalled proxy headers abort before fallback; healthy slow body keeps the full deadline', async () => {
  let signal;
  const stalled = transportSetup({ headersTimeout: 15, systemFetch: async (_, init) => { signal = init.signal; return new Promise(() => {}); } });
  assert.equal((await stalled.request(2000)).networkRoute, 'direct');
  assert.equal(signal.aborted, true);
  const body = transportSetup({ headersTimeout: 5, systemFetch: async () => ({ ...reply(), arrayBuffer: () => new Promise(resolve => setTimeout(() => resolve(Buffer.from('complete PDF')), 30)) }) });
  assert.equal((await body.request()).body.toString(), 'complete PDF');
  assert.deepEqual(body.calls, ['system']);
});

test('HTTP errors and TLS certificate errors do not trigger route bypass', async () => {
  for (const status of [401, 403, 429, 503]) {
    const fixture = transportSetup({ systemFetch: async () => reply(status) });
    assert.equal((await fixture.request()).statusCode, status);
    assert.deepEqual(fixture.calls, ['system']);
  }
  const fixture = transportSetup({ systemFetch: async () => { throw new Error('net::ERR_CERT_AUTHORITY_INVALID'); } });
  await assert.rejects(fixture.request(), /ERR_CERT/);
  assert.deepEqual(fixture.calls, ['system']);
});

test('preferred direct route keeps enough time for upstream PDF generation', async () => {
  let requests = 0;
  const fixture = transportSetup({ headersTimeout: 5,
    systemFetch: async () => { throw new Error('net::ERR_CONNECTION_CLOSED'); },
    directFetch: async () => { if (++requests > 1) await new Promise(resolve => setTimeout(resolve, 30)); return reply(); },
  });
  await fixture.request(2000);
  assert.equal((await fixture.request()).networkRoute, 'direct');
  assert.deepEqual(fixture.calls, ['system', 'direct', 'direct']);
});

test('direct system connections do not repeat the same request on a second session', async () => {
  const fixture = transportSetup({ proxy: 'DIRECT', systemFetch: async () => { throw new Error('net::ERR_CONNECTION_RESET'); } });
  await assert.rejects(fixture.request(), /ERR_CONNECTION_RESET/);
  assert.deepEqual(fixture.calls, ['system']);
});

test('failed preferred direct route returns to the system route without extending budget or changing auth', async () => {
  let clock = 100, directFails = false;
  const fixture = transportSetup({ now: () => clock,
    systemFetch: async (_, init) => { assert.equal(init.headers['x-authorization-token'], 'Bearer fixture'); if (!directFails) throw new Error('net::ERR_PROXY_CONNECTION_FAILED'); return reply(); },
    directFetch: async () => { if (directFails) throw new Error('net::ERR_CONNECTION_RESET'); return reply(); },
  });
  await fixture.request(); directFails = true;
  assert.equal((await fixture.request()).networkRoute, 'system');
  assert.equal(fixture.transport.diagnostics().preferredRoute, 'system');
  const exhausted = transportSetup({ now: () => clock, systemFetch: async () => { clock += 1000; throw new Error('net::ERR_CONNECTION_CLOSED'); } });
  await assert.rejects(exhausted.request(), /ERR_CONNECTION_CLOSED/);
  assert.deepEqual(exhausted.calls, ['system']);
});

test('official original PDF metadata retains US/EP URL conventions, expires and stays bounded', () => {
  let clock = 100;
  const index = new GdOriginalDocuments({ now: () => clock, ttl: 20, maxEntries: 4 });
  const doc = { docId: 'ID/1', mimeTypeData: [{ mimeType: 'application/pdf', fileNames: ['Claims 说明.pdf'] }] };
  index.remember('US', '16976733', { docNumber: '201916976733.A', docs: [doc] });
  assert.equal(index.get('US', '16976733', 'ID/1'), '/doc-content/downloadFile/16976733/ID%2F1/Claims%20%E8%AF%B4%E6%98%8E.pdf');
  index.remember('EP', '19703079', { docNumber: '19703079.A', docs: [doc] });
  assert.match(index.get('EP', '19703079.A', 'ID/1'), /^\/doc-content\/downloadFile\/EP\/19703079.A\//);
  assert.equal(index.docListPath('EP', '19703079.A'), '/doc-list/svc/doclist/EP/19703079/A');
  assert.equal(index.hasList('EP', '19703079.A'), true);
  index.remember('CN', '123', { docs: [doc] }); assert.ok(index.entries.size <= 4);
  clock += 21;
  assert.equal(index.get('CN', '123', 'ID/1'), null);
  assert.equal(index.hasList('EP', '19703079.A'), false);
  index.clear(); assert.equal(index.lists.size, 0);
});

test('original metadata skips paths, ambiguous PDFs, other formats, and invalidates changed documents', () => {
  const index = new GdOriginalDocuments();
  const data = files => ({ docs: [{ docId: 'D1', mimeTypeData: [{ mimeType: 'pdf', fileNames: files }] }] });
  index.remember('US', '16976733', data(['native.pdf']));
  assert.ok(index.get('US', '16976733', 'D1'));
  for (const files of [['../external.pdf'], ['C:\\file.pdf'], ['a.pdf', 'b.pdf'], ['xml.xml'], ['bad\nfile.pdf']]) {
    index.remember('US', '16976733', data(files));
    assert.equal(index.get('US', '16976733', 'D1'), null);
  }
  index.remember('US', '16976733', { docs: [null, { docId: 'D2', mimeTypeData: [null] }] });
  assert.equal(index.get('US', '16976733', 'D2'), null);
});
