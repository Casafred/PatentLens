"use strict";

class PdfSessionCache {
  constructor(options) {
    options = options || {};
    this.maxBytes = options.maxBytes || 192 * 1024 * 1024;
    this.maxEntryBytes = options.maxEntryBytes || 64 * 1024 * 1024;
    this.entries = new Map();
    this.totalBytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.buffer;
  }

  set(key, buffer) {
    if (!key || !Buffer.isBuffer(buffer) || buffer.length > this.maxEntryBytes) return false;
    const existing = this.entries.get(key);
    if (existing) this.totalBytes -= existing.buffer.length;
    this.entries.delete(key);
    this.entries.set(key, { buffer });
    this.totalBytes += buffer.length;
    while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest.buffer.length;
    }
    return this.entries.has(key);
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

module.exports = { PdfSessionCache };
