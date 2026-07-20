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

export async function extractSessionMemories(
  conversationId: string,
  messages: ChatMessage[]
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

  let llmResponse: string | null = null
  try {
    llmResponse = await callLLM(truncatedMessages, EXTRACT_PROMPT, MODEL_LIGHT, 1024)
  } catch (err) {
    console.warn('[MemoryExtractor] LLM API call failed:', err)
    return
  }

  if (!llmResponse) return

  const parsed = parseResponse(llmResponse)
  if (!parsed) {
    console.warn('[MemoryExtractor] Failed to parse LLM response')
    return
  }

  // Save episode summary
  createEpisode({
    conversation_id: conversationId,
    summary: parsed.episode_summary,
    candidate_count: parsed.memory_items.length,
  })

  // Save each memory candidate
  for (const item of parsed.memory_items) {
    createCandidate({
      conversation_id: conversationId,
      type: item.type,
      statement: item.statement,
      durable: item.durable ? 1 : 0,
    })
  }

  // Fire-and-forget promotion check
  promoteCandidates().catch(() => {
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

function parseResponse(text: string): ParsedResponse | null {
  // 路径1：JSON（剥离 markdown 代码块 + 栈匹配提取，字段顺序无关）
  const stripped = stripMarkdownCodeFence(text)
  const jsonStr = extractFirstJsonObject(stripped)
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed && parsed.episode_summary && Array.isArray(parsed.memory_items)) {
        return parsed as ParsedResponse
      }
    } catch {
      // Fall through to text format
    }
  }

  // 路径2：文本格式 fallback（兼容中英文冒号）
  const summaryMatch = text.match(/episode_summary[：:]\s*(.+?)(?:\n|$)/i)
  const typeMatches = [...text.matchAll(/type[：:]\s*(\w+)/gi)]
  const statementMatches = [...text.matchAll(/statement[：:]\s*(.+?)(?:\n|$)/gi)]

  if (summaryMatch && typeMatches.length > 0 && statementMatches.length > 0) {
    const items = typeMatches.map((tMatch, i) => ({
      type: (tMatch[1].toLowerCase() as 'user_preference' | 'fact' | 'lesson'),
      statement: statementMatches[i]?.[1]?.trim() ?? '',
      durable: /durable[：:]\s*(true|1)/i.test(text),
    }))

    return {
      episode_summary: summaryMatch[1].trim(),
      memory_items: items,
    }
  }

  return null
}
