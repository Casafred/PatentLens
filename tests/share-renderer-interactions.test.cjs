const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRenderer() {
  const root = path.resolve(__dirname, '../src/scripts/app/share');
  const window = {};
  const context = vm.createContext({ window, Date, Math, JSON });
  for (const name of ['share-module-registry.js', 'share-renderer.js']) {
    const file = path.join(root, name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return window.PatentShareRenderer;
}

function makeProject() {
  const renderer = loadRenderer();
  const modules = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/share/share-module-registry.js'), 'utf8') + ';window.PatentShareModules', { window: {} });
  const config = modules.defaultConfig();
  config.modules.S4 = 'full';
  config.modules.S5 = 'full';
  config.modules.S7 = 'full';
  return {
    renderer,
    project: {
      name: '交互测试',
      moduleConfig: config,
      patents: [{
        id: 'p1',
        patentNumber: 'CN1',
        title: '测试专利',
        claims: [{ number: '1', type: 'independent', text: '一种测试装置。' }],
        claimsTranslation: '一种测试装置。',
        description: '测试说明书。',
        descriptionTranslation: 'Test description.',
        figures: [{ dataUrl: 'data:image/png;base64,AA==', caption: '图1' }],
        fields: {},
      }],
    },
  };
}

test('share HTML exposes stable sidebar, bilingual, figure and lightbox controls', () => {
  const { renderer, project } = makeProject();
  const result = renderer.render(project);

  assert.equal(result.findings.length, 0);
  const script = result.html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(result.html, /class="sidebar-toggle"/);
  assert.match(result.html, /class="sidebar-edge-trigger"/);
  assert.match(result.html, /data-bilingual-toggle="original"/);
  assert.match(result.html, /data-bilingual-toggle="translated"/);
  assert.match(result.html, /class="source-split-resizer"/);
  assert.match(result.html, /data-lb-action="zoom-in"/);
  assert.match(result.html, /data-lb-action="zoom-out"/);
  assert.match(result.html, /data-lb-action="rotate-left"/);
  assert.match(result.html, /data-lb-action="rotate-right"/);
  assert.match(result.html, /addEventListener\('wheel'/);
  assert.match(result.html, /class="processed-translation"/);
});

test('share HTML keeps bilingual controls available before translation exists', () => {
  const { renderer, project } = makeProject();
  delete project.patents[0].claimsTranslation;
  delete project.patents[0].descriptionTranslation;
  const result = renderer.render(project);

  assert.match(result.html, /data-bilingual-toggle="original"/);
  assert.match(result.html, /尚未生成中文翻译/);
  assert.match(result.html, /尚未生成权利要求翻译/);
});

test('absolute paths are checked only when embedded in exported HTML', () => {
  const renderer = loadRenderer();
  const project = { importedFilePath: 'C:\\Users\\tester\\patents\\source.xlsx' };
  assert.equal(renderer.scanSensitive(project, '').some((finding) => finding.includes('绝对本机路径')), false);
  assert.equal(renderer.scanSensitive({}, '<p>C:\\Users\\tester\\patents\\source.xlsx</p>').some((finding) => finding.includes('绝对本机路径')), true);
});

test('share attributes are embedded in the offline HTML report', () => {
  const { renderer, project } = makeProject();
  project.shareAttributes = { shareTime: '2026-08-08T10:30', department: '研发部', topic: '技术路线评审', sharer: '张三' };
  const result = renderer.render(project);
  assert.match(result.html, /分享属性/);
  assert.match(result.html, /研发部/);
  assert.match(result.html, /技术路线评审/);
  assert.equal(result.findings.some((finding) => finding.includes('绝对本机路径')), false);
});

test('workbench exposes one preview and export navigation entry', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../src/web.html'), 'utf8');
  assert.equal((html.match(/data-share-view="preview"/g) || []).length, 1);
  assert.equal((html.match(/data-share-view="export"/g) || []).length, 0);
  assert.match(html, /data-share-view="preview"><span class="share-nav-step">06<\/span>预览与导出/);
  assert.match(html, /data-share-view="overview"><span class="share-nav-step">01<\/span>编辑分享属性/);
  assert.match(html, /data-share-view="sources"><span class="share-nav-step">02<\/span>导入待分享专利/);
  assert.match(html, /data-share-view="review"><span class="share-nav-step">03<\/span>分享内容加工/);
  assert.match(html, /data-share-view="modules"><span class="share-nav-step">05<\/span>分享模块编排/);
});
