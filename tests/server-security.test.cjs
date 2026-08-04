const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const SERVER_JS = path.resolve(__dirname, '..', 'server.js');
const PORT = 8080;
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER_JS], { stdio: 'pipe' });
    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('Server running')) {
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('Server running')) {
        resolve(proc);
      }
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('Server start timeout')), 10000);
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function rawRequest(rawPath) {
  return new Promise((resolve, reject) => {
    const msg = `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`;
    const client = net.createConnection(PORT, '127.0.0.1', () => {
      client.write(msg);
    });
    let data = '';
    client.on('data', (d) => { data += d; });
    client.on('end', () => {
      const statusLine = data.split('\r\n')[0];
      const match = statusLine.match(/HTTP\/1\.1 (\d+)/);
      resolve({ status: match ? parseInt(match[1], 10) : 0, body: data });
    });
    client.on('error', reject);
  });
}

let serverProc;

test('server rejects path traversal to arbitrary files via raw HTTP', async () => {
  serverProc = await startServer();

  const cases = [
    '/../../package.json',
    '/../../../etc/passwd',
    '/fonts/../../package.json',
  ];

  for (const rawPath of cases) {
    const res = await rawRequest(rawPath);
    assert.equal(res.status, 403, `Expected 403 for ${rawPath}, got ${res.status}`);
  }
});

test('server serves existing files under allowed roots', async () => {
  const res = await rawRequest('/web.html');
  assert.equal(res.status, 200, `Expected 200 for /web.html, got ${res.status}`);
});

test('server blocks non-http(s) schemes in proxyDpmaDownload', async () => {
  const cases = [
    { uri: 'file:///etc/passwd', expect: 400 },
    { uri: 'ftp://example.com/doc.pdf', expect: 400 },
    { uri: 'javascript:alert(1)', expect: 400 },
  ];

  for (const c of cases) {
    const res = await request(`${BASE}/api/de/download?uri=${encodeURIComponent(c.uri)}`);
    assert.equal(res.status, c.expect, `Expected ${c.expect} for uri=${c.uri}, got ${res.status}`);
    assert.ok(res.body.includes('Invalid URI scheme') || res.body.includes('Missing uri parameter'), `Expected error message for uri=${c.uri}`);
  }
});

test('server allows valid http(s) URIs in proxyDpmaDownload', async () => {
  // We cannot actually fetch external URLs in tests, but we should get past the URI scheme check
  // and receive a proxy-related error (e.g., 502 from curl failure) rather than 400.
  const res = await request(`${BASE}/api/de/download?uri=${encodeURIComponent('https://example.com/doc.pdf')}`);
  assert.notEqual(res.status, 400, `Should not be blocked by scheme check for https URI`);
});

test('teardown server', async () => {
  if (serverProc) {
    serverProc.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});
