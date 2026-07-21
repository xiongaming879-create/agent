import { createEpisode, createCandidate } from '../db/memory-db'
import { promoteCandidates } from './memory-promoter'
import { callLLM, stripMarkdownCodeFence, extractFirstJsonObject } from './llm-caller'
import { MODEL_LIGHT } from './llm-config'

const MAX_CONTENT_LENGTH = 2000

interface ChatMessage {
  role: string
  content: string
}

const EXTRACT_PROMPT = `你是一个会话记忆提取助手。分析以下对话，提取：
1. episode_summary: 三句话以内概括会话做了什么、失败过什么、怎么修正的
2. memory_items: 候选记忆列表，每项包含 type / statement / durable

type 必须是以下之一：
- "fact": 事实性信息（一次性、临时）
- "user_preference": 用户偏好（个人习惯、长期倾向）
- "lesson": 教训/经验

durable 判定标准：
- durable=true：个人习惯、长期偏好、用户身份信息、用户明确要求记住的事
  - 例如：睡午觉习惯、饮食偏好、工作时段、常用语言、姓名、职业
- durable=false：一次性事实、临时信息、会话特定上下文
  - 例如：本次行程的具体日期、临时查询的结果

重要：即使用户只是在会话中顺带提到个人习惯或偏好（不是会话主题），也要提取为 user_preference 并标记 durable=true。

返回 JSON 格式，不要包含其他文字：
{
  "episode_summary": "...",
  "memory_items": [
    { "type": "fact", "statement": "...", "durable": false }
  ]
}`

// 重试时追加：强调纯 JSON，避免 LLM 返回带说明文字或 markdown 包裹的内容
const RETRY_SUFFIX = '\n\n重要：请只返回纯 JSON 对象，不要包含 markdown 代码块标记（```）或任何说明文字。'

export async function extractSessionMemories(
  conversationId: string,
  messages: ChatMessage[],
  userId?: string
): Promise<void> {
  // Need at least one user and one assistant message
  if (messages.length < 2) return

  // Truncate long messages
  const truncatedMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content.length > MAX_CONTENT_LENGTH
      ? m.content.slice(0, MAX_CONTENT_LENGTH)
      : m.content,
  }))

  // 把对话拼成待分析文本，以"用户请求分析"的形式发送。
  // 避免直接用对话历史当 messages：那样 LLM（尤其轻量模型）会"继续对话"
  // 而不是按 system prompt 提取记忆（实测 deepseek-v4-flash 会追问用户而非返回 JSON）。
  const conversationText = truncatedMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n')
  const analysisMessages = [
    { role: 'user' as const, content: `请分析以下对话并提取记忆：\n\n${conversationText}` },
  ]

  let parsed: ParsedResponse | null = null
  try {
    parsed = await extractWithRetry(analysisMessages, EXTRACT_PROMPT)
  } catch (err) {
    console.warn('[MemoryExtractor] LLM API call failed:', err)
    return
  }

  if (!parsed) return

  // Save episode summary (即使 memory_items 为空也保存 episode 摘要)
  createEpisode({
    conversation_id: conversationId,
    summary: parsed.episode_summary || '(无摘要)',
    candidate_count: parsed.memory_items.length,
    user_id: userId ?? null,
  })

  // Save each memory candidate
  for (const item of parsed.memory_items) {
    createCandidate({
      conversation_id: conversationId,
      type: item.type,
      statement: item.statement,
      durable: item.durable ? 1 : 0,
      user_id: userId ?? null,
    })
  }

  // Fire-and-forget promotion check
  promoteCandidates(userId).catch(() => {
    // Swallow errors from fire-and-forget promotion
  })
}

interface ParsedResponse {
  episode_summary: string
  memory_items: Array<{
    type: 'user_preference' | 'fact' | 'lesson'
    statement: string
    durable: boolean
  }>
}

/**
 * 最多尝试 2 次：第一次失败（API 异常或解析失败）时，第二次用更严格的 prompt 重试。
 * - API 异常：第一次 catch 后 continue 重试；第二次仍 throw 则向上抛出
 * - 解析失败：第一次返回 null 后 continue 重试；第二次仍 null 则返回 null
 */
