/**
 * 轻量 LLM 单次调用（硅基流动 OpenAI 兼容接口），供 CHITCHAT/KNOWLEDGE 路径复用。
 * 无 ReAct 循环、无工具调用，单次请求流式输出文本。
 * API 错误时 fallback 到 MODEL_STRONG 重试一次。
 */
import type { AgentEvent } from '../types'
import { LLM_API_KEY, LLM_BASE_URL, MODEL_STRONG } from './llm-config'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const LLM_TIMEOUT_MS = 15000

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${LLM_API_KEY}`,
  }
}

function buildBody(model: string, messages: ChatMessage[], systemPrompt: string, maxTokens: number, stream: boolean): string {
  const fullMessages = systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
    : messages
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    stream,
    messages: fullMessages,
  })
}

/**
 * 流式调用 LLM，输出 content_delta 事件。
 * 用于不需要工具的轻量路径（CHITCHAT/KNOWLEDGE）。
 * 首次用传入的 model，失败则 fallback 到 MODEL_STRONG 重试。
 */
export async function* streamLLM(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string
): AsyncGenerator<AgentEvent> {
  const url = `${LLM_BASE_URL}/v1/chat/completions`
  const headers = buildHeaders()

  let res: Response
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: buildBody(model, messages, systemPrompt, 4096, true),
    }, LLM_TIMEOUT_MS)
  } catch (err) {
    yield { type: 'thought', content: `${model} 不可用 (${err instanceof Error ? err.message : String(err)})，切换到 ${MODEL_STRONG} 重试` }
    yield* retryWithStrongModel(messages, systemPrompt)
    return
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    yield { type: 'thought', content: `${model} API 错误 ${res.status}，切换到 ${MODEL_STRONG} 重试` }
    yield* retryWithStrongModel(messages, systemPrompt)
    return
  }

  yield* readSSEStream(res)

  yield { type: 'done' }
}

async function* retryWithStrongModel(
  messages: ChatMessage[],
  systemPrompt: string
): AsyncGenerator<AgentEvent> {
  const url = `${LLM_BASE_URL}/v1/chat/completions`
  const headers = buildHeaders()
  let res: Response
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: buildBody(MODEL_STRONG, messages, systemPrompt, 4096, true),
    }, LLM_TIMEOUT_MS)
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

  yield* readSSEStream(res)

  yield { type: 'done' }
}

async function* readSSEStream(res: Response): AsyncGenerator<AgentEvent> {
  const reader = res.body?.getReader()
  if (!reader) {
    yield { type: 'thought', content: 'LLM 返回无响应体' }
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
          const delta = event.choices?.[0]?.delta
          if (delta?.content) {
            yield { type: 'content_delta', content: delta.content }
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 非流式 LLM 调用，返回完整文本。用于 LLM 分类器等需要完整结果的场景。
 * 15 秒超时，失败时 fallback 到 MODEL_STRONG 重试一次。
 */
export async function callLLM(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  maxTokens: number = 100
): Promise<string> {
  const url = `${LLM_BASE_URL}/v1/chat/completions`
  const headers = buildHeaders()

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: buildBody(model, messages, systemPrompt, maxTokens, false),
    }, LLM_TIMEOUT_MS)
    if (!res.ok) throw new Error(`LLM API error ${res.status}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (model === MODEL_STRONG) throw err
    console.warn(`[callLLM] ${model} failed (${err instanceof Error ? err.message : String(err)}), retrying with ${MODEL_STRONG}`)
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: buildBody(MODEL_STRONG, messages, systemPrompt, maxTokens, false),
    }, LLM_TIMEOUT_MS)
    if (!res.ok) throw new Error(`LLM API error ${res.status}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content || ''
  }
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
