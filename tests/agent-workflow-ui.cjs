// Runs in the real Electron shell after the round-trip smoke fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function verifyWorkflow({ win, evaluate, until, output }) {
  async function capture(name) {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  async function assertVisible(selector) {
    assert.equal(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&[.2,.8].every(f=>el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height*f)));})()`), true, selector + ' is fully clickable');
  }
  await evaluate(`document.querySelector('.agent-task-close').click();PatentShareWorkspace.close();
    document.querySelector('#comparison-section').classList.add('hidden');
    document.querySelector('#patent-detail-section').classList.remove('hidden');
    window._currentPatentData={patent_number:'US14412875B2',title:'原文缓存交接验证',abstract:'主页面摘要',claims:[{num:1,text:'A housing and a motor.',type:'independent'},{num:2,text:'The device of claim 1 with a sensor.',type:'dependent'}],description:'[0020] A housing and a motor.',drawings:['https://example.com/fig1.png','https://example.com/fig2.png']};
    _pdActivePatent='US14412875B2';_pdPatentCache[_pdActivePatent]=window._currentPatentData;
    GPCache.set(_pdActivePatent,window._currentPatentData);
    currentData={patent_number:'US999999A',office:'US',applicationNumber:'9999',title:'仅审查概要'};
    window._patentPopupData={patent_number:'EP222222B1',title:'其他弹窗',abstract:'其他专利摘要'};
    renderPatentDetail(window._currentPatentData);TransferEntry.ensureButtons();window.scrollTo(0,0);`);
  await assertVisible('#pl-transfer-entry-fulltext-inline');
  await evaluate(`document.getElementById('gt-fixes-back-to-top').style.display='flex';document.getElementById('gt-fixes-back-to-top').style.opacity='1';`);
  await assertVisible('#pl-floating-tools .pl-tools-mini [data-tool=tasks]');
  const overlap = await evaluate(`(()=>{const a=document.getElementById('pl-floating-tools').getBoundingClientRect(),b=document.getElementById('gt-fixes-back-to-top').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top})()`);
  assert.equal(overlap, false);
  await evaluate("document.querySelector('#pl-transfer-entry-fulltext-inline').click();");
  assert.equal(await evaluate("document.querySelectorAll('.pl-transfer-overlay input[data-block-idx]:checked:not(:disabled)').length"), 6);
  assert.equal(await evaluate("document.querySelectorAll('[data-role=image-dock] .pl-file-chip').length"), 2);
  assert.match(await evaluate("document.querySelector('[data-role=preview]').textContent"), /A housing and a motor/);
  assert.doesNotMatch(await evaluate("document.querySelector('[data-role=preview]').textContent"), /EP222222|US999999/);
  assert.equal(await evaluate("document.querySelector('.pl-transfer-preview').open"), false);
  await capture('workflow-fulltext');

  // Prepared image state survives redraws and transport errors remain retryable.
  await evaluate(`window._exportImages=TransferFileDock.exportImage;window._imageCalls=0;
    TransferFileDock.exportImage=async function(){window._imageCalls++;return {ok:true,filePath:'C:/fixture/fig'+window._imageCalls+'.png'}};
    document.querySelector('[data-action=prep-images]').click();`);
  await until(() => evaluate("document.querySelectorAll('[data-role=image-dock] .ready').length===2"), 'prepared images persist');
  assert.equal(await evaluate('_imageCalls'), 2);
  await evaluate(`TransferPanel.close();TransferFileDock.exportImage=function(){return Promise.reject(new Error('fixture image offline'))};document.querySelector('#pl-transfer-entry-fulltext-inline').click();document.querySelector('[data-action=export-img]').click();`);
  await until(() => evaluate("document.querySelector('[data-role=image-dock] .error')?.textContent.includes('fixture image offline')"), 'image failure shown');
  assert.match(await evaluate("document.querySelector('[data-role=image-dock] .error button').textContent"), /重试/);
  await evaluate(`TransferPanel.close();TransferFileDock.exportImage=_exportImages;void 0;`);

  // Popup entry reads its own publication even while another patent is active.
  await evaluate(`document.querySelector('#patent-popup-viewer').classList.remove('hidden');TransferEntry.ensureButtons();document.querySelector('#pl-transfer-entry-ppv').click();`);
  assert.match(await evaluate("document.querySelector('[data-role=preview]').textContent"), /EP222222B1/);
  assert.doesNotMatch(await evaluate("document.querySelector('[data-role=preview]').textContent"), /US14412875/);
  await evaluate("TransferPanel.close();document.querySelector('#patent-popup-viewer').classList.add('hidden');");

  // The review toolbar has one entry, with explicit choices inside it.
  assert.equal(await evaluate("document.querySelectorAll('.doclist-header-actions [data-agent-report],.kanban-header-actions [data-agent-report]').length"), 0);
  await evaluate("document.querySelector('#pl-transfer-entry-doclist').click();");
  assert.equal(await evaluate("document.querySelectorAll('.pl-agent-choice [data-choice]').length"), 4);
  const centered = await evaluate("(()=>{const r=document.querySelector('.pl-agent-choice').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:document.documentElement.clientWidth,h:document.documentElement.clientHeight}})()");
  assert.ok(Math.abs(centered.x - centered.w / 2) < 2 && Math.abs(centered.y - centered.h / 2) < 2, JSON.stringify(centered));
  await capture('workflow-review-entry');
  await evaluate("document.querySelector('[data-choice=materials]').click();");
  assert.equal(await evaluate("document.querySelector('.pl-transfer-header').textContent.includes('审查文档')"), true);
  // Newly selected OCR and prepared PDFs stay in sync with document selection.
  await evaluate(`TransferPanel.close();
    window._exportPdfs=TransferFileDock.exportPdf;TransferFileDock.exportPdf=async()=>({ok:true,filePath:'C:/fixture/document.pdf'});
    const docs=[{idx:31,docId:'first',docCode:'OA',name:'意见',numberOfPages:1},{idx:32,docId:'second',docCode:'RESP',name:'答复',numberOfPages:1}];
    const exts={31:{text:'first OCR'},32:{text:'second OCR'}};
    TransferPanel.open('dossier',{data:currentData,docs,extractions:exts,docSelected:{31:true,32:false},blocks:TransferContext.buildDossierBlocks(currentData,docs,exts,[31])});
    document.querySelector('[data-doc-idx="32"]').click();`);
  assert.match(await evaluate("document.querySelector('[data-role=preview]').textContent"), /second OCR/);
  assert.equal(await evaluate("document.querySelectorAll('[data-role=file-dock] .pl-file-chip').length"), 2);
  await evaluate("document.querySelector('[data-action=prep-all]').click();");
  await until(() => evaluate("document.querySelectorAll('[data-role=file-dock] .ready').length===2"), 'PDF ready state persists');
  await evaluate("document.querySelector('[data-doc-idx=\"32\"]').click();document.querySelector('[data-doc-idx=\"32\"]').click();");
  assert.equal(await evaluate("document.querySelectorAll('[data-role=file-dock] .ready').length"), 2);
  await evaluate("TransferPanel.close();TransferFileDock.exportPdf=_exportPdfs;void 0;");
  await evaluate("document.querySelector('#pl-transfer-entry-doclist').click();document.querySelector('[data-choice=report]').click();");
  await until(() => evaluate("!!document.querySelector('.agent-task-overlay')"), 'review report choice');
  assert.match(await evaluate("document.querySelector('#agent-task-title').textContent"), /审查与答复/);
  await evaluate("document.querySelector('.agent-task-close').click();");

  // Workspace walks through creation, sending, repair, import and acceptance.
  await evaluate("AgentTaskWorkspace.open();");
  await until(() => evaluate("!!document.querySelector('.agent-task-overlay')"), 'task workflow');
  await evaluate(`document.querySelector('[data-stage=prepare]').click();
    const goal=document.querySelector('[aria-label="报告分析目标"]'),source=document.querySelector('[aria-label="报告原文材料"]');
    goal.value='验证新流程';goal.dispatchEvent(new Event('input'));source.value='A motor drives a housing.';source.dispatchEvent(new Event('input'));
    document.querySelector('[data-action=create]').click();`);
  await until(() => evaluate("!document.querySelector('[data-action=create]').disabled && !document.querySelector('[data-step=send]').hidden"), 'workflow created');
  assert.equal(await evaluate("document.querySelector('[data-step=receive]').hidden"), true);
  assert.equal(await evaluate("document.querySelector('[data-role=part-selector]').hidden"), true);
  await capture('workflow-send');
  await evaluate("document.querySelector('[data-next=receive]').click();");
  assert.equal(await evaluate("document.querySelector('.agent-task-importer').open"), true);
  await evaluate("document.querySelector('.agent-task-result').value='broken JSON';document.querySelector('[data-action=import]').click();");
  await until(() => evaluate("!document.querySelector('[data-action=create]').disabled && !document.querySelector('.agent-task-recovery').hidden"), 'repair workflow');
  await evaluate(`const task=AgentTaskWorkspace.getStore().list().find(t=>t.label==='验证新流程');
    document.querySelector('.agent-task-result').value=JSON.stringify({kind:'patentlens-agent-result',schemaVersion:1,taskId:task.taskId,taskType:task.taskType,sourceHash:task.sourceHash,payload:{report:'电机驱动壳体。',evidence:[{sourceId:task.input.sources[0].id,quote:'A motor drives a housing.'}]}});
    document.querySelector('[data-action=import]').click();`);
  await until(() => evaluate("!document.querySelector('[data-action=create]').disabled && document.querySelector('.agent-task-report').textContent.includes('电机驱动壳体')"), 'import workflow');
  assert.equal(await evaluate("document.querySelector('.agent-task-recovery').hidden"), true);
  await evaluate("document.querySelector('.agent-task-evidence button').click();");
  await assertVisible('.agent-source-overlay button');
  await evaluate("document.querySelector('.agent-source-overlay button').click();document.querySelector('[data-action=accept]').click();");
  await until(() => evaluate("!document.querySelector('[data-action=create]').disabled && document.querySelector('.agent-task-context p').textContent.includes('已采用')"), 'adopt workflow');
  await capture('workflow-result');
  win.setSize(560, 780);
  await evaluate("document.querySelector('[data-stage=send]').click();");
  assert.equal(await evaluate("document.querySelector('[data-step=send]').hidden"), false);
  await assertVisible('.agent-task-close');
  assert.equal(await evaluate("document.querySelector('.agent-task-dialog').scrollWidth<=document.querySelector('.agent-task-dialog').clientWidth"), true);
  await capture('workflow-narrow');
  await evaluate("document.documentElement.setAttribute('data-theme','light');");
  await capture('workflow-light');
  await evaluate("document.querySelector('.agent-task-close').click();");
  win.setSize(1500, 1050);
};
