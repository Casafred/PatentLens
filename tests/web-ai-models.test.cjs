const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAI(seed) {
  const store = new Map(seed ? [['history-helper-ai-config', JSON.stringify(seed)]] : []);
  const context = vm.createContext({
    localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)) },
    window: {}, console, TextDecoder, performance: { now: () => 0 }, fetch: async () => { throw new Error('not used'); },
  });
  const file = path.resolve(__dirname, '../src/scripts/web-ai.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.AI;
}

test('DeepSeek 默认模型为 deepseek-v4-flash', () => {
  const AI = loadAI();
  assert.equal(AI.getAvailableModels('deepseek')[0].value, 'deepseek-v4-flash');
  assert.equal(AI.loadAIConfig().deepseek.model, 'deepseek-v4-flash');
});

test('自定义模型去重并持久化到可选模型列表', () => {
  const AI = loadAI();
  const config = AI.loadAIConfig();
  assert.equal(AI.addCustomModel(config, 'deepseek', 'deepseek-custom'), true);
  assert.equal(AI.addCustomModel(config, 'deepseek', 'deepseek-custom'), true);
  AI.saveAIConfig(config);
  assert.deepEqual(Array.from(AI.getAvailableModels('deepseek')).map((item) => item.value), ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-custom']);
});
