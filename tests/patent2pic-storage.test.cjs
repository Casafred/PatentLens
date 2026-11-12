const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPatent2PicStore, validateValues } = require('../patent2pic-storage.cjs');
const { registerPatent2PicIPC } = require('../patent2pic-ipc.cjs');
test('workspace survives process recreation and recovers from a corrupt primary', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-p2p-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const values = { 'patent2pic-workspace': '{"projects":[]}', 'patent2pic-project-1': '{"files":[{"versions":[{"serializedGraph":{"cells":[{"id":"n1","position":{"x":250,"y":180}}]}}]}]}' };
  createPatent2PicStore(directory).save(values);
  assert.deepEqual({ ...createPatent2PicStore(directory).load().values }, values);
  createPatent2PicStore(directory).save({ ...values, 'patent2pic-project-2': '{}' });
  fs.writeFileSync(path.join(directory, 'workspace.json'), '{corrupt');
  const recovered = createPatent2PicStore(directory).load();
  assert.equal(recovered.recovered, true);
  assert.deepEqual({ ...recovered.values }, values);
  createPatent2PicStore(directory).save(values);
  assert.equal(createPatent2PicStore(directory).load().recovered, false);
});
test('corrupt workspace is preserved and reported instead of silently replaced', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-p2p-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'workspace.json'), 'broken');
  assert.throws(() => createPatent2PicStore(directory).load(), /无法读取/);
  assert.equal(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8'), 'broken');
});
test('storage rejects credentials, arbitrary keys and invalid payloads', () => {
  for (const value of [null, [], { '../../file': 'data' }, { 'patent2pic-ai-config': 'credentials' }, { 'patent2pic-project-1': {} }]) assert.throws(() => validateValues(value));
});
test('clear removes project data from both primary and recovery backup', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-p2p-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createPatent2PicStore(directory);
  store.save({ 'patent2pic-project-1': 'old graph' }); store.save({ 'patent2pic-project-1': 'new graph' });
  store.clear(); assert.deepEqual({ ...store.load().values }, {});
  assert.equal(fs.existsSync(path.join(directory, 'workspace.json.bak')), false);
  fs.writeFileSync(path.join(directory, 'workspace.json'), 'corrupt');
  store.clear(); assert.deepEqual({ ...store.load().values }, {}, 'explicit clear can reset corrupt storage');
});
test('IPC is restricted to the actual local main frame and port', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-p2p-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = {};
  registerPatent2PicIPC({ ipcMain: { handle: (name, handler) => { handlers[name] = handler; } }, userData: directory, getPort: () => 12345 });
  const frame = { url: 'http://127.0.0.1:12345/' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  assert.deepEqual(handlers['patent2pic-load'](event), { values: {}, recovered: false });
  for (const url of ['https://example.invalid/', 'http://127.0.0.1:12346/', 'http://127.0.0.1:12345/features/patent2pic/index.html']) {
    const other = { url };
    assert.throws(() => handlers['patent2pic-load']({ senderFrame: other, sender: { mainFrame: other } }));
  }
  assert.throws(() => handlers['patent2pic-load']({ senderFrame: frame, sender: { mainFrame: {} } }));
});
