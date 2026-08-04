const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');
const failures = [];
let server;

app.disableHardwareAcceleration();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function safeStaticPath(urlPath) {
  const relative = urlPath === '/' ? 'web.html' : decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const resolved = path.resolve(srcRoot, relative);
  return resolved.startsWith(srcRoot + path.sep) ? resolved : null;
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const file = safeStaticPath(req.url || '/');
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function finish(code) {
  if (server) server.close();
  if (failures.length) console.error(failures.join('\n'));
  app.exit(code);
}

app.whenReady().then(async () => {
  // The smoke harness is intentionally a minimal Electron main process. Register the
  // same narrow RPC contract so preload argument/return-value serialization is covered.
  ipcMain.handle('parse-share-spreadsheet', async (_event, bytes) => {
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellFormula: false, cellHTML: false });
    return { sheets: workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false }),
    })) };
  });
  const port = await startServer();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['https://cdnjs.cloudflare.com/*'] },
    (_details, callback) => callback({ cancel: true }),
  );

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(root, 'preload.js'),
      webviewTag: true,
    },
  });

  const timeout = setTimeout(() => {
    failures.push('Electron smoke test timed out before renderer validation completed.');
    finish(1);
  }, 20000);

  win.webContents.on('render-process-gone', (_event, details) => {
    failures.push(`Renderer process exited unexpectedly: ${details.reason}`);
  });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' && /(?:ReferenceError|SyntaxError|Uncaught|is not defined)/i.test(details.message)) {
      failures.push(`Renderer console error: ${details.message}`);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) failures.push(`Main renderer load failed (${code}): ${description} ${url}`);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`({
        readyState: document.readyState,
        hasPatentInput: Boolean(document.getElementById('patent-input')),
        hasElectronBridge: Boolean(window.electronAPI && window.electronAPI.openExternal),
        hasShareSpreadsheetBridge: Boolean(window.electronAPI && typeof window.electronAPI.parseShareSpreadsheet === 'function'),
        hasIconFunction: typeof icon === 'function',
        iconOutput: typeof icon === 'function' ? icon('search', 'sm', 'smoke-test') : '',
        gdApiBase: typeof GD_API_BASE === 'string' ? GD_API_BASE : null,
        usOfficeName: typeof OFFICE_NAMES === 'object' ? OFFICE_NAMES.US : null,
        dateHelperOutput: typeof parseDocDateToTimestamp === 'function' ? parseDocDateToTimestamp('2024/02/29') : null,
        hasExtensionHandlers: typeof handleExtensionData === 'function' && typeof handleExtensionAnalyze === 'function',
        shareWorkspace: (function () {
          var entry = document.getElementById('share-workspace-entry');
          var section = document.getElementById('share-workspace-section');
          var hasApi = Boolean(window.PatentShareWorkspace && window.PatentShareStore && window.PatentShareSources);
          if (!entry || !section || !hasApi) return { entry: Boolean(entry), section: Boolean(section), hasApi: hasApi };
          window._currentPatentData = {
            patent_number: 'US12030161B2',
            title: 'Smoke test patent',
            abstract: 'Smoke test abstract',
            claims: [{ num: '1', text: 'A smoke test claim', type: 'independent' }],
            data_source: 'Google Patents',
          };
          entry.click();
          var opened = window.PatentShareWorkspace.isOpen() && !section.classList.contains('hidden');
          var result = window.PatentShareStore.addPatent(window.PatentShareSources.currentPatentSnapshot());
          var count = window.PatentShareStore.getSnapshot().patents.length;
          window.PatentShareWorkspace.close();
          return { entry: true, section: true, hasApi: true, opened: opened, addOk: result.ok, count: count, closed: section.classList.contains('hidden') };
        })(),
      })`);
      if (result.readyState !== 'complete') failures.push(`Unexpected readyState: ${result.readyState}`);
      if (!result.hasPatentInput) failures.push('Renderer is missing #patent-input.');
      if (!result.hasElectronBridge) failures.push('preload.js did not expose window.electronAPI.');
      if (!result.hasShareSpreadsheetBridge) failures.push('preload.js did not expose the share spreadsheet parser.');
      if (result.hasShareSpreadsheetBridge) {
        const parsedSheet = await win.webContents.executeJavaScript(`
          window.electronAPI.parseShareSpreadsheet(
            new TextEncoder().encode('Patent Number,Title\\nUS12030161B2,Smoke spreadsheet').buffer
          ).then(function (workbook) {
            return workbook.sheets && workbook.sheets[0] ? workbook.sheets[0].rows : null;
          })
        `);
        if (!parsedSheet || parsedSheet[1]?.[0] !== 'US12030161B2') {
          failures.push('Share spreadsheet parser did not return normalized worksheet rows.');
        }
      }
      if (!result.hasIconFunction) failures.push('Extracted icon() binding is unavailable to web-app.js.');
      if (!/class="svg-icon-sm smoke-test"/.test(result.iconOutput)) failures.push('Extracted icon() returned unexpected markup.');
      if (result.gdApiBase !== '/api/gd') failures.push('Extracted GD_API_BASE is unavailable or changed.');
      if (result.usOfficeName !== '美国 (USPTO)') failures.push('Extracted OFFICE_NAMES is unavailable or changed.');
      if (result.dateHelperOutput !== new Date('2024/02/29').getTime()) failures.push('Extracted parseDocDateToTimestamp is unavailable or changed.');
      if (!result.hasExtensionHandlers) failures.push('Browser-extension handlers are unavailable after extraction.');
      if (!result.shareWorkspace.entry || !result.shareWorkspace.section || !result.shareWorkspace.hasApi) failures.push('Share workspace resources are unavailable after renderer load.');
      if (!result.shareWorkspace.opened || !result.shareWorkspace.addOk || result.shareWorkspace.count !== 1 || !result.shareWorkspace.closed) failures.push(`Share workspace lifecycle failed: ${JSON.stringify(result.shareWorkspace)}`);
    } catch (error) {
      failures.push(`Renderer assertion failed: ${error.stack || error.message}`);
    }
    clearTimeout(timeout);
    win.destroy();
    finish(failures.length ? 1 : 0);
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}).catch((error) => {
  failures.push(error.stack || error.message);
  finish(1);
});
