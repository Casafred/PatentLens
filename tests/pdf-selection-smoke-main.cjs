const { app, BrowserWindow, session, clipboard } = require('electron');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.local-qa/pdf-selection');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + Date.now()));
app.disableHardwareAcceleration();
require('../electron-main.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await delay(60); }
  throw new Error('Timeout: ' + label);
}
app.whenReady().then(async () => {
  const timeout = setTimeout(() => app.exit(1), 90000);
  let win;
  const previousClipboard = clipboard.readText();
  const results = [];
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_, cb) => cb({ cancel: true }));
    await until(() => { win = BrowserWindow.getAllWindows().find(w => /^http:\/\/127.0.0.1/.test(w.webContents.getURL())); return !!win; }, 'desktop');
    const evaluate = code => win.webContents.executeJavaScript(code);
    await until(() => evaluate('!!window.__pdfViewerQuality && !document.getElementById("splash-screen")'), 'renderer');
    win.setSize(1400, 1100); win.show(); win.focus();
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = [
      ['Header must stay outside the selection.', 40, 360],
      ['Alpha paragraph starts here.', 40, 300],
      ['Beta indented continuation.', 90, 270],
      ['Gamma paragraph ends here.', 40, 240],
      ['Delta following paragraph.', 40, 180],
    ];
    const page = doc.addPage([520, 410]);
    for (const [text, x, y] of lines) page.drawText(text, { x, y, size: 16, font });
    page.drawText('Split row prefix', { x: 40, y: 130, size: 16, font });
    page.drawText('second fragment.', { x: 240, y: 130, size: 16, font });
    page.drawText('Next split continuation.', { x: 40, y: 100, size: 16, font });
    const next = doc.addPage([520, 410]);
    next.drawText('Second page starts here.', { x: 40, y: 360, size: 16, font });
    next.drawText('Second page final line.', { x: 40, y: 330, size: 16, font });
    const rotated = doc.addPage([520, 410]); rotated.setRotation(degrees(90));
    rotated.drawText('Rotated line text', { x: 40, y: 300, size: 16, font });
    const bytes = await doc.save();
    await evaluate(`(async()=>{document.querySelector('#reader-modal').classList.remove('hidden');pdfViewState.active=false;togglePdfView(true);pdfViewState.annotTool=null;window.selectionPdf=await pdfjsLib.getDocument({data:Uint8Array.from(atob('${Buffer.from(bytes).toString('base64')}'),c=>c.charCodeAt(0))}).promise;pdfViewState.pdfDoc=selectionPdf;pdfViewState.currentDocKey='selection-regression';})()`);
    async function caret(text, offset) {
      return evaluate(`(()=>{const span=[...document.querySelectorAll('.pdf-text-layer span')].find(s=>s.textContent===${JSON.stringify(text)});if(!span)throw new Error('Missing span');const range=document.createRange();range.setStart(span.firstChild,${offset});range.setEnd(span.firstChild,${offset});const r=range.getBoundingClientRect();return {x:Math.round(r.left+1),y:Math.round(r.top+r.height/2)}})()`);
    }
    async function drag(start, points, expected) {
      await evaluate('getSelection().removeAllRanges()');
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start });
      const samples = [];
      for (const point of points) {
        win.webContents.sendInputEvent({ type: 'mouseMove', buttons: ['left'], modifiers: ['leftButtonDown'], ...point });
        await delay(25);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        samples.push(await evaluate(`(()=>{const s=getSelection();return {text:s.toString(),anchor:s.anchorNode?.textContent,offset:s.anchorOffset,scroll:document.querySelector('#reader-pdf-container').scrollTop}})()`));
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points.at(-1) });
      await delay(40);
      const selected = await evaluate('getSelection().toString()');
      results.push({ expected, selected, samples });
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
      assert.ok(samples.every(sample => !sample.text.includes('Header must')), 'drag through whitespace selected preceding header');
      assert.ok(samples.every(sample => sample.anchor === samples[0].anchor && sample.offset === samples[0].offset), 'drag changed its anchor');
      assert.equal(selected.replace(/\s+/g, ' ').trim(), expected);
      clipboard.writeText(''); win.webContents.copy();
      await until(() => clipboard.readText().replace(/\s+/g, ' ').trim() === expected, 'native clipboard');
    }
    for (const scale of [1, 1.3]) {
      await evaluate(`renderAllPdfPages(selectionPdf,[],{},${scale})`);
      await evaluate('document.querySelector("#reader-pdf-container").scrollTop=0');
      const alpha = await caret(lines[1][0], 6), beta = await caret(lines[2][0], 0), gamma = await caret(lines[3][0], 5);
      const whitespace = { x: beta.x - Math.round(30 * scale), y: beta.y };
      await drag(alpha, [{ x: alpha.x + 15, y: alpha.y }, { x: whitespace.x, y: Math.round((alpha.y + beta.y) / 2) }, whitespace, gamma], 'paragraph starts here. Beta indented continuation. Gamma');
      assert.equal(results.at(-1).samples[1].text.replace(/\s+/g, ' ').trim(), 'paragraph starts here.', 'downward line-gap selection reversed before its anchor');
      assert.ok(!results.at(-1).samples.slice(0, -1).some(sample => sample.text.includes('Gamma')), 'whitespace caret jumped ahead to a later line');
      assert.ok(results.at(-1).samples.every(sample => sample.scroll === 0), 'in-page selection moved the scroll position');
      await drag(gamma, [whitespace, { x: alpha.x, y: Math.round((alpha.y + beta.y) / 2) }, alpha], 'paragraph starts here. Beta indented continuation. Gamma');
      assert.ok(results.at(-1).samples[1].text.replace(/\s+/g, ' ').trim().endsWith('Gamma'), 'upward line-gap selection reversed past its anchor');
      const split = await caret('second fragment.', 7), prefix = await caret('Split row prefix', 1), splitNext = await caret('Next split continuation.', 4);
      await drag(split, [{ x: prefix.x, y: Math.round((split.y + splitNext.y) / 2) }, splitNext], 'fragment. Next');
      assert.equal(results.at(-1).samples[0].text.replace(/\s+/g, ' ').trim(), 'fragment.', 'line-gap selection reversed across spans on the same row');
      if (scale === 1) {
        const delta = await caret('Next split continuation.', 5), second = await caret('Second page starts here.', 11);
        await drag(delta, [{ x: delta.x + 15, y: delta.y }, { x: delta.x, y: Math.round((delta.y + second.y) / 2) }, second], 'split continuation. Second page');
      }
    }
    // Native text selection must not steal Shift/OCR box selection or annotations.
    await evaluate('document.querySelector("#reader-pdf-container").scrollTop=0;getSelection().removeAllRanges()');
    const point = await caret(lines[1][0], 6);
    const word = await caret(lines[1][0], 10);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...word });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 2, ...word });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 2, ...word });
    await until(() => evaluate('getSelection().toString().trim() === "paragraph"'), 'native double-click word selection');
    await evaluate('getSelection().removeAllRanges()');
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, modifiers: ['shift'], ...point });
    await until(() => evaluate('pdfViewState.selecting'), 'Shift box selection ownership');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, modifiers: ['shift'], ...point });
    await evaluate('setPdfAnnotTool("highlight")');
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await until(() => evaluate('pdfViewState.annotDragging'), 'annotation gesture ownership');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await evaluate('setPdfAnnotTool(null)');
    assert.equal(await evaluate('getSelection().toString()'), '');
    await evaluate('document.querySelector("#pdf-text-select-btn").click()');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".pdf-text-layer")).pointerEvents'), 'none');
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await until(() => evaluate('pdfViewState.selecting'), 'disabled text mode returns box selection');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await evaluate(`document.querySelector('#pdf-text-select-btn').click();[...document.querySelectorAll('.pdf-text-layer span')].find(s=>s.textContent==='Rotated line text').scrollIntoView({block:'center'})`);
    const rotatedStart = await caret('Rotated line text', 8), rotatedEnd = await caret('Rotated line text', 12);
    await drag(rotatedStart, [rotatedEnd], 'line');
    fs.writeFileSync(path.join(output, 'selection.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PDF selection smoke passed: multiline/reverse drag, precise whitespace caret, stable scrolling, cross-page copy, two zooms, rotated page, native double-click, Shift box selection, annotation ownership and text mode toggle.');
    clearTimeout(timeout); clipboard.writeText(previousClipboard); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); clipboard.writeText(previousClipboard); app.exit(1);
  }
});
