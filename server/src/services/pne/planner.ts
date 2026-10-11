// server/src/services/pne/planner.ts
import type { AgentEvent } from '../../types'
import { callLLM, extractFirstJsonObject, stripMarkdownCodeFence } from '../llm-caller'
import { MODEL_STRONG } from '../llm-config'
import { loadPrompt, renderPrompt } from '../prompt-loader'
import { buildDateContext } from '../knowledge'
import { parsePlan, formatStageResults, type StageResult, type PneChatMessage } from './types'

const PLANNER_MAX_TOKENS = 2000

/** 把对话历史压成文本（取最近 6 条，防 prompt 膨胀） */
function formatHistory(history: PneChatMessage[]): string {
  const recent = history.slice(-6)
  if (recent.length === 0) return '（无）'
  return recent.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join('\n')
}

/**
 * Planner：query + 已完成阶段结果 → ExecutionPlan。
 * 解析失败抛错，由 runPneAgent 上抛触发 ReAct 回退。
 */
export async function* planQuery(
  query: string,
  stageResults: StageResult[],
  history: PneChatMessage[],
  toolList: string
): AsyncGenerator<AgentEvent, ExecutionPlan> {
  yield { type: 'thought', content: stageResults.length === 0 ? '【规划】正在拆解任务...' : '【规划】重新规划中...' }

  const system = renderPrompt(loadPrompt('pne/planner'), {
    toolList: toolList || '（无可用工具）',
    dateContext: buildDateContext(),
    stageResults: formatStageResults(stageResults),
    history: formatHistory(history),
    query,
  })

  const raw = await callLLM(
    [{ role: 'user', content: `用户问题：${query}` }],
    system,
    MODEL_STRONG,
    PLANNER_MAX_TOKENS
  )

  const json = extractFirstJsonObject(stripMarkdownCodeFence(raw))
  if (!json) throw new Error(`Planner 输出中未找到 JSON: ${raw.slice(0, 100)}`)
  return parsePlan(json)
}