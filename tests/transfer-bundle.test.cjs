const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBundle } = require('../transfer-bundle.cjs');

test('bundle materializes native drag files, Unicode ZIP and verifiable attachment hashes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bundle-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pdf = path.join(root, 'original.pdf'); fs.writeFileSync(pdf, '%PDF-fixture');
  const result = createBundle(root, { ticketId: 'TK-bundle-test', textFiles: [{ fileName: 'context.md', content: '完整上下文\n末尾证据' }], fileEntries: [{ filePath: pdf, archiveName: '审查意见.pdf' }] });
  assert.equal(result.filePaths.length, 3);
  assert.equal(fs.readFileSync(result.filePaths[0], 'utf8'), '完整上下文\n末尾证据');
  const inventory = JSON.parse(fs.readFileSync(result.filePaths[2], 'utf8'));
  assert.equal(inventory[1].sha256, crypto.createHash('sha256').update('%PDF-fixture').digest('hex'));
  const zip = fs.readFileSync(result.filePath); let offset = 0, names = [];
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const bytes = zip.readUInt32LE(offset + 18), size = zip.readUInt16LE(offset + 26);
    assert.equal(zip.readUInt16LE(offset + 6), 0x800);
    const name = zip.subarray(offset + 30, offset + 30 + size).toString('utf8'); names.push(name);
    assert.deepEqual(zip.subarray(offset + 30 + size, offset + 30 + size + bytes), fs.readFileSync(path.join(path.dirname(result.filePath), name)));
    offset += 30 + size + bytes;
  }
  assert.deepEqual(names, ['context.md', '审查意见.pdf', 'checksums.json']);
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test('bundle rejects missing, external, duplicate and oversized materials before writing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bundle-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = { ticketId: 'TK-negative', textFiles: [{ fileName: 'context.md', content: 'test' }] };
  assert.throws(() => createBundle(root, { ...base, ticketId: '../bad' }), /ticket/);
  assert.throws(() => createBundle(root, { ...base, fileEntries: [{ filePath: __filename }] }), /outside/);
  assert.throws(() => createBundle(root, { ...base, fileEntries: [{ filePath: path.join(root, 'missing.pdf') }] }), /ENOENT/);
  assert.throws(() => createBundle(root, { ...base, textFiles: [...base.textFiles, { fileName: 'CONTEXT.md', content: '' }] }), /duplicate/);
  assert.throws(() => createBundle(root, { ...base, textFiles: [{ fileName: '../context.md', content: '' }] }), /name/);
  assert.throws(() => createBundle(root, { ...base, fileEntries: Array(151).fill({}) }), /many/);
  assert.throws(() => createBundle(root, { ...base, textFiles: [{ fileName: 'context.md', content: 'x'.repeat(16 * 1024 * 1024 + 1) }] }), /large/);
  assert.equal(fs.existsSync(path.join(root, base.ticketId)), false);
});
