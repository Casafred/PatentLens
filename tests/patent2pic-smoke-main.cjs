/* Real Electron + built editor + local mock AI. Never calls an external model. */
const { app, BrowserWindow, session, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { registerPatent2PicIPC } = require('../patent2pic-ipc.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = process.env.P2P_SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'patentlens-p2p-smoke-'));
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', path.join(artifacts, 'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* The smoke intentionally restarts its window. */ });
let server, port, win;
const errors = [], downloads = [], requests = [];
const result = {
  claimType: 'structure',
  nodes: [
    { id: 'n1', originalText: 'housing', chineseText: '壳体', nodeType: 'component', hierarchyLevel: 0, sourceSentence: 'a housing' },
    { id: 'n2', originalText: 'motor', chineseText: '电机', nodeType: 'component', hierarchyLevel: 1, sourceSentence: 'a motor connected to the housing' },
  ],
  edges: [{ id: 'e1', source: 'n2', target: 'n1', originalText: 'connected to', chineseText: '连接于', relationType: 'position' }],
  groups: [], translatedClaim: '一种装置，包括壳体和连接到壳体的电机。',
  sentencePairs: [{ original: 'A device comprising a housing and a motor connected to the housing.', translation: '一种装置，包括壳体和连接到壳体的电机。' }],
};
const patent = { patent_number: 'US12345678B2', title: 'Integration smoke patent', language: 'en', data_source: 'Smoke fixture',
  claims: [{ num: '7', text: 'A device comprising a housing and a motor connected to the housing.', type: 'independent' },
    { num: '19', text: 'A method comprising receiving a signal and driving the motor.', type: 'independent' },
    { num: '20', text: 'The method of claim 19, wherein the signal is digital.', type: 'dependent' },
    { num: '21', text: 'The method of claim 20, wherein the motor stops.', type: 'dependent' }] };

