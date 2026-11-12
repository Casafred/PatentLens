const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 32 * 1024 * 1024;

function validateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('无效的成图工作区');
  const clean = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    if (!/^patent2pic-[a-zA-Z0-9_-]+$/.test(key) || key === 'patent2pic-ai-config' || typeof value !== 'string') {
      throw new Error('成图工作区包含不支持的数据');
    }
    clean[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_BYTES) throw new Error('成图工作区超过 32 MB，请导出并整理旧项目');
  return clean;
}
function createPatent2PicStore(directory) {
  const file = path.join(directory, 'workspace.json'), backup = file + '.bak';
  function read(filename) {
    if (fs.statSync(filename).size > MAX_BYTES + 1024) throw new Error('成图工作区文件过大');
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data.version !== 1) throw new Error('不支持的成图工作区版本');
    return validateValues(data.values);
  }
  function load() {
    if (!fs.existsSync(file) && !fs.existsSync(backup)) return { values: {}, recovered: false };
    try { return { values: read(file), recovered: false }; }
    catch (primaryError) {
      try { return { values: read(backup), recovered: true }; }
      catch { throw new Error('成图工作区无法读取。原文件已保留，请从导出的 .p2p 项目恢复。', { cause: primaryError }); }
    }
  }
  function save(values, preserveBackup = true) {
    const clean = validateValues(values);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, `workspace-${crypto.randomUUID()}.tmp`);
    try {
      const descriptor = fs.openSync(temporary, 'wx');
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ version: 1, values: clean }), 'utf8');
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      if (preserveBackup && fs.existsSync(file)) {
        // A corrupt primary must not replace a healthy recovery backup.
        try { read(file); fs.copyFileSync(file, backup); }
        catch (error) { if (!fs.existsSync(backup)) throw error; }
      }
      fs.renameSync(temporary, file);
      return { ok: true };
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function clear() {
    // Persist the empty primary first, then erase the old backup as well.
    save({}, false);
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    return { ok: true };
  }
  return { load, save, clear };
}
module.exports = { createPatent2PicStore, validateValues };
