const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('专利一键解读提示词要求说明书明确效果优先并标注推测', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/scripts/web-ai.js'), 'utf8');
  assert.match(source, /说明书中明确写出的技术效果/);
  assert.match(source, /基于方案推测/);
  assert.match(source, /原文未明确说明/);
  const contextSource = fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/features/patent-interpretation-context.js'), 'utf8');
  assert.match(contextSource, /说明书上下文/);
});

test('实施例总结提示词包含固定结构、总览与详览表格', () => {
  const descriptionPrompt = fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/features/description-summary.js'), 'utf8');
  const sharePrompt = fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/share/share-ai.js'), 'utf8');
  for (const source of [descriptionPrompt, sharePrompt]) {
    assert.match(source, /执行摘要/);
    assert.match(source, /实施例总览/);
    assert.match(source, /重点实施例详览/);
    assert.match(source, /原文明确记载/);
    assert.match(source, /原文未公开具体对比实验数据/);
  }
  assert.match(descriptionPrompt, /\| 章节\/模块 \| 内容要点 \| 原文定位 \|/);
  assert.match(descriptionPrompt, /\| 实施例\/实施方式 \| 核心结构或步骤/);
  assert.match(descriptionPrompt, /patentlens-desc-summary-v2-/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/scripts/app/features/ai-session-cache.js'), 'utf8'), /patentlens-interpret-v2-/);
});

test('一键解读上下文增强会注入说明书并在完成后恢复摘要', async () => {
  const file = path.resolve(__dirname, '../src/scripts/app/features/patent-interpretation-context.js');
  let observedAbstract = '';
  const context = vm.createContext({
    console,
    Promise,
    document: { readyState: 'complete' },
    window: {
      _currentPatentData: { abstract: '原摘要', description: '明确提升了稳定性。' },
      runPatentInterpretation: async function () {
        observedAbstract = context.window._currentPatentData.abstract;
      },
    },
  });
  context.window.runPatentInterpretation._descriptionContextEnhanced = false;
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  await context.window.runPatentInterpretation('detail');
  assert.match(observedAbstract, /说明书上下文/);
  assert.match(observedAbstract, /明确提升了稳定性/);
  assert.equal(context.window._currentPatentData.abstract, '原摘要');
});
