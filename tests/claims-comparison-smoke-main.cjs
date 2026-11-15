// Hidden Electron interaction and layout checks, using labelled development fixtures.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.local-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-profile'));
app.disableHardwareAcceleration();
let server;
const fixture = {
  items: [
    { id: 'cn1', label: 'CN 示例 · 权1（独立）', patentNumber: 'CN-DEMO-A', claimNumber: '1', originalText: '一种数据处理装置，包括处理器和存储器；所述处理器连接传感器；所述存储器存储测量数据。' },
    { id: 'us1', label: 'US 示例 · 权1（独立）', patentNumber: 'US-DEMO-B', claimNumber: '1', originalText: 'A data processing device comprising a processor and memory; the processor is coupled to an optical sensor; the memory stores measurement data at a sampling rate of 10 to 20 Hz.' },
    { id: 'ep1', label: 'EP 示例 · 权1（独立）', patentNumber: 'EP-DEMO-B', claimNumber: '1', originalText: 'A data processing device comprising a processor and memory; the processor is coupled to a sensor.' }
  ],
  raw: { version: 1, features: [
    { id: 'F1', label: '数据处理装置', definition: '处理器与存储器组成的装置', aliases: ['data processing device'] },
    { id: 'F2', parentId: 'F1', label: '处理器与传感器连接', definition: '比较传感器类型及连接关系', aliases: ['sensor', 'optical sensor'] },
    { id: 'F3', parentId: 'F1', label: '存储测量数据', definition: '存储器的数据存储功能' },
    { id: 'F4', parentId: 'F3', label: '采样率限定', definition: '是否具有 10–20 Hz 的数值限定', aliases: ['sampling rate'] }
  ], claims: [] }
};
const statuses = [['present', 'present', 'present', 'not_stated'], ['translation', 'narrower', 'translation', 'variant'], ['translation', 'translation', 'not_stated', 'uncertain']];
const quotes = [['处理器和存储器', '处理器连接传感器', '存储器存储测量数据', ''], ['a processor and memory', 'an optical sensor', 'the memory stores measurement data', '10 to 20 Hz'], ['a processor and memory', 'coupled to a sensor', '', '']];
fixture.raw.claims = fixture.items.map((item, i) => ({ itemId: item.id, category: '装置', scopeRelation: i === 1 ? 'narrower' : 'uncertain', scopeReason: i === 1 ? '光学传感器和采样率形成额外限定，需要结合完整权项判断。' : '以证据和完整权项核对。', combination: i === 1 ? 'F1 AND F2（光学）AND F3 AND F4（10–20 Hz）' : 'F1 AND F2' + (i === 0 ? ' AND F3' : ''), cells: fixture.raw.features.map((f, j) => ({ featureId: f.id, status: statuses[i][j], note: [['处理器与存储器', '传感器类型未具体限定', '明确存储测量数据', '未见数值限定'], ['与中文要素语义对应', '进一步限定为光学传感器', '翻译措辞不同', '明确限定 10–20 Hz'], ['术语语义对应', '未限定传感器类型', '已选原文未见存储功能限定', '需要核对完整权项']][i][j], confidence: 0.92, evidence: quotes[i][j] ? [{ sourceId: item.id, quote: quotes[i][j], translation: i ? '统一中文要素，具体限定见原文' : '' }] : [] })) }));

