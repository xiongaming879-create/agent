import { callLLM } from '../llm-caller'
import { MODEL_LIGHT, type Complexity } from '../llm-config'

/** 规划信号词（与 ARCHITECTURE.md §3.1 判据表一致） */
const PNE_SIGNAL = /(对比|分析|方案|规划|步骤|制定|策划|评估)/
const PNE_LENGTH_THRESHOLD = 120

const PNE_LLM_PROMPT =
  '判断该问题是否需要多阶段（规划→分步执行→汇总）处理。多阶段问题如：多条件对比分析、多信息源汇总、方案制定。单一信息可答的问题输出 no。只输出 yes 或 no。'

/** 纯规则判据：deep 强制 PnE；长问题或含规划信号词走 PnE */
export function shouldUsePneByRules(query: string, complexity: Complexity): boolean {
  if (complexity === 'deep') return true
  if (query.length > PNE_LENGTH_THRESHOLD) return true
  return PNE_SIGNAL.test(query)
}

/** 完整判据：规则优先，未命中时 LLM 轻判兜底。LLM 失败视为不需要（回退 ReAct 更安全）。 */
export async function shouldUsePne(query: string, complexity: Complexity): Promise<boolean> {
  if (shouldUsePneByRules(query, complexity)) return true
  try {
    const result = await callLLM(
      [{ role: 'user', content: `用户问题: "${query}"` }],
      PNE_LLM_PROMPT,
      MODEL_LIGHT,
      20
    )
    return /yes/i.test(result)
  } catch {
    return false
  }
}