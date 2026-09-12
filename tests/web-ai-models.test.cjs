const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAI(seed, fetchImpl) {
  const store = new Map(seed ? [['history-helper-ai-config', JSON.stringify(seed)]] : []);
  const context = vm.createContext({
    localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)) },
    window: {}, console, TextDecoder, performance: { now: () => 0 }, fetch: fetchImpl || (async () => { throw new Error('not used'); }),
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

function sseResponse(events) {
  const encoder = new TextEncoder();
  let index = 0;
  return { ok: true, body: { getReader: () => ({ read: async () => index < events.length ? { done: false, value: encoder.encode(events[index++]) } : { done: true } }) } };
}

test('自定义 OpenAI Responses 协议映射推理强度并解析文本流', async () => {
  let request;
  const AI = loadAI({ custom: { type: 'custom', protocol: 'openai-responses', reasoningEffort: 'high' } }, async (url, options) => {
    request = { url, options };
    return sseResponse(['data: {"type":"response.output_text.delta","delta":"已完成"}\n\n']);
  });
  const chunks = [];
  for await (const chunk of AI.streamChat('custom', 'key', 'https://gateway.example/v1', { model: 'gpt-test', messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '问题' }], maxTokens: 123 })) chunks.push(chunk);
  assert.equal(request.url, 'https://gateway.example/v1/responses');
  const body = JSON.parse(request.options.body);
  assert.equal(body.max_output_tokens, 123);
  assert.equal(body.reasoning.effort, 'high');
  assert.equal(chunks[0].content, '已完成');
});

test('自定义 Anthropic 与 Gemini 协议使用各自的鉴权和流式文本字段', async () => {
  const requests = [];
  const AI = loadAI({ custom: { type: 'custom', protocol: 'anthropic', reasoningEffort: 'medium' } }, async (url, options) => {
    requests.push({ url, options });
    return sseResponse(['data: {"type":"content_block_delta","delta":{"text":"Claude"}}\n\n']);
  });
  const anthropic = [];
  for await (const chunk of AI.streamChat('custom', 'key-a', 'https://api.anthropic.com', { model: 'claude-test', messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '问题' }] })) anthropic.push(chunk);
  assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(requests[0].options.headers['x-api-key'], 'key-a');
  assert.equal(JSON.parse(requests[0].options.body).thinking.budget_tokens, 4096);
  assert.equal(anthropic[0].content, 'Claude');
});

test('自定义 Gemini 协议使用模型端点、key 查询参数和思考预算', async () => {
  let request;
  const AI = loadAI({ custom: { type: 'custom', protocol: 'gemini', reasoningEffort: 'low' } }, async (url, options) => {
    request = { url, options };
    return sseResponse(['data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"推理"},{"text":"Gemini"}]}}]}\n\n']);
  });
  const chunks = [];
  for await (const chunk of AI.streamChat('custom', 'key-g', 'https://generativelanguage.googleapis.com/v1beta', { model: 'gemini-test', messages: [{ role: 'user', content: '问题' }], maxTokens: 20 })) chunks.push(chunk);
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=key-g');
  const body = JSON.parse(request.options.body);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 1024);
  assert.equal(chunks[0].reasoningContent, '推理');
  assert.equal(chunks[0].content, 'Gemini');
});

test('自定义 Chat 服务商返回普通 JSON 时也能用于 AI 问答', async () => {
  const AI = loadAI({ custom: { type: 'custom', protocol: 'openai-chat', reasoningEffort: 'off' } }, async () => ({
    ok: true,
    body: { getReader: () => {
      let done = false;
      return { read: async () => {
        if (done) return { done: true };
        done = true;
        return { done: false, value: new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: '普通 JSON 回复' } }] })) };
      } };
    } },
  }));
  const chunks = [];
  for await (const chunk of AI.streamChat('custom', 'key', 'https://gateway.example/v1', { model: 'custom-model', messages: [{ role: 'user', content: '问题' }] })) chunks.push(chunk);
  assert.equal(chunks[0].content, '普通 JSON 回复');
});

test('自定义服务商无 data 前缀的 JSON 行也能解析', async () => {
  const AI = loadAI({ custom: { type: 'custom', protocol: 'openai-chat', reasoningEffort: 'off' } }, async () => sseResponse(['{"choices":[{"delta":{"content":"裸 JSON"}}]}\n\n']));
  const chunks = [];
  for await (const chunk of AI.streamChat('custom', 'key', 'https://gateway.example/v1', { model: 'custom-model', messages: [{ role: 'user', content: '问题' }] })) chunks.push(chunk);
  assert.equal(chunks[0].content, '裸 JSON');
});
