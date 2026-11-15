/* Real Electron/editor, external Agent return fixtures, zero model calls. */
const { app, BrowserWindow, ipcMain, session, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.local-qa', 'agent-handoff');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + Date.now()));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let server, port, win, modelCalls = 0;
const errors = [];
const claimText = 'A device comprising a housing and a motor connected to the housing.';
const patent = { patent_number: 'US12345678B2', title: 'Agent smoke fixture', language: 'en', data_source: 'Smoke fixture', claims: [{ num: '7', text: claimText, type: 'independent' }] };
const payload = { claimType: 'structure', nodes: [
  { id: 'n1', originalText: 'housing', chineseText: '壳体', nodeType: 'component', hierarchyLevel: 0, sourceSentence: 'a housing' },
  { id: 'n2', originalText: 'motor', chineseText: '电机', nodeType: 'component', hierarchyLevel: 1, sourceSentence: 'a motor connected to the housing' }],
  edges: [{ id: 'e1', source: 'n2', target: 'n1', originalText: 'connected to', chineseText: '连接于', relationType: 'position' }], groups: [],
  sentencePairs: [{ original: claimText, translation: '一种装置，包括壳体和连接于壳体的电机。' }] };
function envelope(task, data) { return JSON.stringify({ kind: 'patentlens-agent-result', schemaVersion: 1, taskId: task.taskId, taskType: task.taskType, sourceHash: task.sourceHash, payload: data }); }
function evaluate(code) { return win.webContents.executeJavaScript(code); }
function editor(code) { return evaluate(`(async()=>{const w=document.querySelector('#patent2pic-workbench iframe').contentWindow;const d=w.document;${code}})()`); }
async function until(check, label) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error('Timeout: ' + label);
}
async function startServer() {
  server = http.createServer((req, res) => {
    if (/chat\/completions|responses/.test(req.url)) { modelCalls++; res.writeHead(500); res.end('No API allowed'); return; }
    const file = path.resolve(root, 'src', decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'web.html');
    if (!file.startsWith(path.join(root, 'src') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
}
async function openWindow() {
  win = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'preload.js'), webviewTag: true } });
  win.webContents.on('console-message', details => { if (details.level === 'error' && /ReferenceError|TypeError|SyntaxError|Uncaught/.test(details.message)) errors.push(details.message); });
  await win.loadURL(`http://127.0.0.1:${port}/web.html`);
  await until(() => evaluate("!document.getElementById('splash-screen')"), 'host ready');
}
async function saved() {
  await evaluate('savePatent2PicBeforeClose()');
  return evaluate('electronAPI.loadPatent2Pic()');
}
function files(data) { return Object.entries(data.values).filter(([key]) => /^patent2pic-project-/.test(key)).flatMap(([, value]) => JSON.parse(value).files); }
async function dropGraph(raw) {
  await editor(`const dt=new w.DataTransfer();dt.items.add(new w.File([${JSON.stringify(raw)}],'agent-result.json',{type:'application/json'}));d.querySelector('.canvas-area').dispatchEvent(new w.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));`);
  await until(() => editor("return !!d.querySelector('.agent-task-overlay') && !d.querySelector('[data-action=import]').disabled && !!d.querySelector('.agent-task-status').textContent;"), 'graph drop parsed');
  return editor("return d.querySelector('.agent-task-status').textContent;");
}
async function closePanel() { await editor("d.querySelector('.agent-task-close').click();"); }

