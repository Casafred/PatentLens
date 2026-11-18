const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 128 * 1024 * 1024;
const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();
function zipCrc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = zipCrcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildStoredZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = String(entry.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.includes("..") || name.includes("//")) throw new Error("invalid bundle entry name");
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const crc = zipCrc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28); nameBuf.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46); centrals.push(central);
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(centralOffset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralData, end]);
}

function createBundle(root, payload) {
  if (!payload || !/^TK-[A-Za-z0-9-]{1,90}$/.test(payload.ticketId || '')) throw new Error('invalid ticket');
  const safeName = value => {
    if (typeof value !== 'string' || !value || value.length > 160 || /[\\/:*?"<>|\x00-\x1f]/.test(value) || /[. ]$/.test(value) || value === '..') throw new Error('invalid file name');
    return value;
  };
  const texts = payload.textFiles || [], files = payload.fileEntries || [];
  if (!Array.isArray(texts) || !Array.isArray(files) || texts.length > 12 || files.length > 150) throw new Error('too many attachments');
  const entries = [], names = new Set();
  let bytes = 0;
  function reserve(name, size) {
    safeName(name);
    if (names.has(name.toLowerCase())) throw new Error('duplicate attachment: ' + name);
    names.add(name.toLowerCase()); bytes += size;
    if (bytes > MAX_BYTES) throw new Error('上下文包超过 128 MB，请减少附件');
  }
  for (const item of texts) {
    if (typeof item.content !== 'string' || Buffer.byteLength(item.content) > 16 * 1024 * 1024) throw new Error('text attachment too large');
    reserve(item.fileName, Buffer.byteLength(item.content));
    entries.push({ name: item.fileName, data: Buffer.from(item.content) });
  }
  const rootPath = fs.realpathSync(root);
  const pending = [];
  for (const item of files) {
    const real = fs.realpathSync(item.filePath);
    const relative = path.relative(rootPath, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('attachment outside handoff directory');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) throw new Error('invalid or oversized attachment');
    const name = safeName(item.archiveName || path.basename(real));
    reserve(name, stat.size); pending.push({ name, file: real });
  }
  for (const item of pending) entries.push({ name: item.name, data: fs.readFileSync(item.file) });
  if (!entries.length) throw new Error('没有可交接的材料');
  const inventory = entries.map(e => ({ fileName: e.name, size: e.data.length, sha256: crypto.createHash('sha256').update(e.data).digest('hex') }));
  const checksumName = 'checksums.json'; reserve(checksumName, 0);
  entries.push({ name: checksumName, data: Buffer.from(JSON.stringify(inventory, null, 2)) });
  const zip = buildStoredZip(entries);
  if (zip.length > MAX_BYTES) throw new Error('上下文包超过 128 MB');
  const dir = path.join(rootPath, payload.ticketId);
  fs.mkdirSync(dir, { recursive: true });
  // Never follow a pre-existing ticket junction out of the handoff root.
  if (path.relative(rootPath, fs.realpathSync(dir)).startsWith('..')) throw new Error('invalid ticket directory');
  const bundleName = safeName(payload.bundleName || 'PatentLens-Agent-Context.zip');
  if (names.has(bundleName.toLowerCase())) throw new Error('bundle name conflicts with attachment');
  const write = (name, data) => {
    const target = path.join(dir, name);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('invalid output link');
    fs.writeFileSync(target, data); return target;
  };
  const filePaths = entries.map(e => write(e.name, e.data));
  const filePath = write(bundleName, zip);
  return { ok: true, filePath, filePaths, size: zip.length, entries: inventory };
}
module.exports = { createBundle, buildStoredZip };
