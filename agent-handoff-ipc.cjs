function registerAgentHandoffIPC({ ipcMain, clipboard, getPort }) {
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