app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('Claims comparison smoke timed out'); app.exit(1); }, 60000);
  let win;
  try {
    server = http.createServer((req, res) => {
      const relative = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'web.html';
      const file = path.resolve(root, 'src', relative);
      if (!file.startsWith(path.join(root, 'src') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    require('../patent2pic-ipc.cjs').registerPatent2PicIPC({ ipcMain, userData: path.join(output, 'patent2pic'), getPort: () => server.address().port });
    require('../agent-handoff-ipc.cjs').registerAgentHandoffIPC({ ipcMain, clipboard: require('electron').clipboard, userData: path.join(output, 'agent-tasks'), getPort: () => server.address().port });
    win = new BrowserWindow({ show: false, width: 1500, height: 1100, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'preload.js'), webviewTag: true } });
    const errors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error' && /ReferenceError|SyntaxError|Uncaught|is not defined/.test(details.message)) errors.push(details.message); });
    await win.loadURL('http://127.0.0.1:' + server.address().port + '/web.html');
    const setup = await win.webContents.executeJavaScript(`(function(f) {
      document.getElementById('splash-screen')?.remove();
      document.documentElement.setAttribute('data-theme','light');
      document.querySelector('.search-mode-btn[data-mode="comparison"]').click();
      var section = document.getElementById('comparison-section'); section.classList.remove('hidden');
      ComparisonUI.init();
      f.items.forEach(i => ComparisonCore.addItem(i));
      ComparisonCore.setActiveTab('result');
      var result = { sessionId: 'smoke-family', timestamp: Date.now(), anchor: f.items[0], items: f.items, others: f.items.slice(1), scopeSources: FamilyScope.sourcesFor(f.items, {}), markdownContent: '# 开发样例 · 仅供交互验证\\n\\n' + '\u0060\u0060\u0060json\\n' + JSON.stringify({ familyScope: f.raw }) + '\\n\u0060\u0060\u0060', htmlContent: '<p>开发样例，非真实专利分析结果。</p>' };
      ComparisonCore.setResult(result); ComparisonUI.render();
      document.body.style.overflow = 'auto';
      section.style.cssText = 'display:block;position:relative;margin:0 auto;max-width:1400px;height:auto;overflow:visible';
      var content = section.querySelector('.cmp-tab-content'); if(content) content.style.cssText='height:auto;max-height:none;overflow:visible;flex:none';
      return { columns: section.querySelectorAll('.family-scope-table thead th').length, rows: section.querySelectorAll('.family-scope-table tbody tr').length, rawHidden: !section.querySelector('.comparison-result-content').textContent.includes('familyScope') };
    })(${JSON.stringify(fixture)})`);
    assert.equal(setup.columns, 4); assert.equal(setup.rows, 4); assert.equal(setup.rawHidden, true);
    const familyChecks = await win.webContents.executeJavaScript(`(function(){
      var root = document.getElementById('family-scope-result');
      root.querySelector('[data-feature="F2"][data-claim="1"]').click();
      var verifiedQuote = root.querySelector('.family-scope-detail').textContent.includes('an optical sensor');
      root.querySelector('[data-fold="F1"]').click(); var folded = root.querySelectorAll('tbody tr').length === 1;
      root.querySelector('[data-expand]').click(); var expanded = root.querySelectorAll('tbody tr').length === 4;
      var search = root.querySelector('input'); search.value = 'sampling'; search.dispatchEvent(new Event('input')); var searchRows = root.querySelectorAll('tbody tr').length;
      search.value='';search.dispatchEvent(new Event('input'));
      var filter = root.querySelector('select'); filter.value='uncertain';filter.dispatchEvent(new Event('change')); var uncertainRows = root.querySelectorAll('tbody tr').length;
      filter.value='all';filter.dispatchEvent(new Event('change'));
      return { verifiedQuote, folded, expanded, searchRows, uncertainRows, html: ComparisonReport.generateFullHtml() };
    })()`);
    assert.ok(familyChecks.verifiedQuote && familyChecks.folded && familyChecks.expanded);
    assert.equal(familyChecks.searchRows, 3); assert.equal(familyChecks.uncertainRows, 3);
    assert.match(familyChecks.html, /family-scope-table/);
    fs.writeFileSync(path.join(output, 'family-scope-report.html'), familyChecks.html);
    await win.webContents.executeJavaScript(`document.querySelector('.family-scope').scrollIntoView({block:'start'});`);
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(output, 'family-scope-desktop.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(720, 1000);
    await new Promise(resolve => setTimeout(resolve, 180));
    const narrow = await win.webContents.executeJavaScript(`(function(){var wrap=document.querySelector('.family-scope-table-wrap');return { scrolls:wrap.scrollWidth>wrap.clientWidth, fits:wrap.getBoundingClientRect().right<=innerWidth+1, width:innerWidth, right:wrap.getBoundingClientRect().right, client:wrap.clientWidth, scroll:wrap.scrollWidth };})()`);
    assert.ok(narrow.scrolls && narrow.fits, JSON.stringify(narrow));
    fs.writeFileSync(path.join(output, 'family-scope-narrow.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(1500, 1100);
    await new Promise(resolve => setTimeout(resolve, 180));
    await win.webContents.executeJavaScript(`document.documentElement.removeAttribute('data-theme');document.querySelector('.family-scope').scrollIntoView({block:'start'});`);
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(output, 'family-scope-dark.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme','light');`);
    const localChecks = await win.webContents.executeJavaScript(`(async function(){
      var before=[{num:'1',type:'independent',text:'一种装置，包括处理器和存储器。'},{num:'2',type:'dependent',text:'根据权利要求1所述的装置，其中存储器包括缓存。'},{num:'3',type:'dependent',text:'根据权利要求2所述的装置，其中缓存为共享缓存。'}];
      var after=JSON.parse(JSON.stringify(before));after[0].text='一种装置，包括处理器、安全模块和存储器。';
      _pdPatentCache.DEMOA={claims:before};_pdPatentCache.DEMOB={claims:after};
      ComparisonClaimDiff.enterWithPatents('DEMOA','DEMOB');
      await new Promise(r=>setTimeout(r,150));
      var root=document.getElementById('comparison-input-area');var tree=root.querySelector('#claimdiff-tree-root');
      if(!tree) throw new Error('Local tree missing: '+root.textContent.slice(-500));
      tree.querySelector('[data-step="1"]').click();
      var detailOpen=!tree.querySelector('.claimtree-detail').hidden;
      var input=tree.querySelector('input');input.value='安全模块';input.dispatchEvent(new Event('input'));
      var searchMatches=tree.querySelectorAll('.search-match').length;
      root.querySelector('.claimreader-card[data-filter="technical"]').click();
      var cards=root.querySelectorAll('.claimtree-node-card').length;
      var inherited=root.querySelectorAll('.claimtree-node-card.inherited_changed').length;
      root.querySelector('.claimdiff-view[data-view="list"]').click();
      var summary=root.querySelector('.claimreader-changes').textContent.includes('变化片段');
      root.querySelector('.claimdiff-view[data-view="tree"]').click();
      return {detailOpen, searchMatches, cards, inherited, summary, errors:[]};
    })()`);
    assert.ok(localChecks.detailOpen && localChecks.summary); assert.equal(localChecks.searchMatches, 1); assert.equal(localChecks.inherited, 4); assert.equal(localChecks.cards, 6);
    await win.webContents.executeJavaScript(`document.querySelector('.claimreader-overview').scrollIntoView({block:'start'});`);
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(output, 'claimdiff-desktop.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    await win.loadFile(path.join(output, 'family-scope-report.html'));
    const reportLayout = await win.webContents.executeJavaScript(`(function(){
      var row=document.querySelector('.family-scope-table tbody tr'), cells=Array.from(row.cells);
      return { cells:cells.length, sameRow:cells.every(c=>Math.abs(c.getBoundingClientRect().top-cells[0].getBoundingClientRect().top)<2), evidence:row.textContent.includes('a processor and memory') };
    })()`);
    assert.equal(reportLayout.cells,4); assert.ok(reportLayout.sameRow && reportLayout.evidence);
    await win.webContents.executeJavaScript(`document.querySelector('.family-scope').scrollIntoView({block:'start'});`);
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(output, 'family-scope-export.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'claims-comparison-smoke.json'), JSON.stringify({ setup, family: { ...familyChecks, html: undefined }, narrow, local: localChecks, reportLayout, errors }, null, 2));
    console.log('Claims comparison Electron interactions and responsive layout passed. Screenshots: .local-qa/');
    clearTimeout(timeout); win.destroy(); server.close(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); if (win) win.destroy(); if (server) server.close(); app.exit(1); }
});
