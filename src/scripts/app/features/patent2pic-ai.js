/* Feature-scoped AI transport. Existing PatentLens chat behavior is unchanged. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patent2PicAI = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function endpoint(base, suffix) {
    base = String(base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('请在 PatentLens AI 设置中填写有效的服务地址');
    if (/\/v\d+(?:beta)?$/i.test(base) && /^\/v\d+(?:beta)?\//i.test(suffix)) suffix = suffix.replace(/^\/v\d+(?:beta)?/i, '');
    return base + suffix;
  }
  function buildRequest(config, providerType, params) {
    var provider = config[providerType];
    if (!provider || !provider.apiKey || !params.model) throw new Error('请先在 PatentLens AI 设置中配置供应商和模型');
    var protocol = providerType === 'custom' ? provider.protocol || 'openai-chat' : 'openai-chat';
    var base = String(provider.baseUrl || '').replace(/\/+$/, '');
    var headers = { 'Content-Type': 'application/json' };
    var body, url, thinking = params.thinking, effort = params.reasoningEffort || (thinking && thinking.effort);
    var budget = params.maxTokens || (providerType === 'deepseek' && thinking && thinking.type === 'disabled' ? 32768 : 65536);
    var messages = params.messages || [], system = messages.filter(function (message) { return message.role === 'system' || message.role === 'developer'; }).map(function (message) { return message.content; }).join('\n\n');
    var rest = messages.filter(function (message) { return message.role !== 'system' && message.role !== 'developer'; });
    var customEffort = provider.reasoningEffort || 'off';
    if (providerType !== 'custom' && !/\/v\d+(?:beta)?(?:\/|$)/i.test(base)) base += providerType === 'zhipu' ? '/v4' : '/v1';
    if (protocol === 'anthropic') {
      url = endpoint(base, '/v1/messages');
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = { model: params.model, messages: rest, system: system || undefined, max_tokens: budget, stream: true };
      if (customEffort !== 'off') {
        body.thinking = { type: 'enabled', budget_tokens: { low: 1024, medium: 4096, high: 8192 }[customEffort] || 4096 };
        body.max_tokens = Math.max(body.max_tokens, body.thinking.budget_tokens + 1024);
      } else if (params.temperature != null) body.temperature = params.temperature;
    } else if (protocol === 'gemini') {
      url = endpoint(base, '/v1beta/models/' + encodeURIComponent(params.model) + ':streamGenerateContent?alt=sse');
      headers['x-goog-api-key'] = provider.apiKey;
      body = { contents: rest.map(function (message) { return { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }; }), generationConfig: { maxOutputTokens: budget } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (params.temperature != null) body.generationConfig.temperature = params.temperature;
      if (params.responseFormat && params.responseFormat.type === 'json_object') body.generationConfig.responseMimeType = 'application/json';
      if (customEffort !== 'off') body.generationConfig.thinkingConfig = { thinkingBudget: { low: 1024, medium: 4096, high: 8192 }[customEffort] || 4096 };
    } else if (protocol === 'openai-responses') {
      url = endpoint(base, '/responses');
      headers.Authorization = 'Bearer ' + provider.apiKey;
      body = { model: params.model, input: messages, max_output_tokens: budget, stream: true };
      if (params.responseFormat) body.text = { format: params.responseFormat };
      if (customEffort !== 'off') body.reasoning = { effort: customEffort };
      else if (params.temperature != null) body.temperature = params.temperature;
    } else if (protocol === 'openai-chat') {
      url = endpoint(base, '/chat/completions');
      headers.Authorization = 'Bearer ' + provider.apiKey;
      body = { model: params.model, messages: messages, max_tokens: budget, stream: true };
      if (params.responseFormat) body.response_format = params.responseFormat;
      if (providerType === 'deepseek') {
        if (thinking) body.thinking = { type: thinking.type };
        if (effort) body.reasoning_effort = effort;
        body.stream_options = { include_usage: true };
        if (!thinking || thinking.type !== 'enabled') {
          body.temperature = params.temperature == null ? 0.1 : params.temperature;
          if (params.topP != null) body.top_p = params.topP;
        }
        if (params.userId) body.user_id = params.userId;
      } else {
        if (params.temperature != null) body.temperature = params.temperature;
        if (params.streamOptions) body.stream_options = { include_usage: !!params.streamOptions.includeUsage };
        if (providerType === 'custom' && customEffort !== 'off') body.reasoning_effort = customEffort;
      }
    } else throw new Error('不支持的供应商协议：' + protocol);
    return { protocol: protocol, url: url, headers: headers, body: body };
  }
  function normalizeUsage(raw) {
    if (!raw) return undefined;
    var prompt = raw.prompt_tokens != null ? raw.prompt_tokens : raw.input_tokens != null ? raw.input_tokens : raw.promptTokenCount || 0;
    var completion = raw.completion_tokens != null ? raw.completion_tokens : raw.output_tokens != null ? raw.output_tokens : raw.candidatesTokenCount || 0;
    return {
      promptTokens: prompt, completionTokens: completion, totalTokens: raw.total_tokens || raw.totalTokenCount || prompt + completion,
      promptCacheHitTokens: raw.prompt_cache_hit_tokens,
      promptCacheMissTokens: raw.prompt_cache_miss_tokens,
      reasoningTokens: raw.thoughtsTokenCount || raw.completion_tokens_details && raw.completion_tokens_details.reasoning_tokens,
    };
  }
  function parseEvent(protocol, data, state) {
    if (data.error || data.type === 'error') throw new Error('AI 服务返回错误：' + String(data.error && data.error.message || data.message || data.type));
    var content = '', reasoning = '', usage = data.usage || data.usageMetadata;
    if (protocol === 'openai-responses') {
      if (data.type === 'response.failed' || data.type === 'response.incomplete') throw new Error('模型输出未完成，请增加输出预算或重试');
      if (data.type === 'response.output_text.delta') content = data.delta || '';
      if (/^response\.reasoning.*\.delta$/.test(data.type || '')) reasoning = data.delta || '';
      if (data.type === 'response.refusal.delta') throw new Error('模型拒绝了本次请求，请检查输入或更换模型');
      if (data.response) usage = data.response.usage;
      if (data.output_text && !state.hasContent) content = data.output_text;
      if (Array.isArray(data.output) && !state.hasContent) content = data.output.flatMap(function (item) { return item.content || []; }).filter(function (part) { return part.type === 'output_text'; }).map(function (part) { return part.text || ''; }).join('');
    } else if (protocol === 'anthropic') {
      if (data.type === 'message_start') { state.anthropicUsage = data.message && data.message.usage || {}; usage = state.anthropicUsage; }
      if (data.type === 'content_block_delta') { content = data.delta && data.delta.text || ''; reasoning = data.delta && data.delta.thinking || ''; }
      if (data.type === 'message_delta') {
        if (data.delta && data.delta.stop_reason === 'max_tokens') throw new Error('模型输出被截断，请增加输出预算或简化输入');
        state.anthropicUsage = Object.assign({}, state.anthropicUsage, data.usage); usage = state.anthropicUsage;
      }
      if (Array.isArray(data.content) && !state.hasContent) content = data.content.map(function (part) { return part.text || ''; }).join('');
    } else if (protocol === 'gemini') {
      var candidate = data.candidates && data.candidates[0];
      if (data.promptFeedback && data.promptFeedback.blockReason || candidate && ['MAX_TOKENS', 'SAFETY', 'RECITATION'].includes(candidate.finishReason)) throw new Error('模型输出被截断或拦截，请检查输入或更换模型');
      (candidate && candidate.content && candidate.content.parts || []).forEach(function (part) { if (part.thought) reasoning += part.text || ''; else content += part.text || ''; });
    } else {
      var choice = data.choices && data.choices[0];
      if (choice && ['length', 'content_filter'].includes(choice.finish_reason)) throw new Error('模型输出被截断或拦截，请增加输出预算或检查输入');
      var delta = choice && (choice.delta || choice.message) || {};
      if (delta.refusal) throw new Error('模型拒绝了本次请求，请检查输入或更换模型');
      content = delta.content || ''; reasoning = delta.reasoning_content || delta.reasoning || '';
      if (Array.isArray(content)) content = content.map(function (part) { return part.text || ''; }).join('');
    }
    if (content) state.hasContent = true;
    return { content: content, reasoningContent: reasoning, usage: normalizeUsage(usage), done: false };
  }
  async function* streamChat(config, providerType, params, signal, fetchFunction) {
    var request = buildRequest(config, providerType, params), controller = new AbortController(), timer;
    var cancel = function () { controller.abort(); };
    var resetTimeout = function () { clearTimeout(timer); timer = setTimeout(cancel, 120000); };
    if (signal && signal.aborted) { var aborted = new Error('用户终止分析'); aborted.name = 'AbortError'; throw aborted; }
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    resetTimeout();
    var reader;
    try {
      var response = await (fetchFunction || fetch)(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
      if (!response.ok) throw new Error('AI 请求失败（HTTP ' + response.status + '），请检查供应商设置后重试');
      var state = { hasContent: false }, decoder = new TextDecoder(), buffer = '', sse = false;
      function parseFrame(frame) {
        var lines = frame.split(/\r?\n/), data = lines.filter(function (line) { return /^data:/.test(line); }).map(function (line) { return line.slice(5).trimStart(); }).join('\n');
        if (!data || data.trim() === '[DONE]') return null;
        var parsed;
        try { parsed = JSON.parse(data); } catch (_) { throw new Error('AI 流式响应格式无效，请重试'); }
        return parseEvent(request.protocol, parsed, state);
      }
      reader = response.body && response.body.getReader();
      if (!reader) throw new Error('无法读取模型响应，请重试');
      while (true) {
        var part = await reader.read();
        if (part.done) { buffer += decoder.decode(); break; }
        resetTimeout(); buffer += decoder.decode(part.value, { stream: true });
        if (/^(?:data:|event:|:)/m.test(buffer)) sse = true;
        if (sse) {
          var frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
          for (var frame of frames) { var chunk = parseFrame(frame); if (chunk) yield chunk; }
        }
      }
      if (buffer.trim()) {
        if (sse) { var trailing = parseFrame(buffer); if (trailing) yield trailing; }
        else {
          var json;
          try { json = JSON.parse(buffer); } catch (_) { throw new Error('AI 响应不是有效 JSON，请检查接口协议'); }
          for (var item of (Array.isArray(json) ? json : [json])) yield parseEvent(request.protocol, item, state);
        }
      }
      if (!state.hasContent) throw new Error('模型没有返回成图内容，请检查模型或增加输出预算');
      yield { content: '', done: true };
    } catch (error) {
      if (controller.signal.aborted && !(signal && signal.aborted)) throw new Error('AI 响应超时，请检查网络或更换模型');
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', cancel);
      if (reader) { try { await reader.cancel(); } catch (_) { /* Already closed by provider. */ } reader.releaseLock(); }
    }
  }
  return { buildRequest: buildRequest, parseEvent: parseEvent, normalizeUsage: normalizeUsage, streamChat: streamChat };
});