async function extractWithRetry(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  basePrompt: string
): Promise<ParsedResponse | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1 ? basePrompt : basePrompt + RETRY_SUFFIX
    let text: string
    try {
      text = await callLLM(messages, prompt, MODEL_LIGHT, 1024)
    } catch (err) {
      if (attempt === 1) {
        console.warn('[MemoryExtractor] LLM API call failed, retrying:', err instanceof Error ? err.message : String(err))
        continue
      }
      throw err
    }

    const parsed = parseResponse(text)
    if (parsed) return parsed

    if (attempt === 1) {
      console.warn('[MemoryExtractor] Parse failed, retrying with stricter prompt. Raw (first 300 chars):', text.slice(0, 300))
      continue
    }
    console.warn('[MemoryExtractor] Parse failed after retry. Raw (first 300 chars):', text.slice(0, 300))
    return null
  }
  return null
}

function parseResponse(text: string): ParsedResponse | null {
  // 路径1：JSON（剥离 markdown 代码块 + 栈匹配提取，字段顺序无关）
  const stripped = stripMarkdownCodeFence(text)
  const jsonStr = extractFirstJsonObject(stripped)
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as unknown
      const normalized = normalizeParsedResponse(parsed)
      if (normalized) return normalized
    } catch {
      // Fall through to text format
    }
  }

  // 路径2：文本格式 fallback（兼容中英文冒号）
  const summaryMatch = text.match(/episode_summary[：:]\s*(.+?)(?:\n|$)/i)
  const typeMatches = [...text.matchAll(/type[：:]\s*(\w+)/gi)]
  const statementMatches = [...text.matchAll(/statement[：:]\s*(.+?)(?:\n|$)/gi)]

  // 放宽：只要有 episode_summary 或 (type + statement) 之一即可保存
  if (summaryMatch || (typeMatches.length > 0 && statementMatches.length > 0)) {
    const durable = /durable[：:]\s*(true|1)/i.test(text)
    const items = typeMatches.map((tMatch, i) => ({
      type: normalizeType(tMatch[1]),
      statement: statementMatches[i]?.[1]?.trim() ?? '',
      durable,
    })).filter(item => item.statement)

    return {
      episode_summary: summaryMatch?.[1]?.trim() ?? '',
      memory_items: items,
    }
  }

  return null
}

/** 将 LLM 返回的任意结构标准化为 ParsedResponse；无法提取任何有效字段时返回 null */
function normalizeParsedResponse(raw: unknown): ParsedResponse | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>

  const summary = typeof obj.episode_summary === 'string' ? obj.episode_summary.trim() : ''
  const itemsRaw = Array.isArray(obj.memory_items) ? obj.memory_items : []

  // 至少要有 episode_summary 或一条 memory_item，否则视为无效
  if (!summary && itemsRaw.length === 0) return null

  const items = itemsRaw
    .map(normalizeItem)
    .filter((item): item is ParsedResponse['memory_items'][number] => item !== null)

  return {
    episode_summary: summary,
    memory_items: items,
  }
}

function normalizeItem(raw: unknown): ParsedResponse['memory_items'][number] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const statement = typeof obj.statement === 'string' ? obj.statement.trim() : ''
  if (!statement) return null
  return {
    type: normalizeType(typeof obj.type === 'string' ? obj.type : ''),
    statement,
    durable: parseDurableFlag(obj.durable),
  }
}

/** type 字段容忍大小写/中文/前缀，统一归一到三种合法值 */
function normalizeType(raw: string): 'user_preference' | 'fact' | 'lesson' {
  const lower = raw.toLowerCase()
  if (lower.includes('pref') || lower.includes('偏好')) return 'user_preference'
  if (lower.includes('lesson') || lower.includes('教训')) return 'lesson'
  return 'fact'
}

/** durable 字段容忍 boolean / number / 字符串("true"/"1"/"是") */
function parseDurableFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return /^(true|1|是)$/i.test(value.trim())
  return false
}
