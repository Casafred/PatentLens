const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestPool, fetchBuffer } = require('../dossier-network.cjs');

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
