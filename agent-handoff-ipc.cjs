function registerAgentHandoffIPC({ ipcMain, clipboard, getPort, userData }) {
  function authorize(event) {
    const frame = event.senderFrame;
    const url = new URL(frame?.url || 'about:blank');
    if (frame !== event.sender.mainFrame || url.origin !== `http://127.0.0.1:${getPort()}` || !['/', '/web.html'].includes(url.pathname)) throw new Error('仅允许 PatentLens 本地工作台访问交接台账');
  }
  const fs = require('node:fs/promises'), path = require('node:path');
  const file = userData && path.join(userData, 'agent-handoff-tasks.json');
  let queue = Promise.resolve();
  function validate(raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 40 * 1024 * 1024 || !Array.isArray(JSON.parse(raw))) throw new Error('交接台账格式无效或超过 40 MB');
    return raw;
  }
  ipcMain.handle('agent-handoff:load', async event => {
    authorize(event); if (!file) throw new Error('交接台账存储未配置');
    await queue;
    try { return validate(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return '[]';
      try { return validate(await fs.readFile(file + '.bak', 'utf8')); }
      catch (_) { throw new Error('交接台账损坏，请保留文件并从备份恢复'); }
    }
  });
  ipcMain.handle('agent-handoff:save', (event, raw) => {
    authorize(event); if (!file) throw new Error('交接台账存储未配置'); validate(raw);
    const write = queue.then(async () => {
      await fs.mkdir(userData, { recursive: true });
      await fs.writeFile(file + '.tmp', raw, 'utf8');
      try { const previous = validate(await fs.readFile(file, 'utf8')); await fs.writeFile(file + '.bak', previous); }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== undefined) throw error; }
      await fs.rename(file + '.tmp', file);
      return { ok: true };
    });
    queue = write.catch(() => {}); return write;
  });
  ipcMain.handle('agent-handoff:copy-text', (event, text) => {
    const frame = event.senderFrame;
    const url = new URL(frame?.url || 'about:blank');
    if (frame !== event.sender.mainFrame || url.origin !== `http://127.0.0.1:${getPort()}` || !['/', '/web.html'].includes(url.pathname)) {
      throw new Error('仅允许 PatentLens 本地工作台复制交接任务');
    }
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) throw new Error('交接任务文本无效或过大');
    clipboard.writeText(text);
    return { ok: true };
  });
}
module.exports = { registerAgentHandoffIPC };
