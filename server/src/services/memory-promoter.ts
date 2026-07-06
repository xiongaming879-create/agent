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
  let mergedResults: MergedResult[] | null = null
  try {
    mergedResults = await llmMergeCandidates(candidates)
  } catch {
    mergedResults = null
  }

  const useMerged = mergedResults && mergedResults.length > 0

  let promoted = 0
  let kept = 0
  const promotedIds = new Set<string>()

  if (useMerged) {
    // Use LLM merged results with proper member_ids tracking
    for (const merged of mergedResults!) {
      // Reconstruct full conversation set from member_ids
      const memberConversations = new Set<string>()
      for (const mid of merged.member_ids) {
        const orig = candidates.find(c => c.id === mid)
        if (orig) memberConversations.add(orig.conversation_id)
      }
      // Fallback: if no member_ids, use the comma-joined conversation_id
      if (memberConversations.size === 0) {
        for (const cid of merged.conversation_id.split(',')) {
          if (cid) memberConversations.add(cid)
        }
      }

      const result = evaluateMergedGroup(
        merged.statement,
        merged.type,
        merged.durable,
        Array.from(memberConversations)
      )
      if (result) {
        createRule(result)
        // Mark all original candidates that contributed to this merged result
        for (const mid of merged.member_ids) {
          if (!promotedIds.has(mid)) {
            markCandidatePromoted(mid)
            promotedIds.add(mid)
          }
        }
        promoted++
      } else {
        kept++
      }
    }
  } else {
    // No LLM merge — use statement-based grouping on original candidates
    const groups = groupByStatement(candidates)

    for (const group of groups) {
      const result = evaluateGroup(group)
      if (result) {
        createRule(result)
        for (const gc of group) {
          if (!promotedIds.has(gc.id)) {
            markCandidatePromoted(gc.id)
            promotedIds.add(gc.id)
          }
        }
        promoted++
      } else {
        kept++
      }
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

function evaluateMergedGroup(
  statement: string,
  type: string,
  durable: number,
  conversationIds: string[]
): {
  kind: 'user_preference_rule' | 'project_rule' | 'stable_fact'
  rule: string
  promotion_reason: 'cross_session' | 'failure_evidence' | 'explicit'
  supporting_conversations: string[]
} | null {
  const conversations = new Set(conversationIds)

  // Priority 1: cross_session (≥2 different conversations)
  if (conversations.size >= 2) {
    return {
      kind: 'user_preference_rule',
      rule: statement,
      promotion_reason: 'cross_session',
      supporting_conversations: Array.from(conversations),
    }
  }

  // Priority 2: failure_evidence (type=lesson)
  if (type === 'lesson') {
    return {
      kind: 'stable_fact',
      rule: statement,
      promotion_reason: 'failure_evidence',
      supporting_conversations: Array.from(conversations),
    }
  }

  // Priority 3: explicit (durable=1)
  if (durable === 1) {
    return {
      kind: 'user_preference_rule',
      rule: statement,
      promotion_reason: 'explicit',
      supporting_conversations: Array.from(conversations),
    }
  }

  return null
}

interface MergedResult {
  conversation_id: string
  type: string
  statement: string
  durable: number
  member_ids: string[]
}

async function llmMergeCandidates(
  candidates: Candidate[]
): Promise<MergedResult[] | null> {
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
- member_ids: 被合并进来的原始 candidate_id 列表（必须从输入的 candidate_id 中选取）

注意：
- 只合并语义相同的候选
- 独立的候选也要输出，member_ids 只放它自己
- 保持信息完整性

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
    const parsed = JSON.parse(jsonMatch[0]) as {
      merged_memories: Array<{
        type: string
        statement: string
        durable: number
        member_ids?: string[]
      }>
    }
    if (!Array.isArray(parsed.merged_memories)) return null

    const candidateById = new Map(candidates.map(c => [c.id, c]))

    return parsed.merged_memories.map(m => {
      const memberIds = m.member_ids?.length ? m.member_ids : []
      // Reconstruct conversation_ids from original candidates
      const conversationIds = [
        ...new Set(
          memberIds
            .map(id => candidateById.get(id)?.conversation_id)
            .filter(Boolean) as string[]
        ),
      ]
      return {
        conversation_id: conversationIds.length > 0 ? conversationIds.join(',') : candidates[0]?.conversation_id ?? 'unknown',
        type: m.type,
        statement: m.statement,
        durable: m.durable ? 1 : 0,
        member_ids: memberIds,
      }
    })
  } catch {
    return null
  }
}
