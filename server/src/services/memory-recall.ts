import { getAllRules, getUnpromotedCandidates, getCandidatesByIds, type Candidate } from '../db/memory-db'
import { hybridSearch } from './rag-search'

const LABEL_MAP: Record<string, string> = {
  user_preference_rule: '用户偏好',
  project_rule: '项目规则',
  stable_fact: '稳定事实',
}

/** 全量注入时 candidate 的上限，避免 prompt 膨胀 */
const MAX_RECENT_CANDIDATES = 10
/** 向量检索时 top-N 候选记忆条数 */
const MAX_MEMORY_HITS = 3

/** 记忆召回超时兜底：向量检索不该阻塞主回答，超时回退全量候选 */
export const MEMORY_RECALL_TIMEOUT_MS = 2000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`memory recall timed out after ${ms}ms`)), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * 构建 system prompt 追加内容：长期记忆（已提升的 rules）+ 近期偏好（未提升的 candidates）。
 * - rules 全量注入：已提升的长期记忆是全局上下文，与任何 query 都可能相关（如"用户住在深圳"对天气查询有用）
 * - candidates 有 query + userId 时走向量检索 top-3；ES 不可用或无 query 时 fallback 全量
 * userId 用于用户隔离：只注入该用户的记忆。不传时返回全部（向后兼容旧测试）。
 */
export async function buildMemoryContext(userId?: string, query?: string): Promise<string> {
  const rules = getAllRules(userId)
  const candidates = await getRelevantCandidates(userId, query)

  if (rules.length === 0 && candidates.length === 0) return ''

  const parts: string[] = []

  if (rules.length > 0) {
    const lines = rules.map(r => {
      const label = LABEL_MAP[r.kind] || r.kind
      return `- [${label}] ${r.rule}`
    })
    parts.push(`## 长期记忆（基于历史会话总结的规则）\n${lines.join('\n')}`)
  }

  if (candidates.length > 0) {
    const lines = candidates.map(c => `- ${c.statement}`)
    parts.push(`## 近期偏好（待验证）\n${lines.join('\n')}`)
  }

  return parts.join('\n\n') + '\n'
}

/**
 * 获取与当前 query 相关的未提升 candidates。
 * 有 query + userId 时走向量检索 top-3；否则全量（截断 MAX_RECENT_CANDIDATES）。
 * ES/embedding 不可用时 fallback 全量。
 */
async function getRelevantCandidates(userId: string | undefined, query?: string): Promise<Candidate[]> {
  const allCandidates = getUnpromotedCandidates(userId).filter(c => c.type === 'user_preference')

  if (!query || !query.trim() || !userId) {
    return allCandidates.slice(0, MAX_RECENT_CANDIDATES)
  }

  try {
    const hits = await withTimeout(
      hybridSearch(query, userId, { sourceType: 'candidate', topN: MAX_MEMORY_HITS }),
      MEMORY_RECALL_TIMEOUT_MS,
    )
    if (hits.length === 0) return []

    const candidateIds = hits.map(h => h.sourceId)
    const vectorCands = getCandidatesByIds(candidateIds, userId).filter(c => c.type === 'user_preference')
    if (vectorCands.length === 0) return []

    const candMap = new Map(vectorCands.map(c => [c.id, c]))
    const ordered = hits
      .map(h => candMap.get(h.sourceId))
      .filter((c): c is NonNullable<typeof c> => !!c)

    console.log(`[Memory] Candidates: ${ordered.length} vector hits for "${query.slice(0, 50)}"`)
    return ordered
  } catch (err) {
    console.warn(`[Memory] Candidate vector recall failed, fallback to full:`, err instanceof Error ? err.message : String(err))
    return allCandidates.slice(0, MAX_RECENT_CANDIDATES)
  }
}