app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('Agent smoke timed out'); app.exit(1); }, 150000);
  try {
    require('../patent2pic-ipc.cjs').registerPatent2PicIPC({ ipcMain, userData: path.join(output, 'storage-' + Date.now()), getPort: () => port });
    require('../agent-handoff-ipc.cjs').registerAgentHandoffIPC({ ipcMain, clipboard, getPort: () => port });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, cb) => cb({ cancel: true }));
    await startServer(); await openWindow();
    await evaluate(`Patent2PicWorkbench.open(Patent2PicSource.snapshot(${JSON.stringify(patent)},[0]))`);
    await until(() => editor("return !!d.querySelector('.claim-agent-handoff');").catch(() => false), 'editor ready');
    await editor("d.querySelector('.claim-agent-handoff').click();d.querySelector('[data-action=create]').click();");
    await until(() => editor("return d.querySelector('select#agent-task-select').options.length===1 && !d.querySelector('[data-action=copy]').disabled;"), 'task created');
    await editor("d.querySelector('[data-action=copy]').click();");
    await until(() => editor("return d.querySelector('.agent-task-status').textContent.includes('已复制');"), 'clipboard');
    assert.match(clipboard.readText(), /US12345678B2/);
    assert.match(clipboard.readText(), /sourceClaimNumber/);
    let data = await saved();
    const task = JSON.parse(data.values['patent2pic-agent-tasks'])[0];
    assert.equal(task.input.claim.index, 7);
    await closePanel();
    assert.match(await dropGraph(envelope(task, payload)), /已生成可编辑图/);
    await closePanel();
    data = await saved();
    let file = files(data).find(file => file.id === task.target.fileId);
    assert.equal(file.versions.length, 1);
    assert.equal(file.versions[0].extractResult.nodes.length, 2);
    assert.equal(file.versions[0].extractResult.claimId, task.input.claim.id);
    assert.equal(await editor("return d.querySelectorAll('.x6-node').length;"), 2);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, 'agent-graph.png'), (await win.webContents.capturePage()).toPNG());
    assert.match(await dropGraph(envelope(task, payload)), /已经导入/);
    await closePanel();
    const corrected = JSON.parse(JSON.stringify(payload)); corrected.nodes[1].chineseText = '驱动电机';
    assert.match(await dropGraph(envelope(task, corrected)), /已生成可编辑图/);
    await closePanel();
    data = await saved(); file = files(data).find(file => file.id === task.target.fileId);
    assert.equal(file.versions.length, 2);
    assert.equal(file.versions[0].extractResult.nodes[1].chineseText, '电机');
    assert.equal(file.versions[1].extractResult.nodes[1].chineseText, '驱动电机');
    const invented = JSON.parse(JSON.stringify(payload)); invented.nodes[1].sourceSentence = 'invented feature';
    assert.match(await dropGraph(envelope(task, invented)), /原文/);
    await closePanel();
    // Same disk-backed task ledger and projects must survive a different HTTP origin.
    win.destroy(); await new Promise(resolve => server.close(resolve)); await startServer(); await openWindow();
    await evaluate('Patent2PicWorkbench.open()');
    await until(() => editor("return !!d.querySelector('.claim-agent-handoff');").catch(() => false), 'editor restored');
    data = await saved();
    assert.equal(JSON.parse(data.values['patent2pic-agent-tasks'])[0].taskId, task.taskId);
    assert.equal(files(data).find(file => file.id === task.target.fileId).versions.length, 2);
    await editor("d.querySelector('.claim-agent-handoff').click();");
    assert.equal(await editor("return d.querySelector('#agent-task-select').options.length;"), 1);
    await closePanel();
    await editor(`d.querySelector('.collapsed-info').click();await new Promise(resolve=>w.requestAnimationFrame(resolve));const input=d.querySelector('.claim-textarea textarea');input.value='7. '+${JSON.stringify(claimText)}+' Further comprising a sensor.';input.dispatchEvent(new w.Event('input',{bubbles:true}));`);
    const stale = JSON.parse(JSON.stringify(payload)); stale.nodes[1].chineseText = '另一版电机';
    assert.match(await dropGraph(envelope(task, stale)), /已经修改或重新分析/);
    await closePanel();
    await evaluate('Patent2PicWorkbench.close()');

    // Family return through the real panel and drag target; no API configuration.
    await evaluate(`document.querySelector('.search-mode-btn[data-mode=comparison]').click();ComparisonCore.clearItems();ComparisonCore.addItem({id:'a',label:'CN 权1',originalText:'一种装置，包括处理器。'});ComparisonCore.addItem({id:'b',label:'US claim1',originalText:'An apparatus comprising a processor.'});ComparisonCore.setActiveTab('anchor');ComparisonUI.render();ComparisonHandoff.open();document.querySelector('[data-action=create]').click();`);
    await until(() => evaluate("document.querySelector('#agent-task-select').options.length===1 && !document.querySelector('[data-action=copy]').disabled"), 'family task');
    const familyTask = await evaluate('ComparisonHandoff.getStore().list()[0]');
    const familyPayload = { report: '# 同族分析\n两条权项均涉及处理器。', familyScope: { version: 1, features: [{ id: 'F1', label: '处理器', definition: '处理组件', aliases: ['processor'] }], claims: [
      { itemId: 'a', combination: 'F1', cells: [{ featureId: 'F1', status: 'present', confidence: .9, evidence: [{ sourceId: 'a', quote: '处理器' }] }] },
      { itemId: 'b', combination: 'F1', cells: [{ featureId: 'F1', status: 'translation', confidence: .9, evidence: [{ sourceId: 'b', quote: 'a processor', translation: '处理器' }] }] }] } };
    await evaluate(`document.querySelector('.agent-task-close').click();const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(envelope(familyTask, familyPayload))}],'family.json'));document.querySelector('#comparison-section').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));`);
    await until(() => evaluate("document.querySelector('.agent-task-status')?.textContent.includes('已生成统一特征树')"), 'family imported');
    await evaluate("document.querySelector('.agent-task-close').click();");
    assert.equal(await evaluate("document.querySelectorAll('.family-scope-table tbody tr').length"), 1);
    assert.equal(await evaluate('ComparisonCore.history.getAll().length'), 1);
    assert.match(await evaluate('ComparisonReport.generateFullHtml()'), /family-scope-table/);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, 'agent-family.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(modelCalls, 0);
    assert.deepEqual(errors, []);
    clearTimeout(timeout);
    console.log('Agent handoff smoke passed: clipboard, direct drag, editable graph, revisions, validation, port restart, family tree/history/export; model calls = 0');
    console.log('Artifacts: ' + output);
    win.destroy(); server.close(); app.exit(0);
  } catch (error) {
    clearTimeout(timeout); console.error(error.stack || error);
    if (win && !win.isDestroyed()) { console.error(await editor("return {status:d.querySelector('.agent-task-status')?.textContent,errors:typeof w.parent.electronAPI?.copyToClipboard,protocol:typeof w.AgentHandoffProtocol};").catch(() => 'no editor')); fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win.destroy(); }
    if (server) server.close(); app.exit(1);
  }
});