function startServer() {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', bytes => { body += bytes; });
        req.on('end', () => {
          const params = JSON.parse(body); requests.push(params);
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const text = JSON.stringify(result), middle = Math.floor(text.length / 2);
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(0, middle) } }] }) + '\n\n');
          res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(middle) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) + '\n\ndata: [DONE]\n\n');
        });
        return;
      }
      const relative = req.url === '/' ? 'web.html' : decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.resolve(root, 'src', relative);
      if (!file.startsWith(path.join(root, 'src') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
}
function evaluate(code) { return win.webContents.executeJavaScript(code); }
async function until(code, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(code)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + label);
}
function inEditor(code) { return evaluate(`(() => { const w = document.querySelector('#patent2pic-workbench iframe').contentWindow; const d = w.document; ${code} })()`); }
function editorCondition(code) { return `(() => { const f = document.querySelector('#patent2pic-workbench iframe'); if (!f) return false; const d = f.contentDocument; return ${code}; })()`; }
async function openWindow() {
  win = new BrowserWindow({ show: false, width: 1660, height: 1100, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'preload.js'), webviewTag: true } });
  win.webContents.on('console-message', details => {
    if (details.level === 'error' && /ReferenceError|SyntaxError|Uncaught|TypeError|P2P smoke/.test(details.message)) errors.push(details.message);
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await until("!document.getElementById('splash-screen')", 'host splash dismissed');
  await evaluate(`window.addEventListener('error', e => console.error('P2P smoke error: ' + (e.error?.stack || e.message)));`);
  await evaluate(`(() => { const c = AI.loadAIConfig(); c.openai = { type:'openai',apiKey:'local-smoke-only',baseUrl:location.origin,model:'smoke-model' }; c.currentProvider='openai'; AI.saveAIConfig(c); AI.addCustomModel(c,'openai','smoke-model'); AI.saveAIConfig(c); })()`);
}
async function launch(indexes = [0], data = patent) {
  await evaluate(`Patent2PicWorkbench.open(Patent2PicSource.snapshot(${JSON.stringify(data)}, ${JSON.stringify(indexes)}))`);
  await until(editorCondition("!!d.querySelector('.title-bar')"), 'editor ready');
}
async function saveAndFiles() {
  await evaluate('savePatent2PicBeforeClose()');
  return evaluate(`electronAPI.loadPatent2Pic().then(r => Object.entries(r.values).filter(([k]) => /^patent2pic-project-/.test(k)).flatMap(([,v]) => JSON.parse(v).files))`);
}
async function exportFormat(format) {
  const before = downloads.length;
  await inEditor("Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b => b.textContent.trim() === '导出').click();");
  await until(editorCondition(`Array.from(d.querySelectorAll('.el-dropdown-menu__item')).some(e => e.textContent.includes(${JSON.stringify(format)}))`), 'export menu ' + format);
  await inEditor(`Array.from(d.querySelectorAll('.el-dropdown-menu__item')).find(e => e.textContent.includes(${JSON.stringify(format)})).click();`);
  const deadline = Date.now() + 20000;
  while (downloads.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(downloads.length, before + 1, 'download ' + format);
  return downloads.at(-1);
}

app.whenReady().then(async () => {
  registerPatent2PicIPC({ ipcMain, userData: path.join(artifacts, 'persistent-data'), getPort: () => port });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://cdnjs.cloudflare.com/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.on('will-download', (_event, item) => {
    const destination = path.join(artifacts, item.getFilename()); item.setSavePath(destination);
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') downloads.push(destination); else errors.push('Download failed: ' + state);
    });
  });
  await startServer();
  await openWindow();
  for (const width of [1280, 800]) {
    win.setSize(width, 950);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate("document.querySelector('#patent-input').getBoundingClientRect().width > 300 && document.querySelector('#patent-input').getBoundingClientRect().height === document.querySelector('#search-btn').getBoundingClientRect().height"), true, 'balanced input and query at ' + width);
    fs.writeFileSync(path.join(artifacts, 'home-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  win.setSize(1660, 1100);
  await evaluate(`window._currentPatentData = ${JSON.stringify(patent)}; renderPatentDetail(window._currentPatentData);`);
  assert.equal(await evaluate("document.querySelector('#patent2pic-entry').parentElement === document.body && !!document.querySelector('#patent2pic-entry img')"), true, 'logo floating entry outside search');
  assert.equal(await evaluate(`(() => { const root=document.querySelector('#patent-detail-content'); for(let i=0;i<3;i++){root.querySelector('.pd-claim-dependent-count').click();root.querySelector('.pd-claim-collapse-btn').click();root.querySelector('.pd-claim-expand-btn').click();root.querySelector('.pd-claim-expand-btn').click();} return root.querySelector('.pd-claim-dependent-count').textContent.includes('2 项'); })()`), true, 'dependent count survives individual and expand-all toggles');
  await evaluate(`window._patentPopupData=${JSON.stringify(patent)}; document.querySelector('#ppv-content').innerHTML=renderPatentPopupContent(window._patentPopupData);`);
  assert.equal(await evaluate(`(() => { const root=document.querySelector('#ppv-content'); for(let i=0;i<3;i++){root.querySelector('.pd-claim-dependent-count').click();root.querySelector('.pd-claim-collapse-btn').click();} return root.querySelector('.pd-claim-dependent-count').textContent.includes('2 项'); })()`), true, 'popup count survives toggles');
  await until("!!document.querySelector('#patent-detail-content .p2p-open-button')", 'claim action injected');
  await evaluate("document.querySelector('#patent-detail-content .p2p-open-button').click()");
  assert.equal(await evaluate("document.querySelector('dialog.p2p-claim-dialog input:checked').value"), '0');
  await evaluate("document.querySelector('dialog.p2p-claim-dialog .p2p-primary').click()");
  await until(editorCondition("!!d.querySelector('.claim-textarea textarea')"), 'claim imported');
  await until('!document.querySelector("dialog.p2p-claim-dialog")', 'selection dialog closes');
  await inEditor("w.addEventListener('error', e => console.error('P2P smoke iframe: ' + (e.error?.stack || e.message))); w.addEventListener('unhandledrejection', e => console.error('P2P smoke rejection: ' + (e.reason?.stack || e.reason)));");
  await evaluate("Array.from(document.querySelectorAll('.p2p-host-toolbar button')).find(b => b.textContent==='AI 供应商设置').click()");
  assert.equal(await evaluate("!document.querySelector('#ai-settings-modal').classList.contains('hidden') && Number(getComputedStyle(document.querySelector('#ai-settings-modal')).zIndex) > Number(getComputedStyle(document.querySelector('#patent2pic-workbench')).zIndex)"), true, 'host settings opens above editor');
  await evaluate("document.querySelector('#modal-close-btn').click()");
  await inEditor("Array.from(d.querySelectorAll('button')).find(b => b.textContent.trim() === '生成分解图').click();");
  await until(editorCondition("d.querySelectorAll('.x6-node').length === 2"), 'generated graph');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'smoke-model');
  assert.equal(requests[0].response_format.type, 'json_object');
  let files = await saveAndFiles();
  let file = files.find(item => item.versions.length);
  assert.equal(file.claims[0].index, 7);
  assert.equal(file.claims[0].source.publicationNumber, patent.patent_number);
  assert.equal(file.claims[0].source.originalText, patent.claims[0].text);
  assert.ok(file.versions[0].serializedGraph.cells.length >= 3);
  await until("!!document.querySelector('#patent-detail-content [data-claim-index=\"0\"] .p2p-claim-record')", 'inline saved graph badge');
  await until("!!document.querySelector('#ppv-content [data-claim-index=\"0\"] .p2p-claim-record')", 'popup saved graph badge');
  assert.equal(await evaluate('Patent2PicWorkbench.getRecords().length'), 1);
  // Actual left mouse gesture in blank canvas space must pan the graph.
  const pan = await evaluate(`(() => { const f=document.querySelector('#patent2pic-workbench iframe'), r=f.getBoundingClientRect(), c=f.contentDocument.querySelector('.canvas-viewport').getBoundingClientRect(); return {x:Math.round(r.x+c.x+80),y:Math.round(r.y+c.y+40)}; })()`);
  const beforePan = await inEditor("return d.querySelector('.x6-graph-svg-viewport').getAttribute('transform')");
  win.webContents.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, x:pan.x, y:pan.y });
  win.webContents.sendInputEvent({ type:'mouseMove', button:'left', movementX:90, movementY:60, x:pan.x+90, y:pan.y+60 });
  win.webContents.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, x:pan.x+90, y:pan.y+60 });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.notEqual(await inEditor("return d.querySelector('.x6-graph-svg-viewport').getAttribute('transform')"), beforePan, 'left drag pans canvas');
  await inEditor("d.querySelector('.workspace-edge-toggle').click()");
  await until(editorCondition("!!d.querySelector('.workspace-drawer')"), 'persistent left edge opens project manager');
  await inEditor("d.querySelector('.workspace-edge-toggle').click()");
  // Open the pinned review layout, then close its style panel.
  await inEditor("Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b=>b.textContent.trim()==='布局').click()");
  await until(editorCondition("Array.from(d.querySelectorAll('.el-dropdown-menu__item')).some(e=>e.textContent.includes('审阅'))"), 'layout menu');
  await inEditor("Array.from(d.querySelectorAll('.el-dropdown-menu__item')).find(e=>e.textContent.includes('审阅')).click()");
  await until(editorCondition("!!d.querySelector('.style-panel')"), 'pinned style panel');
  await inEditor("d.querySelector('.style-panel .close-btn').click()");
  await until(editorCondition("!d.querySelector('.style-panel')"), 'style panel closes even when pinned');
  await inEditor("Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b=>b.textContent.trim()==='适配').click()");

  // Edit using the actual graph's double-click handler and Vue form.
  await inEditor("d.querySelector('.x6-node[data-cell-id=\"n1\"]').dispatchEvent(new w.MouseEvent('dblclick', { bubbles:true, view:w }));");
  await until(editorCondition("Array.from(d.querySelectorAll('.el-dialog')).some(e => e.textContent.includes('编辑节点'))"), 'node edit dialog');
  await inEditor("const dialog = Array.from(d.querySelectorAll('.el-dialog')).find(e => e.textContent.includes('编辑节点')); const input = dialog.querySelector('input'); input.value='edited housing'; input.dispatchEvent(new w.Event('input', {bubbles:true})); Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim()==='保存').click();");
  files = await saveAndFiles(); file = files.find(item => item.versions.length);
  assert.equal(file.versions[0].serializedGraph.cells.find(cell => cell.id === 'n1').data.originalText, 'edited housing');
  await until(editorCondition("!Array.from(d.querySelectorAll('.el-overlay')).some(e => e.getBoundingClientRect().height && getComputedStyle(e).display!=='none')"), 'edit dialog closed');
  await new Promise(resolve => setTimeout(resolve, 350));
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = await win.webContents.capturePage(); fs.writeFileSync(path.join(artifacts, 'workbench.png'), screenshot.toPNG());
  const png = await exportFormat('PNG');
  assert.ok(nativeImage.createFromPath(png).getSize().width > 100, 'PNG is a real image');
  const svg = await exportFormat('SVG');
  assert.match(fs.readFileSync(svg, 'utf8'), /<svg/);
  assert.match(fs.readFileSync(svg, 'utf8'), /edited\s+housing/);
  const html = await exportFormat('HTML');
  assert.match(fs.readFileSync(html, 'utf8'), /edited housing/);
  const offline = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const offlineErrors = [];
  offline.webContents.on('console-message', details => { if (details.level==='error') offlineErrors.push(details.message); });
  await offline.loadFile(html);
  assert.equal(await offline.webContents.executeJavaScript("document.querySelectorAll('.sentence-block').length > 0 && !!document.querySelector('svg .p2p-node')"), true, 'offline HTML script renders sentences');
  await offline.webContents.executeJavaScript("document.querySelector('[data-cell-id=\"n2\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  assert.equal(await offline.webContents.executeJavaScript("document.querySelectorAll('mark.text-highlight').length > 0"), true, 'offline HTML highlights patent text');
  assert.deepEqual(offlineErrors, []); offline.destroy();
  const beforeProject = downloads.length;
  await inEditor("Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b => b.textContent.trim()==='保存').click();");
  const projectDeadline = Date.now() + 20000;
  while (downloads.length === beforeProject && Date.now() < projectDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(downloads.length, beforeProject + 1, '.p2p download');
  const project = JSON.parse(fs.readFileSync(downloads.at(-1), 'utf8'));
  assert.equal(project.version, '1.2.0');
  assert.ok(project.files.some(item => item.versions[0]?.serializedGraph.cells.some(cell => cell.data?.originalText === 'edited housing')));
  const beforeExcel = downloads.length;
  await inEditor("Array.from(d.querySelectorAll('button')).find(b => b.textContent.trim()==='导出Excel').click();");
  const excelDeadline = Date.now() + 20000;
  while (downloads.length === beforeExcel && Date.now() < excelDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(downloads.length, beforeExcel + 1, 'Excel download');
  assert.ok(XLSX.readFile(downloads.at(-1)).SheetNames.length, 'Excel workbook can be read');

  // Redraw must send the edited graph as input and retain the old version.
  await inEditor("Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b => b.textContent.trim()==='AI 重构').click();");
  await until(editorCondition("!!d.querySelector('.redraw-dialog textarea')"), 'redraw dialog');
  await inEditor("const input=d.querySelector('.redraw-dialog textarea'); input.value='保持全部技术特征，优化布局'; input.dispatchEvent(new w.Event('input',{bubbles:true}));");
  await until(editorCondition("Array.from(d.querySelectorAll('.el-dialog button')).some(b => b.textContent.trim()==='开始重构' && !b.disabled)"), 'redraw enabled');
  await inEditor("Array.from(d.querySelectorAll('.el-dialog button')).find(b => b.textContent.trim()==='开始重构').click();");
  await until(editorCondition("!d.querySelector('.redraw-dialog')"), 'redraw finishes');
  files = await saveAndFiles(); file = files.find(item => item.versions.length === 2);
  assert.ok(file, 'new version appended');
  assert.ok(requests.at(-1).messages.some(message => message.content.includes('edited housing')), 'redraw includes manual edits');
  assert.equal(file.versions[1].sourceVersionId, file.versions[0].id);
  const previousCount = files.length;
  await launch();
  assert.equal((await saveAndFiles()).length, previousCount, 'relaunch resumes existing project');

  // Workspace persistence is independent of local HTTP port and renderer lifetime.
  await evaluate('savePatent2PicBeforeClose()'); win.destroy();
  await new Promise(resolve => server.close(resolve));
  await startServer(); await openWindow(); await launch();
  await until(editorCondition("d.querySelectorAll('.x6-node').length === 2"), 'restored graph on another port');
  files = await saveAndFiles();
  assert.ok(files.some(item => item.versions.length === 2));
  await launch([0], { ...patent, patent_number: 'US12345678A1' });
  assert.equal((await saveAndFiles()).length, previousCount + 1, 'A1 and B2 remain separate');
  await evaluate(`(() => { const c=AI.loadAIConfig(); c.custom={type:'custom',apiKey:'local-custom-only',baseUrl:location.origin+'/v1',model:'smoke-custom-model',protocol:'openai-chat',reasoningEffort:'off'}; c.currentProvider='custom'; AI.saveAIConfig(c); document.querySelector('#patent2pic-workbench iframe').contentWindow.dispatchEvent(new Event('patent2pic-ai-config-changed')); })()`);
  await launch([0, 1]);
  const beforeParallel = requests.length;
  await inEditor("Array.from(d.querySelectorAll('button')).find(b => b.textContent.trim()==='生成分解图').click();");
  await until(`(() => { const d=document.querySelector('#patent2pic-workbench iframe').contentDocument; return d.querySelectorAll('.x6-node').length === 2; })()`, 'batch graph');
  while (requests.length < beforeParallel + 2) await new Promise(resolve => setTimeout(resolve, 100));
  await until(editorCondition("Array.from(d.querySelectorAll('.el-button')).some(b => b.textContent.includes('并行处理全部') && !b.disabled)"), 'parallel analysis finishes');
  files = await saveAndFiles();
  assert.ok(files.some(item => item.claims.some(claim => claim.index === 19 && claim.source?.sourceClaimNumber === '19') && item.versions.length), 'parallel target retains claim 19');
  assert.equal(requests.at(-1).model, 'smoke-custom-model', 'editor follows host custom provider change');
  assert.equal(requests.at(-1).response_format.type, 'json_object');
  // Exercise the real browser import handler using a File (no native picker).
  const beforeImport = files.length;
  await inEditor(`const original=w.HTMLInputElement.prototype.click; w.HTMLInputElement.prototype.click=function(){ if(this.type!=='file') return original.call(this); w.HTMLInputElement.prototype.click=original; const transfer=new w.DataTransfer(); transfer.items.add(new w.File([${JSON.stringify(JSON.stringify(project))}], 'roundtrip.p2p', {type:'application/json'})); this.files=transfer.files; this.dispatchEvent(new w.Event('change')); }; Array.from(d.querySelectorAll('.canvas-toolbar button')).find(b => b.textContent.trim()==='打开').click();`);
  await until(editorCondition("d.querySelectorAll('.x6-node').length === 2 && d.querySelector('.x6-node[data-cell-id=\"n1\"]').textContent.includes('edited')"), '.p2p graph restored');
  files = await saveAndFiles();
  assert.equal(files.length, beforeImport + project.files.length, 'import creates new project without overwriting');
  const persisted = await evaluate('electronAPI.loadPatent2Pic()');
  assert.ok(!JSON.stringify(persisted).includes('local-custom-only') && !JSON.stringify(persisted).includes('local-smoke-only'), 'workspace never copies provider keys');
  await evaluate('Patent2PicWorkbench.close()');
  await evaluate(`document.querySelector('[data-p2p-history="graphs"]').click()`);
  assert.ok(await evaluate("document.querySelectorAll('#p2p-history-list .p2p-record-card').length > 1"));
  await evaluate(`window._currentPatentData=${JSON.stringify(patent)}; renderPatentDetail(window._currentPatentData); document.querySelector('#history-sidebar').classList.remove('collapsed'); document.querySelector('#patent-detail-section').classList.remove('hidden'); document.querySelector('#app').classList.remove('home-mode'); switchPatentTab('claims');`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  win.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 450));
  fs.writeFileSync(path.join(artifacts, 'history-and-claims.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate('window.__historyTarget=Patent2PicWorkbench.getRecords()[0]; void 0');
  await evaluate("document.querySelector('#p2p-history-list .p2p-record-open').click()");
  await until('Patent2PicWorkbench.isOpen()', 'history deep link opens editor');
  await until(`electronAPI.loadPatent2Pic().then(r => { const meta=JSON.parse(r.values['patent2pic-workspace']); const data=JSON.parse(r.values['patent2pic-project-'+meta.activeProjectId]); return meta.activeProjectId===window.__historyTarget.projectId && data.activeFileId===window.__historyTarget.fileId; })`, 'history link restores target project and file');
  await until(editorCondition("d.querySelectorAll('.x6-node').length === 2"), 'history link restores actual graph');
  await evaluate('Patent2PicWorkbench.close()');
  await evaluate(`window._currentPatentData=${JSON.stringify(patent)}; renderPatentDetail(window._currentPatentData);`);
  await until("!!document.querySelector('#patent-detail-content [data-claim-index=\"0\"] .p2p-claim-record')", 'persisted badge after rerender');
  await evaluate("document.querySelector('#patent-detail-content [data-claim-index=\"0\"] .p2p-claim-record').click()");
  await until('Patent2PicWorkbench.isOpen()', 'inline deep link');
  await until(editorCondition("d.querySelectorAll('.x6-node').length === 2"), 'inline link restores actual graph');
  const beforeClear = await evaluate('Patent2PicWorkbench.getRecords().length');
  await evaluate("document.querySelector('#ai-settings-btn').click(); document.querySelector('[data-settings-tab=\"cache\"]').click();");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  win.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 450));
  fs.writeFileSync(path.join(artifacts, 'cache-manager.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate("window.__removeConfirm=window.confirm; window.confirm=()=>true; document.querySelector('#p2p-cache-list .p2p-record-delete').click(); window.confirm=window.__removeConfirm; void 0");
  await until('Patent2PicWorkbench.getRecords().length === '+ (beforeClear - 1), 'cache UI single-task deletion');
  assert.equal(await evaluate('Patent2PicWorkbench.getRecords().length'), beforeClear-1, 'single task cache removal');
  await launch();
  await evaluate("window.__savedConfirm=window.confirm; window.confirm=()=>false; document.querySelector('#p2p-cache-clear').click(); window.confirm=window.__savedConfirm; void 0");
  assert.ok(await evaluate('Patent2PicWorkbench.getRecords().length > 0'), 'cancel cache clear preserves records');
  await evaluate("window.confirm=()=>true; document.querySelector('#cache-clear-btn').click(); window.confirm=window.__savedConfirm; void 0");
  await until('Patent2PicWorkbench.getRecords().length === 0', 'unified cache clear finishes');
  assert.equal(await evaluate('Patent2PicWorkbench.getRecords().length'), 0);
  await new Promise(resolve => setTimeout(resolve, 6000));
  assert.deepEqual(await evaluate('electronAPI.loadPatent2Pic().then(r=>r.values)'), {}, 'cleared cache is not resurrected by old editor');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ ok: true, aiRequests: requests.length, downloads: downloads.map(file => path.basename(file)), persistedFiles: files.length }, null, 2));
  console.log('Patent2Pic Electron smoke passed: generated, edited, exported, redrawn, resumed across ports and batch processed.');
  console.log('Artifacts: ' + artifacts);
  win.destroy(); server.close(); app.exit(0);
}).catch(async error => {
  console.error(error.stack || error); if (errors.length) console.error(errors);
  if (win && !win.isDestroyed()) { try { console.error(await inEditor("return d.querySelector('.redraw-dialog')?.textContent")); fs.writeFileSync(path.join(artifacts, 'failure.png'), (await win.webContents.capturePage()).toPNG()); } catch {} }
  if (win && !win.isDestroyed()) win.destroy(); if (server) server.close(); app.exit(1);
});
setTimeout(() => { console.error('Patent2Pic smoke timed out'); app.exit(1); }, 120000).unref();
