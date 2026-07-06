import { getAllRules } from '../db/memory-db'

const LABEL_MAP: Record<string, string> = {
  user_preference_rule: '用户偏好',
  project_rule: '项目规则',
  stable_fact: '稳定事实',
}

/**
 * 从 memory_rules 表读取所有规则，构建 system prompt 追加内容。
 * 当没有规则时返回空字符串。
 */
export function buildMemoryContext(): string {
  const rules = getAllRules()
  if (rules.length === 0) return ''

  const lines = rules.map(r => {
    const label = LABEL_MAP[r.kind] || r.kind
    return `- [${label}] ${r.rule}`
  })

  return `## 长期记忆（基于历史会话总结的规则）\n${lines.join('\n')}\n`
}
