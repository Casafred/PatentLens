// Bounded, session-local request coordination. Errors are never cached.
class RequestPool {
  constructor({ ttl = 480000, maxEntries = 100, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.ttl = ttl; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    this.cache = new Map(); this.pending = new Map();
  }
  get(key) {
    const value = this.cache.get(key);
    if (!value) return null;
    if (Date.now() - value.timestamp >= this.ttl) { this.cache.delete(key); return null; }
    this.cache.delete(key); this.cache.set(key, value);
    return value;
  }
  set(key, body, source) {
    if (!key || !body || body.length > Math.min(this.maxBytes, 8 * 1024 * 1024)) return;
    this.cache.delete(key);
    this.cache.set(key, { body, source, timestamp: Date.now() });
    let bytes = [...this.cache.values()].reduce((n, v) => n + v.body.length, 0);
    while (this.cache.size > this.maxEntries || bytes > this.maxBytes) {
      const oldest = this.cache.keys().next().value;
      bytes -= this.cache.get(oldest).body.length; this.cache.delete(oldest);
    }
  }
  run(key, operation) {
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = Promise.resolve().then(operation).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    });
    this.pending.set(key, pending); return pending;
  }
}

// Keep the deadline active while consuming the body, including viewer HTML.
async function fetchBuffer(fetchFn, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Request timeout')); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchFn(url, { ...init, signal: controller.signal });
      const body = Buffer.from(await response.arrayBuffer());
      const headers = {}; response.headers.forEach((v, k) => { headers[k] = v; });
      return { statusCode: response.status, headers, body };
    })()]);
  } finally { clearTimeout(timer); }
}
module.exports = { RequestPool, fetchBuffer };
