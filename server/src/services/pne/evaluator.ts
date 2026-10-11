// server/src/services/pne/evaluator.ts
import { callLLM } from '../llm-caller'
import { MODEL_LIGHT } from '../llm-config'
import { loadPrompt, renderPrompt } from '../prompt-loader'
import { formatStageResults, type ExecutionPlan, type StageResult } from './types'

export type PneDecision = 'continue' | 'achieved' | 'replan' | 'stuck'

const DECISIONS: readonly PneDecision[] = ['continue', 'achieved', 'replan', 'stuck']

function formatPlanStages(plan: ExecutionPlan): string {
  return plan.stages
    .map(s => `${s.index}. ${s.goal} [${s.strategy}${s.dependsOn.length ? ` 依赖${s.dependsOn.join(',')}` : ''}]`)
    .join('\n')
}

/** Evaluator：判定 continue/achieved/replan/stuck。输出非法抛错，由上层回退。 */
export async function evaluateProgress(
  query: string,
  plan: ExecutionPlan,
  stageResults: StageResult[]
): Promise<{ decision: PneDecision; reason: string }> {
  const system = renderPrompt(loadPrompt('pne/evaluator'), {
    query,
    planStages: formatPlanStages(plan),
    stageResults: formatStageResults(stageResults),
  })
  const raw = await callLLM(
    [{ role: 'user', content: '请评估当前执行状态。' }],
    system,
    MODEL_LIGHT,
    300
  )

  const line = raw
    .split('\n')
    .map(l => l.trim())
    .find(l => DECISIONS.some(d => l.toLowerCase().startsWith(d)))
  if (!line) throw new Error(`Evaluator 输出非法: ${raw.slice(0, 100)}`)

  const [word, ...rest] = line.split('|')
  const decision = word.trim().toLowerCase()
  if (!DECISIONS.includes(decision as PneDecision)) {
    throw new Error(`Evaluator 判定词非法: ${line.slice(0, 100)}`)
  }
  return { decision: decision as PneDecision, reason: rest.join('|').trim() }
}