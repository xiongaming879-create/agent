import {
  getUnpromotedCandidates,
  markCandidatePromoted,
  createRule,
  type Candidate,
} from '../db/memory-db'

const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || ''
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const MODEL = process.env.AGENT_MODEL || 'deepseek-v4-flash'

export async function promoteCandidates(): Promise<{ promoted: number; kept: number }> {
  const candidates = getUnpromotedCandidates()
  if (candidates.length === 0) {
    return { promoted: 0, kept: 0 }
  }

  // Single candidate: evaluate promotion conditions
  if (candidates.length === 1) {
    const candidate = candidates[0]
    const result = evaluateGroup([candidate])
    if (result) {
      createRule(result)
      markCandidatePromoted(candidate.id)
      return { promoted: 1, kept: 0 }
    }
    return { promoted: 0, kept: 1 }
  }

  // Multiple candidates: try LLM merge first
  let mergedCandidates: Candidate[]
  try {
    const merged = await llmMergeCandidates(candidates)
    if (merged && merged.length > 0) {
      mergedCandidates = merged as Candidate[]
    } else {
      mergedCandidates = candidates
    }
  } catch {
    mergedCandidates = candidates
  }

  // Group merged candidates by statement to avoid duplicate promotions
  const groups = groupByStatement(mergedCandidates)

  let promoted = 0
  let kept = 0
  const promotedIds = new Set<string>()

  for (const group of groups) {
    const result = evaluateGroup(group)
    if (result) {
      createRule(result)
      // Mark all original candidates that belong to this group as promoted
      for (const gc of group) {
        const originals = candidates.filter(
          orig => orig.statement === gc.statement || orig.id === gc.id
        )
        for (const orig of originals) {
          if (!promotedIds.has(orig.id)) {
            markCandidatePromoted(orig.id)
            promotedIds.add(orig.id)
          }
        }
      }
      promoted++
    } else {
      kept++
    }
  }

  return { promoted, kept }
}

function groupByStatement(candidates: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = []
  const seen = new Set<string>()

  for (const c of candidates) {
    if (seen.has(c.id)) continue
    const group = candidates.filter(other => other.statement === c.statement)
    for (const g of group) seen.add(g.id)
    groups.push(group)
  }

  return groups
}

function evaluateGroup(group: Candidate[]): {
  kind: 'user_preference_rule' | 'project_rule' | 'stable_fact'
  rule: string
  promotion_reason: 'cross_session' | 'failure_evidence' | 'explicit'
  supporting_conversations: string[]
} | null {
  // Collect all unique conversation IDs from the group
  const conversations = new Set(group.map(c => c.conversation_id))

  // Priority 1: cross_session (≥2 different conversations)
  if (conversations.size >= 2) {
    return {
      kind: 'user_preference_rule',
      rule: group[0].statement,
      promotion_reason: 'cross_session',
      supporting_conversations: Array.from(conversations),
    }
  }

  // Priority 2: failure_evidence (any in group has type=lesson)
  if (group.some(c => c.type === 'lesson')) {
    return {
      kind: 'stable_fact',
      rule: group[0].statement,
      promotion_reason: 'failure_evidence',
      supporting_conversations: [group[0].conversation_id],
    }
  }

  // Priority 3: explicit (any in group has durable=1)
  if (group.some(c => c.durable === 1)) {
    return {
      kind: 'user_preference_rule',
      rule: group[0].statement,
      promotion_reason: 'explicit',
      supporting_conversations: [group[0].conversation_id],
    }
  }

  return null
}

async function llmMergeCandidates(
  candidates: Candidate[]
): Promise<Array<{ conversation_id: string; type: string; statement: string; durable: number }> | null> {
  const url = `${ANTHROPIC_BASE_URL}/v1/messages`

  const candidateList = candidates.map(c => ({
    candidate_id: c.id,
    type: c.type,
    statement: c.statement,
  }))

  const body = {
    model: MODEL,
    max_tokens: 1024,
    stream: false,
    messages: [
      {
        role: 'system' as const,
        content: `你是一个记忆合并助手。分析以下候选记忆，合并同义/高度相似的候选为一条。返回 JSON 格式的 merged_memories 数组。

每个合并后的项包含：
- type: "user_preference" | "fact" | "lesson"
- statement: 合并后的陈述文本
- durable: 0 或 1（如果任一原始项 durable=1 则为 1）

注意：
- 只合并语义相同的候选
- 保持信息完整性
- 如果没有任何可合并的候选，按原样返回

返回格式: { "merged_memories": [...] }`,
      },
      {
        role: 'user' as const,
        content: JSON.stringify({ candidates: candidateList }),
      },
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
    console.warn(`[MemoryPromoter] LLM API returned ${response.status}`)
    return null
  }

  const data = await response.json() as { content: Array<{ text: string }> }
  const text = data.content?.[0]?.text
  if (!text) return null

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*"merged_memories"[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { merged_memories: Array<{ type: string; statement: string; durable: number }> }
    if (!Array.isArray(parsed.merged_memories)) return null

    return parsed.merged_memories.map(m => ({
      conversation_id: candidates[0]?.conversation_id ?? 'unknown',
      type: m.type,
      statement: m.statement,
      durable: m.durable ? 1 : 0,
    }))
  } catch {
    return null
  }
}
