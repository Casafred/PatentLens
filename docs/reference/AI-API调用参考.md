# Patent2Pic 项目 AI API 调用参考

本文档整理了项目中 GLM（智谱）、DeepSeek、OpenAI 三家 AI 提供商的 API 调用流程、参数格式和关键差异，便于在其他项目中参考复用。

---

## 一、架构总览

```
调用层 (useAIExtract / useAITranslation)
    ↓
统一入口 (client.ts → streamChat / testConnection)
    ↓
Provider 适配器 (zhipu.ts / deepseek.ts / openai.ts)
    ↓
fetch → SSE 流式响应解析
```

**核心设计**：Provider 适配器模式，所有提供商实现统一接口 `AIProviderAdapter`，通过 `client.ts` 统一调度。

---

## 二、类型定义

源文件：`src/types/ai.ts`

```typescript
type AIProviderType = 'openai' | 'zhipu' | 'deepseek'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatParams {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  responseFormat?: { type: 'json_object' } | { type: 'text' }
  thinking?: { type: 'enabled' | 'disabled'; budgetTokens?: number }
  reasoningEffort?: 'high' | 'max'
  topP?: number
  userId?: string
  streamOptions?: { includeUsage?: boolean }
}

interface ChatChunk {
  content: string
  reasoningContent?: string
  done: boolean
  usage?: ChatUsage
}

interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  reasoningTokens?: number
}
```

---

## 三、智谱 GLM 调用详情

源文件：`src/services/ai/providers/zhipu.ts`

### 3.1 基本信息

| 项目 | 值 |
|------|-----|
| **Base URL** | `https://open.bigmodel.cn/api/paas` |
| **API 路径** | `{baseUrl}/v4/chat/completions` |
| **路径后缀** | 自动追加 `/v4`（如 baseUrl 已含则不追加） |
| **认证方式** | `Authorization: Bearer {apiKey}` |
| **默认模型** | `glm-5.1` |
| **可选模型** | `glm-5.1`, `glm-5`, `glm-4-plus`, `glm-4-flash`, `glm-4-air`, `glm-4` |

### 3.2 请求体格式

```json
{
  "model": "glm-5.1",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.1,
  "max_tokens": 16384,
  "stream": true
}
```

### 3.3 关键差异

- URL 路径用 `/v4`（非 `/v1`）
- **不支持** `thinking`、`reasoning_effort`、`response_format`、`stream_options` 参数
- **不支持** `reasoning_content` 字段
- **不支持** usage 在流中返回

### 3.4 URL 构建逻辑

```typescript
private buildUrl(baseUrl: string): string {
  let base = baseUrl.replace(/\/+$/, '')
  if (!base.endsWith('/v4')) {
    base += '/v4'
  }
  return base
}
```

---

## 四、DeepSeek 调用详情

源文件：`src/services/ai/providers/deepseek.ts`

### 4.1 基本信息

| 项目 | 值 |
|------|-----|
| **Base URL** | `https://api.deepseek.com` |
| **API 路径** | `{baseUrl}/v1/chat/completions` |
| **路径后缀** | 自动追加 `/v1` |
| **认证方式** | `Authorization: Bearer {apiKey}` |
| **默认模型** | `deepseek-v4-flash` |
| **可选模型** | `deepseek-v4-flash`, `deepseek-v4-pro` |

