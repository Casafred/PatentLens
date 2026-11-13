const { createPatent2PicStore } = require('./patent2pic-storage.cjs');
const path = require('node:path');
function registerPatent2PicIPC({ ipcMain, userData, getPort }) {
  const store = createPatent2PicStore(path.join(userData, 'patent2pic'));
  function authorize(event) {
    const frame = event.senderFrame;
    const url = new URL(frame?.url || 'about:blank');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(getPort()) ||
        !['/', '/web.html'].includes(url.pathname) || frame !== event.sender.mainFrame) {
      throw new Error('仅允许 PatentLens 工作台访问成图项目');
    }
  }
  ipcMain.handle('patent2pic-load', event => { authorize(event); return store.load(); });
  ipcMain.handle('patent2pic-save', (event, values) => { authorize(event); return store.save(values); });
  ipcMain.handle('patent2pic-clear', event => { authorize(event); return store.clear(); });
}
module.exports = { registerPatent2PicIPC };
