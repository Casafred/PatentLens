// Real desktop entry / preload / local PDF worker / bundle IPC. No AI services.
const { app, BrowserWindow, session, clipboard } = require('electron');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.local-qa/document-workflow');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + Date.now()));
app.disableHardwareAcceleration();
require('../electron-main.js');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label) {
  const end = Date.now() + 25000;
  while (Date.now() < end) { if (await check()) return; await delay(80); }
  throw new Error('Timeout: ' + label);
}
app.whenReady().then(async () => {
  const timeout = setTimeout(() => app.exit(1), 120000);
  let win;
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_, cb) => cb({ cancel: true }));
    await until(() => { win = BrowserWindow.getAllWindows().find(w => /^http:\/\/127.0.0.1/.test(w.webContents.getURL())); return !!win; }, 'desktop');
    const evaluate = code => win.webContents.executeJavaScript(code);
    await until(() => evaluate('!!window.TransferPanel && !document.getElementById("splash-screen")'), 'renderer');
    win.setSize(1400, 1000); win.show(); win.focus();
    const errors = []; win.webContents.on('console-message', details => { if (/Uncaught|ReferenceError|TypeError/.test(details.message)) errors.push(details.message); });
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([550, 650]);
    page.drawText('Selectable patent evidence', { x: 40, y: 560, size: 18, font });
    page.drawText('Second line for copying', { x: 40, y: 530, size: 18, font });
    doc.addPage([550, 650]).drawRectangle({ x: 30, y: 40, width: 100, height: 100, color: rgb(.5, .5, .5) });
    const bytes = await doc.save();
    await evaluate(`(async()=>{
      document.querySelector('#reader-modal').classList.remove('hidden');
      pdfViewState.active=false;togglePdfView(true);pdfViewState.annotTool=null;
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      window.fixturePdf=await pdfjsLib.getDocument({data:Uint8Array.from(atob('${Buffer.from(bytes).toString('base64')}'),c=>c.charCodeAt(0))}).promise;
      pdfViewState.pdfDoc=fixturePdf;pdfViewState.scale=1;pdfViewState.currentDocKey='fixture';
      await renderAllPdfPages(fixturePdf,[],{},1);
    })()`);
    assert.match(await evaluate('pdfjsLib.GlobalWorkerOptions.workerSrc'), /127\.0\.0\.1.*pdf\.worker/);
    assert.equal(await evaluate('document.querySelectorAll(".pdf-text-layer").length'), 1, 'scan-only page has no selectable native layer');
    async function selectAndCopy() {
      await evaluate('getSelection().removeAllRanges();document.querySelector(".pdf-text-layer").scrollIntoView({block:"center"})');
      const rect = await evaluate(`(()=>{const r=[...document.querySelectorAll('.pdf-text-layer span')].find(el=>el.textContent==='Selectable patent evidence').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
      const start = { x: Math.round(rect.x + 1), y: Math.round(rect.y + rect.height / 2) };
      const end = { x: Math.round(rect.x + rect.width - 1), y: start.y };
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start });
      for (let i = 1; i <= 10; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + (end.x - start.x) * i / 10), y: end.y, modifiers: ['leftButtonDown'] });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
      await until(() => evaluate('getSelection().toString().includes("Selectable patent evidence")'), 'native drag selection');
      clipboard.writeText(''); win.webContents.copy();
      await until(() => clipboard.readText().includes('Selectable patent evidence'), 'native clipboard');
    }
    await selectAndCopy();
    fs.writeFileSync(path.join(output, 'pdf-selection.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('renderAllPdfPages(fixturePdf,[],{},1.3)'); await selectAndCopy();
    await evaluate(`document.querySelector('#reader-modal').classList.add('hidden');
      window.fixtureData={office:'US',raw:'US16123456',applicationNumber:'16123456'};
      window.fixtureDocs=[{idx:1,docId:'OA1',docCode:'OA',name:'Office Action',date:'2025-01-01',numberOfPages:2,docFormat:'PDF'},{idx:2,docId:'R2',docCode:'RESP',name:'Response',date:'2025-03-01',numberOfPages:1,docFormat:'PDF'}];
      window.fixtureExtractions={1:{text:'OCR '.repeat(5000)+'END-OF-OCR'}};
      TransferPanel.open('dossier',{data:fixtureData,docs:fixtureDocs,extractions:fixtureExtractions,docSelected:{1:true},blocks:TransferContext.buildDossierBlocks(fixtureData,fixtureDocs,fixtureExtractions,[1])});`);
    const handoff = path.join(app.getPath('temp'), 'PatentLensHandoff', 'TK-fixture-' + Date.now()); fs.mkdirSync(handoff, { recursive: true });
    const pdfPath = path.join(handoff, 'original.pdf'); fs.writeFileSync(pdfPath, bytes);
    await evaluate(`window.originalExport=TransferFileDock.exportPdf;TransferFileDock.exportPdf=async()=>({ok:true,filePath:${JSON.stringify(pdfPath)}});
      window.originalBundle=TransferFileDock.createBundle;TransferFileDock.createBundle=async p=>{window.bundleResult=await originalBundle(p);return bundleResult};
      document.querySelector('[data-action=bundle]').click();`);
    await until(() => evaluate('!!document.querySelector("[data-role=bundle-chip]")'), 'bundle ready');
    let result = await evaluate('bundleResult'); assert.equal(result.ok, true);
    let context = fs.readFileSync(result.filePaths.find(f => f.endsWith('context.md')), 'utf8');
    assert.match(context, /END-OF-OCR/); assert.match(context, /2025-03-01/);
    assert.equal(result.filePaths.filter(f => f.endsWith('.pdf')).length, 1);
    let drag;
    win.webContents.startDrag = options => { drag = options; };
    await evaluate(`document.querySelector('[data-role=bundle-chip]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true}))`);
    await until(() => !!drag, 'native multi-file drag IPC'); assert.equal(drag.files.length, 2);
    fs.writeFileSync(path.join(output, 'agent-files.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-role=note]').value='Updated request';document.querySelector('[data-role=note]').dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate('!!document.querySelector("[data-role=bundle-chip]")'), false, 'editing invalidates stale package');
    await evaluate(`TransferFileDock.exportPdf=async()=>({ok:false,error:'fixture unavailable'});document.querySelector('input[data-doc-idx="2"]').click();document.querySelector('[data-action=bundle]').click()`);
    await until(() => evaluate('!!document.querySelector("[data-role=bundle-chip]")'), 'partial bundle');
    result = await evaluate('bundleResult');
    const manifest = JSON.parse(fs.readFileSync(result.filePaths.find(f => f.endsWith('manifest.json')), 'utf8'));
    assert.equal(manifest.complete, false); assert.equal(manifest.missingAttachments.length, 1);
    assert.match(await evaluate('document.querySelector("[data-role=bundle-dock]").textContent'), /fixture unavailable/);
    // A closed panel cannot install a late package into a new patent's panel.
    await evaluate(`TransferPanel.close();TransferPanel.open('fulltext',{data:{patent_number:'US-ORIGINAL',description:'x'.repeat(19000)+'END-OF-DESCRIPTION'},blocks:TransferContext.buildFulltextBlocks({patent_number:'US-ORIGINAL',description:'x'.repeat(19000)+'END-OF-DESCRIPTION'})});document.querySelector('[data-action=bundle]').click()`);
    await until(() => evaluate('!!document.querySelector("[data-role=bundle-chip]")'), 'fulltext package');
    result = await evaluate('bundleResult'); assert.match(fs.readFileSync(result.filePaths.find(f => f.endsWith('context.md')), 'utf8'), /END-OF-DESCRIPTION/);
    await evaluate(`TransferFileDock.createBundle=p=>new Promise(r=>window.releaseBundle=()=>originalBundle(p).then(r));document.querySelector('[data-action=bundle]').click()`);
    await until(() => evaluate('typeof releaseBundle==="function"'), 'delayed IPC');
    await evaluate(`TransferPanel.close();TransferPanel.open('timeline',{data:{raw:'OTHER'},blocks:TransferContext.buildTimelineBlocks({raw:'OTHER'},[])});releaseBundle()`);
    await delay(200); assert.equal(await evaluate('!!document.querySelector("[data-role=bundle-chip]")'), false);
    assert.deepEqual(errors, []);
    console.log('Document workflow smoke passed: offline real PDF worker, mouse selection/copy at two zooms, scan page, real bundle IPC, full OCR/description, full timeline, multi-file native drag, missing materials, stale/closed panel protection.');
    console.log('Artifacts: ' + output); clearTimeout(timeout); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); app.exit(1);
  }
});
