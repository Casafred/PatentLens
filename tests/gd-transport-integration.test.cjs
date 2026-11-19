const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../electron-main.js'), 'utf8');

test('only the GD API uses bearer-only credentials and adaptive transport; login/EPO keep shared cookies', async () => {
  const routes = [], fetches = [];
  const session = { defaultSession: { fetch() {} } };
  const context = vm.createContext({
    session, net: {}, URL,
    GD_API_HOST: 'd1kazzu6rbodne.cloudfront.net',
    _gdTransport: { request: async (url, init, timeout) => { routes.push({ url, init, timeout }); return { statusCode: 200 }; } },
    fetchBuffer: async (_fetch, url, init) => { fetches.push({ url, init }); return { statusCode: 200 }; },
  });
  const isGdStart = source.indexOf('function isGdApiUrl(');
  vm.runInContext(source.slice(isGdStart, source.indexOf('\n}', isGdStart) + 2), context);
  const start = source.indexOf('async function chromiumHttpsGet(');
  vm.runInContext(source.slice(start, source.indexOf('async function _httpsGet(', start)), context);
  await context.chromiumHttpsGet('https://d1kazzu6rbodne.cloudfront.net/doc-list/svc/doclist/EP/19703079/A', { 'x-authorization-token': 'Bearer fixture' }, 35000);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].init.credentials, 'omit');
  assert.equal(routes[0].init.headers['x-authorization-token'], 'Bearer fixture');
  assert.equal(routes[0].timeout, 35000);
  for (const url of ['https://globaldossier.uspto.gov/', 'https://register.epo.org/application?number=EP19703079', 'https://d1kazzu6rbodne.cloudfront.net.other.test/']) {
    await context.chromiumHttpsGet(url, {}, 35000);
  }
  assert.equal(routes.length, 1);
  assert.equal(fetches.length, 3);
  assert.ok(fetches.every(call => call.init.credentials === 'include'));
});
