import type { ChatParams, ChatChunk } from '@/types/ai'
import type { AIProviderAdapter } from './types'
import { timingStart, timingEnd, timingLap } from '@/utils/timing'

export class ZhipuProvider implements AIProviderAdapter {
  readonly type = 'zhipu' as const

  private buildUrl(baseUrl: string): string {
    let base = baseUrl.replace(/\/+$/, '')
    if (!base.endsWith('/v4')) {
      base += '/v4'
    }
    return base
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { baseUrl, apiKey, signal } = this.extractMeta(params)
    const url = `${this.buildUrl(baseUrl)}/chat/completions`

    const providerTimingKey = `    │ 智谱 API`
    timingStart(providerTimingKey)

    timingStart(`    │ HTTP 连接`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.1,
        max_tokens: params.maxTokens ?? 65536,
        stream: true,
      }),
      signal,
    })

    timingEnd(`    │ HTTP 连接`)

    if (!response.ok) {
      const errorText = await response.text()
      timingEnd(providerTimingKey)
      throw new Error(`智谱 API 请求失败 (${response.status}): ${errorText}`)
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
          const content = parsed.choices?.[0]?.delta?.content || ''
          if (content) {
            if (!firstContentYielded) {
              firstContentYielded = true
              timingLap(`  首段内容到达`, providerTimingKey)
            }
            yield { content, done: false }
          }
        } catch {
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

  private extractMeta(params: ChatParams & { _meta?: { baseUrl?: string; apiKey?: string; signal?: AbortSignal } }): { baseUrl: string; apiKey: string; signal?: AbortSignal } {
    const paramsAny = params as unknown as Record<string, unknown>
    const meta = paramsAny._meta as { baseUrl?: string; apiKey?: string; signal?: AbortSignal } | undefined
    return {
      baseUrl: meta?.baseUrl || 'https://open.bigmodel.cn/api/paas',
      apiKey: meta?.apiKey || '',
      signal: meta?.signal,
    }
  }
}
