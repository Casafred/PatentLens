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
async function fetchBuffer(fetchFn, url, init, timeoutMs, { headersTimeoutMs = 0 } = {}) {
  const controller = new AbortController();
  let timer, headersTimer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Request timeout')); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const headersTimeout = new Promise((_, reject) => {
        if (headersTimeoutMs > 0) headersTimer = setTimeout(() => {
          const error = new Error('Response headers timeout');
          error.transportFailure = true;
          reject(error);
          controller.abort();
        }, headersTimeoutMs);
      });
      const response = await Promise.race([fetchFn(url, { ...init, signal: controller.signal }), headersTimeout]);
      clearTimeout(headersTimer);
      const body = Buffer.from(await response.arrayBuffer());
      const headers = {}; response.headers.forEach((v, k) => { headers[k] = v; });
      return { statusCode: response.status, headers, body };
    })()]);
  } finally { clearTimeout(timer); clearTimeout(headersTimer); }
}

// Only used for the GD API host. Login and other sites keep the system session.
// An unhealthy system proxy must not force every GD request into EPO fallback.
class GdTransport {
  constructor({ systemSession, directSession, now = Date.now, routeTtl = 8 * 60 * 1000, headersTimeout = 4000 }) {
    this.systemSession = systemSession;
    this.directSession = directSession;
    this.now = now;
    this.routeTtl = routeTtl;
    this.headersTimeout = headersTimeout;
    this.directUntil = 0;
    this.lastRoute = null;
    this.lastFailure = null;
    this.systemProxy = null;
  }
  diagnostics() {
    return { preferredRoute: this.directUntil > this.now() ? 'direct' : 'system', lastRoute: this.lastRoute, systemProxy: this.systemProxy, lastFailure: this.lastFailure };
  }
  async request(url, init, timeoutMs) {
    const deadline = this.now() + timeoutMs;
    const system = this.systemSession();
    let timer;
    const proxy = await Promise.race([
      Promise.resolve().then(() => system.resolveProxy(url)).catch(() => ''),
      new Promise(resolve => { timer = setTimeout(() => resolve(''), Math.min(800, timeoutMs)); }),
    ]).finally(() => clearTimeout(timer));
    const hasProxy = /^\s*(?:PROXY|HTTPS?|SOCKS\d?)\s/i.test(proxy);
    this.systemProxy = hasProxy;
    const preferDirect = hasProxy && this.directUntil > this.now();
    const routes = hasProxy ? (preferDirect ? ['direct', 'system'] : ['system', 'direct']) : ['system'];
    let failure;
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index];
      if (deadline <= this.now()) throw failure || new Error('GD request budget exceeded');
      try {
        const ses = route === 'direct' ? await this.directSession() : system;
        const remaining = deadline - this.now();
        if (remaining <= 0) throw new Error('GD request budget exceeded');
        const result = await fetchBuffer(ses.fetch.bind(ses), url, init, remaining, {
          // A proven direct route may legitimately wait for upstream PDF
          // generation. Only limit the initial, unproven system proxy probe.
          headersTimeoutMs: route === 'system' && index + 1 < routes.length ? Math.min(this.headersTimeout, remaining) : 0,
        });
        this.lastRoute = route;
        // HTTP authentication / service errors belong to the existing GD routing.
        // Do not switch networks to retry a 401, 403, 429, or upstream 5xx.
        if (result.statusCode >= 200 && result.statusCode < 300) this.directUntil = route === 'direct' ? this.now() + this.routeTtl : 0;
        return { ...result, networkRoute: route };
      } catch (error) {
        failure = error;
        this.lastFailure = { route, error: String(error.message).slice(0, 120) };
        if (route === 'direct') this.directUntil = 0;
        const transportFailure = error.transportFailure || /net::ERR_(?:CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT|ABORTED|FAILED)|FAILED|TIMED_OUT|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED|NAME_NOT_RESOLVED|NETWORK_CHANGED|INTERNET_DISCONNECTED)(?:\b|$)/i.test(error.message);
        if (!transportFailure || index + 1 === routes.length || deadline - this.now() < 1000) throw error;
      }
    }
    throw failure;
  }
}

// GD's viewer PDF can be rasterized even when a born-digital original exists.
// Keep only official doclist metadata and build API paths, never arbitrary URLs.
class GdOriginalDocuments {
  constructor({ ttl = 8 * 60 * 1000, maxEntries = 5000, now = Date.now } = {}) {
    this.ttl = ttl; this.maxEntries = maxEntries; this.now = now; this.entries = new Map(); this.lists = new Map();
  }
  key(office, number, docId) { return JSON.stringify([String(office).toUpperCase(), String(number), String(docId)]); }
  remember(office, number, data) {
    if (!office || !number || !Array.isArray(data?.docs)) return;
    const country = String(office).toUpperCase();
    const aliases = [...new Set([String(number), data.docNumber].filter(value => typeof value === 'string' && value))];
    for (const alias of aliases) this.lists.set(this.key(country, alias, ''), this.now());
    while (this.lists.size > 1000) this.lists.delete(this.lists.keys().next().value);
    for (const doc of data.docs) {
      if (!doc || typeof doc !== 'object') continue;
      for (const alias of aliases) this.entries.delete(this.key(country, alias, doc.docId));
      const files = (Array.isArray(doc.mimeTypeData) ? doc.mimeTypeData : [])
        .filter(m => m && /^(?:application\/)?pdf$/i.test(m.mimeType || ''))
        .flatMap(m => Array.isArray(m.fileNames) ? m.fileNames : []);
      const file = files.length === 1 && files[0];
      if (!doc.docId || typeof file !== 'string' || file.length > 240 || !/\.pdf$/i.test(file) || /[\\/\x00-\x1f]/.test(file) || file === '..') continue;
      const path = '/doc-content/downloadFile/' + (country === 'US' ? '' : encodeURIComponent(country) + '/') +
        encodeURIComponent(country === 'US' || typeof data.docNumber !== 'string' ? String(number) : data.docNumber) + '/' +
        encodeURIComponent(doc.docId) + '/' + encodeURIComponent(file);
      for (const alias of aliases) {
        const key = this.key(country, alias, doc.docId);
        this.entries.delete(key); this.entries.set(key, { path, at: this.now() });
      }
    }
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
  get(office, number, docId) {
    const key = this.key(office, number, docId), entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.at >= this.ttl) { this.entries.delete(key); return null; }
    return entry.path;
  }
  hasList(office, number) {
    const at = this.lists.get(this.key(office, number, ''));
    return at !== undefined && this.now() - at < this.ttl;
  }
  docListPath(office, number) {
    const match = String(number).match(/^(.*)\.([A-Z]\d?)$/i);
    return '/doc-list/svc/doclist/' + encodeURIComponent(office) + '/' + encodeURIComponent(match ? match[1] : number) + '/' + (match ? match[2] : 'A');
  }
  clear() { this.entries.clear(); this.lists.clear(); }
}
module.exports = { RequestPool, fetchBuffer, GdTransport, GdOriginalDocuments };
