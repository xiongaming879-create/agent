import { getAllRules, getUnpromotedCandidates } from '../db/memory-db'

const LABEL_MAP: Record<string, string> = {
  user_preference_rule: '用户偏好',
  project_rule: '项目规则',
  stable_fact: '稳定事实',
}

/** 近期偏好（未提升的 user_preference candidate）注入上限，避免 prompt 膨胀 */
const MAX_RECENT_CANDIDATES = 10

/**
 * 构建 system prompt 追加内容：长期记忆（已提升的 rules）+ 近期偏好（未提升的 candidates）。
 * - rules: 跨会话/失败教训/显式标记/单会话偏好已提升的规则
 * - candidates: 仅 type=user_preference 的未提升候选（fact/lesson 不注入，避免噪音）
 * userId 用于用户隔离：只注入该用户的记忆。不传时返回全部（向后兼容旧测试）。
 * 当两者都为空时返回空字符串。
 */
export function buildMemoryContext(userId?: string): string {
  const rules = getAllRules(userId)
  const candidates = getUnpromotedCandidates(userId)
    .filter(c => c.type === 'user_preference')
    .slice(0, MAX_RECENT_CANDIDATES)

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
