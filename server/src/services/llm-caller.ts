/**
 * 轻量 LLM 单次调用（流式），供 CHITCHAT/KNOWLEDGE 路径复用。
 * 无 ReAct 循环、无工具调用，单次请求流式输出文本。
 */
import type { AgentEvent } from '../types'
import { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL } from './llm-config'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * 流式调用 LLM，输出 content_delta 事件。
 * 用于不需要工具的轻量路径（CHITCHAT/KNOWLEDGE）。
 */
export async function* streamLLM(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string
): AsyncGenerator<AgentEvent> {
  const url = `${ANTHROPIC_BASE_URL}/v1/messages`
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    temperature: 0,
    stream: true,
    messages,
    system: systemPrompt,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_AUTH_TOKEN,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    yield { type: 'thought', content: `LLM 调用失败: ${err instanceof Error ? err.message : String(err)}` }
    yield { type: 'done' }
    return
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    yield { type: 'thought', content: `LLM API 错误 ${res.status}: ${errText.slice(0, 200)}` }
    yield { type: 'done' }
    return
  }

  const reader = res.body?.getReader()
  if (!reader) {
    yield { type: 'thought', content: 'LLM 返回无响应体' }
    yield { type: 'done' }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          if (event.type === 'content_block_delta') {
            const delta = event.delta
            if (delta?.type === 'text_delta' && delta.text) {
              yield { type: 'content_delta', content: delta.text }
            }
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock()
  }

  yield { type: 'done' }
}

/**
 * 非流式 LLM 调用，返回完整文本。用于 LLM 分类器等需要完整结果的场景。
 */
export async function callLLM(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  maxTokens: number = 100
): Promise<string> {
  const url = `${ANTHROPIC_BASE_URL}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_AUTH_TOKEN,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages,
      system: systemPrompt,
    }),
  })

  if (!res.ok) {
    throw new Error(`LLM API error ${res.status}`)
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
  return data.content?.map(c => c.text).join('') || ''
}

/**
 * 剥离 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）。
 * 用于解析 LLM 返回的 JSON 时去除代码块标记。
 */
export function stripMarkdownCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (match) return match[1].trim()
  return text.trim()
}

/**
 * 用栈匹配从文本中提取第一个完整 JSON 对象。
 * 跳过字符串字面量内的 `{` `}`，避免误匹配。
 * 字段顺序无关，容忍 JSON 前后的说明文字。
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = false; continue }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
