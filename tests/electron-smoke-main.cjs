const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

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
        hasIconFunction: typeof icon === 'function',
        iconOutput: typeof icon === 'function' ? icon('search', 'sm', 'smoke-test') : '',
        gdApiBase: typeof GD_API_BASE === 'string' ? GD_API_BASE : null,
        usOfficeName: typeof OFFICE_NAMES === 'object' ? OFFICE_NAMES.US : null,
      })`);
      if (result.readyState !== 'complete') failures.push(`Unexpected readyState: ${result.readyState}`);
      if (!result.hasPatentInput) failures.push('Renderer is missing #patent-input.');
      if (!result.hasElectronBridge) failures.push('preload.js did not expose window.electronAPI.');
      if (!result.hasIconFunction) failures.push('Extracted icon() binding is unavailable to web-app.js.');
      if (!/class="svg-icon-sm smoke-test"/.test(result.iconOutput)) failures.push('Extracted icon() returned unexpected markup.');
      if (result.gdApiBase !== '/api/gd') failures.push('Extracted GD_API_BASE is unavailable or changed.');
      if (result.usOfficeName !== '美国 (USPTO)') failures.push('Extracted OFFICE_NAMES is unavailable or changed.');
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
