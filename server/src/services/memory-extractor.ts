import { createEpisode, createCandidate } from '../db/memory-db'
import { promoteCandidates } from './memory-promoter'

const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || ''
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const MODEL = process.env.AGENT_MODEL || 'deepseek-v4-flash'
const MAX_CONTENT_LENGTH = 2000

interface ChatMessage {
  role: string
  content: string
}

export async function extractSessionMemories(
  conversationId: string,
  messages: ChatMessage[]
): Promise<void> {
  // Need at least one user and one assistant message
  if (messages.length < 2) return

  let llmResponse: string | null = null
  try {
    llmResponse = await callLLM(messages)
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
  // Try JSON format first
  const jsonMatch = text.match(/\{[\s\S]*"episode_summary"[\s\S]*"memory_items"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.episode_summary && Array.isArray(parsed.memory_items)) {
        return parsed as ParsedResponse
      }
    } catch {
      // Fall through to text format
    }
  }

  // Fallback: text format with regex extraction
  const summaryMatch = text.match(/episode_summary:\s*(.+?)(?:\n|$)/i)
  const typeMatches = [...text.matchAll(/type:\s*(\w+)/gi)]
  const statementMatches = [...text.matchAll(/statement:\s*(.+?)(?:\n|$)/gi)]

  if (summaryMatch && typeMatches.length > 0 && statementMatches.length > 0) {
    const items = typeMatches.map((tMatch, i) => ({
      type: (tMatch[1].toLowerCase() as 'user_preference' | 'fact' | 'lesson'),
      statement: statementMatches[i]?.[1]?.trim() ?? '',
      durable: text.toLowerCase().includes('durable: true') || text.toLowerCase().includes('durable: 1'),
    }))

    return {
      episode_summary: summaryMatch[1].trim(),
      memory_items: items,
    }
  }

  return null
}

async function callLLM(messages: ChatMessage[]): Promise<string | null> {
  const url = `${ANTHROPIC_BASE_URL}/v1/messages`

  // Truncate long messages
  const truncatedMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content.length > MAX_CONTENT_LENGTH
      ? m.content.slice(0, MAX_CONTENT_LENGTH)
      : m.content,
  }))

  const body = {
    model: MODEL,
    max_tokens: 1024,
    stream: false,
    messages: [
      {
        role: 'system' as const,
        content: `你是一个会话记忆提取助手。分析以下对话，提取：
1. episode_summary: 三句话以内概括会话做了什么、失败过什么、怎么修正的
2. memory_items: 候选记忆列表，每项包含 type / statement / durable

type 必须是以下之一：
- "fact": 事实性信息
- "user_preference": 用户偏好
- "lesson": 教训/经验

durable: true 表示应该长期记住（如用户明确要求记住的事），false 表示普通信息

返回 JSON 格式，不要包含其他文字：
{
  "episode_summary": "...",
  "memory_items": [
    { "type": "fact", "statement": "...", "durable": false }
  ]
}`,
      },
      ...truncatedMessages,
    ],
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_AUTH_TOKEN,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    console.warn(`[MemoryExtractor] LLM API returned ${response.status}`)
    return null
  }

  const data = await response.json() as { content: Array<{ text: string }> }
  return data.content?.[0]?.text ?? null
}
