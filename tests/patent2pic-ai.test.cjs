const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, streamChat } = require('../src/scripts/app/features/patent2pic-ai.js');
const config = {
  deepseek: { apiKey: 'test-key', baseUrl: 'https://example.invalid/v1' },
  zhipu: { apiKey: 'test-key', baseUrl: 'https://example.invalid/api/paas' },
  openai: { apiKey: 'test-key', baseUrl: 'https://example.invalid' },
  custom: { apiKey: 'test-key', baseUrl: 'https://example.invalid/v1', protocol: 'openai-chat' },
};
const params = { model: 'test-model', messages: [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: '权利要求' }], responseFormat: { type: 'json_object' }, thinking: { type: 'enabled' }, reasoningEffort: 'max' };
async function collect(iterable) { const result = []; for await (const chunk of iterable) result.push(chunk); return result; }
function fakeResponse(text, size = 7) {
  const bytes = new TextEncoder().encode(text);
  return { ok: true, body: new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
    controller.close();
  } }) };
}
test('existing providers preserve JSON mode, token budget and DeepSeek reasoning parameters', () => {
  const request = buildRequest(config, 'deepseek', params);
  assert.equal(request.url, 'https://example.invalid/v1/chat/completions');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.equal(request.body.reasoning_effort, 'max');
  assert.equal(request.body.max_tokens, 65536);
  assert.equal(request.body.temperature, undefined);
  assert.equal(buildRequest(config, 'zhipu', params).url, 'https://example.invalid/api/paas/v4/chat/completions');
  assert.equal(buildRequest(config, 'openai', params).url, 'https://example.invalid/v1/chat/completions');
});
test('all four custom protocols use their own request schema and avoid credentials in URLs', () => {
  for (const protocol of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
    const request = buildRequest({ custom: { ...config.custom, protocol } }, 'custom', params);
    assert.ok(!request.url.includes('test-key'));
    if (protocol === 'openai-responses') assert.deepEqual(request.body.text.format, params.responseFormat);
    if (protocol === 'anthropic') { assert.equal(request.body.system, 'Return JSON'); assert.equal(request.body.messages.length, 1); }
    if (protocol === 'gemini') assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  }
});
test('SSE survives split UTF-8 and split frames, preserving reasoning and final usage', async () => {
  const response = 'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"{\\"结果\\":1}"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const chunks = await collect(streamChat(config, 'deepseek', params, undefined, async () => fakeResponse(response, 1)));
  assert.equal(chunks.map(chunk => chunk.content).join(''), '{"结果":1}');
  assert.equal(chunks.map(chunk => chunk.reasoningContent || '').join(''), '思考');
  assert.equal(chunks.find(chunk => chunk.usage).usage.totalTokens, 16);
  assert.equal(chunks.at(-1).done, true);
});
test('non-streaming JSON gateway fallback is supported', async () => {
  const chunks = await collect(streamChat(config, 'custom', params, undefined, async () => fakeResponse(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))));
  assert.equal(chunks[0].content, '{}');
});
test('Responses, Anthropic and Gemini stream content and usage', async () => {
  const fixtures = {
    'openai-responses': [{ type: 'response.output_text.delta', delta: '{}' }, { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } }],
    anthropic: [{ type: 'message_start', message: { usage: { input_tokens: 3 } } }, { type: 'content_block_delta', delta: { text: '{}' } }, { type: 'message_delta', usage: { output_tokens: 2 } }],
    gemini: [{ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } }],
  };
  for (const [protocol, events] of Object.entries(fixtures)) {
    const chunks = await collect(streamChat({ custom: { ...config.custom, protocol } }, 'custom', params, undefined,
      async () => fakeResponse(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))));
    assert.equal(chunks.map(chunk => chunk.content).join(''), '{}');
    assert.equal(chunks.filter(chunk => chunk.usage).at(-1).usage.totalTokens, 5);
  }
});
test('truncation, failed responses and empty output fail instead of creating partial graphs', async () => {
  for (const body of [
    { choices: [{ delta: { content: '{' }, finish_reason: 'length' }] },
    { error: { message: 'test failure' } },
    { choices: [{ delta: { reasoning_content: 'thinking only' } }] },
  ]) await assert.rejects(collect(streamChat(config, 'openai', params, undefined, async () => fakeResponse('data: ' + JSON.stringify(body) + '\n\n'))));
});
test('cancellation propagates to fetch and stops pending reads', async () => {
  const controller = new AbortController();
  const run = collect(streamChat(config, 'deepseek', params, controller.signal, async (_url, init) => {
    assert.notEqual(init.signal, controller.signal);
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  }));
  controller.abort();
  await assert.rejects(run, { name: 'AbortError' });
});
