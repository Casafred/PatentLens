/* Runs the actual production main, embedded server, preload and close handler.
   Set P2P_APP_ROOT to resources/app.asar to exercise packaged contents. */
const { app, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-production-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const failures = [];
let saved = false, failureDialog = false;
dialog.showMessageBoxSync = () => { failureDialog = true; return 1; };
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.on('did-finish-load', async () => {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(win.webContents.getURL())) return;
    try {
      await win.webContents.executeJavaScript(`Patent2PicWorkbench.open(Patent2PicSource.snapshot({patent_number:'US12345678B2',language:'en',claims:[{num:'7',text:'A device comprising a housing.',type:'independent'}]},[0]))`);
      const values = await win.webContents.executeJavaScript('savePatent2PicBeforeClose().then(() => electronAPI.loadPatent2Pic())');
      assert.match(JSON.stringify(values), /US12345678B2/);
      // A rejected renderer flush must retain the window and report failure.
      await win.webContents.executeJavaScript("window.__originalSave=savePatent2PicBeforeClose; void (window.savePatent2PicBeforeClose=async()=>{throw new Error('fixture save failure')})");
      win.close();
      const deadline = Date.now() + 5000;
      while (!failureDialog && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(failureDialog, true);
      assert.equal(win.isDestroyed(), false);
      // A normal close must wait for a final edited-input snapshot.
      await win.webContents.executeJavaScript(`(() => { const w=document.querySelector('#patent2pic-workbench iframe').contentWindow; const input=w.document.querySelector('.claim-textarea textarea'); input.value='7. A device comprising a saved edited housing.'; input.dispatchEvent(new w.Event('input',{bubbles:true})); window.savePatent2PicBeforeClose=window.__originalSave; })()`);
      await win.webContents.executeJavaScript('Promise.resolve()');
      win.once('closed', () => {
        try {
          const contents = fs.readFileSync(path.join(directory, 'patent2pic', 'workspace.json'), 'utf8');
          assert.match(contents, /saved edited housing/);
          saved = true;
          console.log('Production main smoke passed: packaged editor/IPC, failed-save close guard and final close snapshot.');
        } catch (error) { failures.push(error.stack); }
      });
      win.close();
    } catch (error) { failures.push(error.stack); console.error(error.stack); app.exit(1); }
  });
});
app.on('will-quit', () => { if (!saved || failures.length) { console.error(failures); process.exitCode = 1; } });
setTimeout(() => { console.error('Production main smoke timeout', failures); app.exit(1); }, 60000).unref();
require(path.join(process.env.P2P_APP_ROOT || path.resolve(__dirname, '..'), 'electron-main.js'));
