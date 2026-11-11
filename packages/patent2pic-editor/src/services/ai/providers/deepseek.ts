import type { ChatParams, ChatChunk, ChatUsage } from '@/types/ai'
import type { AIProviderAdapter } from './types'
import { timingStart, timingEnd, timingLap } from '@/utils/timing'

export class DeepSeekProvider implements AIProviderAdapter {
  readonly type = 'deepseek' as const

  private buildUrl(baseUrl: string): string {
    let base = baseUrl.replace(/\/+$/, '')
    if (!base.endsWith('/v1')) {
      base += '/v1'
    }
    return base
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { baseUrl, apiKey, signal } = this.extractMeta(params)
    const url = `${this.buildUrl(baseUrl)}/chat/completions`

    const providerTimingKey = `    │ DeepSeek API`
    timingStart(providerTimingKey)

    const isThinking = params.thinking?.type === 'enabled'

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? (isThinking ? 65536 : 32768),
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

    let httpTiming = `    │ HTTP 连接`
    timingStart(httpTiming)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    timingEnd(httpTiming)

    if (!response.ok) {
      const errorText = await response.text()
      timingEnd(providerTimingKey)
      throw new Error(`DeepSeek API 请求失败 (${response.status}): ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      timingEnd(providerTimingKey)
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let firstContentYielded = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          timingEnd(providerTimingKey)
          yield { content: '', done: true }
          return
        }
        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          const delta = choice?.delta

          if (choice?.finish_reason === 'length') {
            timingEnd(providerTimingKey)
            throw new Error('模型输出被截断 (finish_reason=length)，请尝试增大 max_tokens 或简化输入')
          }

          if (delta) {
            const content = delta.content || ''
            const reasoningContent = delta.reasoning_content || ''
            if (content || reasoningContent) {
              if (!firstContentYielded) {
                firstContentYielded = true
                timingLap(`  首段内容到达`, providerTimingKey)
              }
              yield {
                content,
                ...(reasoningContent ? { reasoningContent } : {}),
                done: false,
              }
            }
          }

          if (parsed.usage) {
            yield {
              content: '',
              done: false,
              usage: this.parseUsage(parsed.usage),
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('finish_reason=length')) {
            timingEnd(providerTimingKey)
            throw e
          }
          continue
        }
      }
    }

    timingEnd(providerTimingKey)
  }

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<{ success: boolean; message: string; latency?: number }> {
    const start = performance.now()
    try {
      const url = `${this.buildUrl(baseUrl)}/chat/completions`
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
          stream: false,
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

  private parseUsage(raw: Record<string, unknown>): ChatUsage {
    return {
      promptTokens: (raw.prompt_tokens as number) ?? 0,
      completionTokens: (raw.completion_tokens as number) ?? 0,
      totalTokens: (raw.total_tokens as number) ?? 0,
      promptCacheHitTokens: raw.prompt_cache_hit_tokens as number | undefined,
      promptCacheMissTokens: raw.prompt_cache_miss_tokens as number | undefined,
      reasoningTokens: (raw.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens as number | undefined,
    }
  }

  private extractMeta(params: ChatParams & { _meta?: { baseUrl?: string; apiKey?: string; signal?: AbortSignal } }): { baseUrl: string; apiKey: string; signal?: AbortSignal } {
    const paramsAny = params as unknown as Record<string, unknown>
    const meta = paramsAny._meta as { baseUrl?: string; apiKey?: string; signal?: AbortSignal } | undefined
    return {
      baseUrl: meta?.baseUrl || 'https://api.deepseek.com',
      apiKey: meta?.apiKey || '',
      signal: meta?.signal,
    }
  }
}