### 4.2 请求体格式（推理模式）

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "max_tokens": 32768,
  "stream": true,
  "stream_options": { "include_usage": true },
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high",
  "response_format": { "type": "json_object" },
  "user_id": "patent2pic-user"
}
```

### 4.3 请求体格式（非推理模式）

```json
{
  "model": "deepseek-v4-flash",
  "messages": [...],
  "temperature": 0.1,
  "max_tokens": 16384,
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

### 4.4 关键差异与注意事项

1. **推理模式（thinking）**：开启时 `temperature` 不传（API 限制），`max_tokens` 默认 32768（非推理模式 16384）
2. **`stream_options`**：必须传 `{ include_usage: true }` 才能在流末尾收到 token 用量
3. **`reasoning_content`**：推理模式下，delta 中会返回 `reasoning_content` 字段（思考过程），与 `content`（最终输出）分开
4. **`reasoning_effort`**：控制推理深度，可选 `'high'` | `'max'`
5. **`response_format`**：支持 `{ type: 'json_object' }` 强制 JSON 输出
6. **`finish_reason: 'length'`**：输出被截断时抛出异常，需增大 `max_tokens`
7. **Usage 字段**：额外包含 `prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、`completion_tokens_details.reasoning_tokens`

### 4.5 请求体构建逻辑

```typescript
const isThinking = params.thinking?.type === 'enabled'

const body: Record<string, unknown> = {
  model: params.model,
  messages: params.messages,
  max_tokens: params.maxTokens ?? (isThinking ? 32768 : 16384),
  stream: true,
  stream_options: { include_usage: true },
}

if (!isThinking) {
  body.temperature = params.temperature ?? 0.1
  if (params.topP !== undefined) {
    body.top_p = params.topP
  }
}

if (params.responseFormat) {
  body.response_format = params.responseFormat
}

if (params.thinking) {
  const thinking: Record<string, unknown> = { type: params.thinking.type }
  if (params.thinking.budgetTokens !== undefined) {
    thinking.budget_tokens = params.thinking.budgetTokens
  }
  body.thinking = thinking
}

if (params.reasoningEffort) {
  body.reasoning_effort = params.reasoningEffort
}

if (params.userId) {
  body.user_id = params.userId
}
```

---

## 五、OpenAI 调用详情

源文件：`src/services/ai/providers/openai.ts`

### 5.1 基本信息

| 项目 | 值 |
|------|-----|
| **Base URL** | `https://api.openai.com` |
| **API 路径** | `{baseUrl}/v1/chat/completions` |
| **路径后缀** | 自动追加 `/v1` |
| **认证方式** | `Authorization: Bearer {apiKey}` |
| **默认模型** | `gpt-4o` |
| **可选模型** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo` |

### 5.2 请求体格式

```json
{
  "model": "gpt-4o",
  "messages": [...],
  "temperature": 0.1,
  "max_tokens": 16384,
  "stream": true,
  "response_format": { "type": "json_object" }
}
```

### 5.3 关键差异

- 支持 `response_format` 但不支持 `thinking`、`reasoning_effort`、`stream_options`
- 不返回 `reasoning_content`

---

## 六、SSE 流式响应解析

三家提供商的 SSE 流格式完全一致：

### 6.1 流格式示例

```
data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}
data: [DONE]
```

### 6.2 解析核心代码

```typescript
const reader = response.body!.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''  // 保留未完成的行

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') {
      yield { content: '', done: true }
      return
    }
    try {
      const parsed = JSON.parse(data)
      const content = parsed.choices?.[0]?.delta?.content || ''
      // DeepSeek 推理模式额外字段:
      const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content || ''
      // DeepSeek stream_options 返回 usage:
      const usage = parsed.usage ? parseUsage(parsed.usage) : undefined
      
      if (content || reasoningContent) {
        yield {
          content,
          ...(reasoningContent ? { reasoningContent } : {}),
          done: false,
          ...(usage ? { usage } : {}),
        }
      }
    } catch { continue }
  }
}
```

### 6.3 关键要点

- 用 `buffer` 处理跨 chunk 的不完整行
- `data: [DONE]` 表示流结束
- DeepSeek 的 `delta.reasoning_content` 是思考过程，`delta.content` 是最终输出
- `finish_reason: 'length'` 表示输出被截断，需增大 `max_tokens`

---

## 七、连接测试

三家通用逻辑，非流式请求验证连接：

```typescript
async testConnection(apiKey: string, baseUrl: string, model: string) {
  const start = performance.now()
  try {
    const url = `${buildUrl(baseUrl)}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false,  // 非流式
      }),
    })
    const latency = Math.round(performance.now() - start)

    if (response.ok) {
      return { success: true, message: `连接成功 (${latency}ms)`, latency }
    }
    const errorText = await response.text()
    return { success: false, message: `HTTP ${response.status}: ${errorText.slice(0, 200)}`, latency }
  } catch (err) {
    const latency = Math.round(performance.now() - start)
    return { success: false, message: `网络错误: ${(err as Error).message}`, latency }
  }
}
```

---

## 八、Provider 适配器接口

源文件：`src/services/ai/providers/types.ts`

```typescript
interface AIProviderAdapter {
  readonly type: AIProviderType
  chat(params: ChatParams): AsyncGenerator<ChatChunk>
  testConnection(apiKey: string, baseUrl: string, model: string): 
    Promise<{ success: boolean; message: string; latency?: number }>
}
```

### 8.1 `_meta` 传递机制

`client.ts` 将 `apiKey`、`baseUrl`、`signal` 注入到 `params._meta` 中，Provider 通过 `extractMeta()` 取出，避免污染业务参数：

```typescript
// client.ts
export async function* streamChat(
  providerType: AIProviderType,
  apiKey: string,
  baseUrl: string,
  params: ChatParams,
  signal?: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const provider = getProvider(providerType)
  const enrichedParams = {
    ...params,
    _meta: { baseUrl, apiKey, signal },
  }
  yield* provider.chat(enrichedParams)
}

// Provider 内部
private extractMeta(params: ChatParams & { _meta?: {...} }): { baseUrl: string; apiKey: string; signal?: AbortSignal } {
  const paramsAny = params as unknown as Record<string, unknown>
  const meta = paramsAny._meta as { baseUrl?: string; apiKey?: string; signal?: AbortSignal } | undefined
  return {
    baseUrl: meta?.baseUrl || 'https://api.deepseek.com',  // 默认值
    apiKey: meta?.apiKey || '',
    signal: meta?.signal,
  }
}
```

---

## 九、实际调用示例

源文件：`src/composables/useAIExtract.ts`

```typescript
for await (const chunk of streamChat(
  aiStore.activeProviderType,   // 'zhipu' | 'deepseek' | 'openai'
  aiStore.activeApiKey,         // API Key
  aiStore.activeBaseUrl,        // 自定义 Base URL
  {
    model: aiStore.activeModel,
    messages,
    temperature: isDeepSeek ? undefined : 0.1,  // DeepSeek 推理模式不传 temperature
    stream: true,
    responseFormat: isDeepSeek || isOpenAI
      ? { type: 'json_object' }    // DeepSeek/OpenAI 强制 JSON 输出
      : undefined,                  // GLM 不支持此参数
    thinking: isDeepSeek
      ? { type: 'enabled' }         // DeepSeek 开启推理
      : undefined,
    reasoningEffort: isDeepSeek
      ? 'high'                      // DeepSeek 推理深度
      : undefined,
    userId: isDeepSeek ? 'patent2pic-user' : undefined,
    streamOptions: isDeepSeek ? { includeUsage: true } : undefined,
  },
  abortController.signal,        // AbortSignal 支持取消
)) {
  if (chunk.done) break
  if (chunk.usage) lastUsage.value = chunk.usage
  fullContent += chunk.content
  if (chunk.reasoningContent) fullReasoning += chunk.reasoningContent
}
```

---

## 十、三家提供商差异速查表

| 特性 | 智谱 GLM | DeepSeek | OpenAI |
|------|----------|----------|--------|
| API 路径后缀 | `/v4` | `/v1` | `/v1` |
| 默认 Base URL | `open.bigmodel.cn/api/paas` | `api.deepseek.com` | `api.openai.com` |
| `temperature` | ✅ 0.1 | ❌ 推理模式禁用 | ✅ 0.1 |
| `thinking` | ❌ | ✅ | ❌ |
| `reasoning_effort` | ❌ | ✅ | ❌ |
| `response_format` | ❌ | ✅ json_object | ✅ json_object |
| `stream_options` | ❌ | ✅ include_usage | ❌ |
| `reasoning_content` | ❌ | ✅ 思考过程 | ❌ |
| 流中返回 usage | ❌ | ✅ | ❌ |
| `prompt_cache_*` | ❌ | ✅ | ❌ |
| 推理 max_tokens | 16384 | 32768 | 16384 |
| 非推理 max_tokens | 16384 | 16384 | 16384 |

---

## 十一、复用建议

### 11.1 直接复用文件

以下文件可直接复制到其他项目：

- `src/types/ai.ts` — 类型定义
- `src/services/ai/providers/types.ts` — Provider 接口
- `src/services/ai/providers/zhipu.ts` — 智谱实现
- `src/services/ai/providers/deepseek.ts` — DeepSeek 实现
- `src/services/ai/providers/openai.ts` — OpenAI 实现
- `src/services/ai/client.ts` — 统一入口

### 11.2 最小化复用

如只需调用单个提供商，只需复制对应的 Provider 文件和类型定义，直接调用：

```typescript
import { DeepSeekProvider } from './deepseek'

const provider = new DeepSeekProvider()
const params = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: '你好' }],
  thinking: { type: 'enabled' },
  _meta: { apiKey: 'your-api-key', baseUrl: 'https://api.deepseek.com' },
}

for await (const chunk of provider.chat(params)) {
  console.log(chunk.content)
  if (chunk.reasoningContent) console.log('[思考]', chunk.reasoningContent)
}
```

### 11.3 扩展新 Provider

实现 `AIProviderAdapter` 接口即可：

```typescript
class NewProvider implements AIProviderAdapter {
  readonly type = 'newprovider' as const
  
  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    // 1. 从 params._meta 取出 apiKey、baseUrl、signal
    // 2. 构建请求体
    // 3. fetch 发送请求
    // 4. 解析 SSE 流
    // 5. yield ChatChunk
  }
  
  async testConnection(apiKey: string, baseUrl: string, model: string) {
    // 验证连接
  }
}
```