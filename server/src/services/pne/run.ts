// server/src/services/pne/run.ts
import type { AgentEvent, PlanStageSnapshot } from '../../types'
import type { Complexity } from '../llm-config'
import { wrapAllTools } from '../tool-adapter'
import { planQuery } from './planner'
import { executeStage } from './executor'
import { evaluateProgress, type PneDecision } from './evaluator'
import { synthesizeAnswer } from './synthesizer'
import type { ExecutionPlan, Stage, StageResult, StageStatus, PneChatMessage } from './types'
import { tools as allTools, lcTools as nativeLcTools } from '../../tools'
import { logAgentError } from '../logger'

export const MAX_REPLAN = 2

export interface PneOptions {
  systemPrompt?: string
  complexity?: Complexity
  userId?: string
  conversationId?: string
}

/** 拓扑调度：依赖全部 done 且自身 pending 的阶段为 ready 批次 */
export function findReadyStages(plan: ExecutionPlan, statuses: Map<number, StageStatus>): Stage[] {
  return plan.stages.filter(
    s =>
      (statuses.get(s.index) ?? 'pending') === 'pending' &&
      s.dependsOn.every(d => statuses.get(d) === 'done')
  )
}

function snapshot(
  plan: ExecutionPlan,
  statuses: Map<number, StageStatus>,
  stageResults: StageResult[]
): PlanStageSnapshot[] {
  return plan.stages.map(s => {
    const result = stageResults.find(r => r.index === s.index && r.goal === s.goal)
    return {
      index: s.index,
      goal: s.goal,
      strategy: s.strategy,
      status: statuses.get(s.index) ?? 'pending',
      dependsOn: s.dependsOn,
      outcome: result?.outcome,
    }
  })
}

function getLastUserQuery(messages: PneChatMessage[]): string {
  return [...messages].reverse().find(m => m.role === 'user')?.content || ''
}

/**
 * Plan-and-Execute 主编排。
 * 任何异常向上抛出，由 runComplex 捕获后回退 ReAct。
 */
export async function* runPneAgent(
  messages: PneChatMessage[],
  options: PneOptions
): AsyncGenerator<AgentEvent> {
  const query = getLastUserQuery(messages)
  const lcTools = wrapAllTools(allTools, nativeLcTools)
  const toolList = lcTools.map(t => `- ${t.name} - ${t.description}`).join('\n')
  const logCtx = { conversationId: options.conversationId, userId: options.userId }

  const stageResults: StageResult[] = []
  let lastPlanFrame = ''
  const yieldPlanFrame = function* (
    plan: ExecutionPlan,
    statuses: Map<number, StageStatus>
  ): Generator<AgentEvent> {
    const stages = snapshot(plan, statuses, stageResults)
    const json = JSON.stringify(stages)
    if (json === lastPlanFrame) return
    lastPlanFrame = json
    yield { type: 'plan', stages }
  }
  let replanCount = 0

  try {
    while (true) {
      const plan = yield* planQuery(query, stageResults, messages, toolList)
      const statuses = new Map<number, StageStatus>(plan.stages.map(s => [s.index, 'pending' as const]))
      yield* yieldPlanFrame(plan, statuses)

      let decision: PneDecision = 'continue'
      let deadlock = false

      while (true) {
        const ready = findReadyStages(plan, statuses)
        if (ready.length === 0) {
          const pending = plan.stages.filter(s => statuses.get(s.index) === 'pending')
          if (pending.length > 0) {
            deadlock = true
            for (const s of pending) statuses.set(s.index, 'skipped')
            yield* yieldPlanFrame(plan, statuses)
            yield { type: 'thought', content: `【计划】${pending.length} 个阶段存在未满足的依赖，跳过` }
          }
          break
        }

        for (const s of ready) statuses.set(s.index, 'running')
        yield* yieldPlanFrame(plan, statuses)

        // 无依赖阶段同批并行；事件缓冲到批次结束统一回放
        const batch = await Promise.all(
          ready.map(stage =>
            executeStage(stage, {
              tools: lcTools,
              stageResults,
              query,
              userId: options.userId,
              conversationId: options.conversationId,
            })
          )
        )
        for (const r of batch) {
          for (const ev of r.events) yield ev
        }
        for (let i = 0; i < ready.length; i++) {
          statuses.set(ready[i].index, 'done')
          stageResults.push({ index: ready[i].index, goal: ready[i].goal, outcome: batch[i].outcome })
        }
        yield* yieldPlanFrame(plan, statuses)

        const evaluation = await evaluateProgress(query, plan, stageResults)
        yield { type: 'evaluation', decision: evaluation.decision, reason: evaluation.reason }
        decision = evaluation.decision

        if (decision !== 'continue') break
      }

      if (deadlock || decision === 'achieved' || decision === 'stuck') {
        if (decision === 'achieved') {
          for (const s of plan.stages) {
            if (statuses.get(s.index) === 'pending') statuses.set(s.index, 'skipped')
          }
          yield* yieldPlanFrame(plan, statuses)
        }
        break
      }

      // decision === 'replan'
      replanCount++
      if (replanCount > MAX_REPLAN) {
        yield { type: 'thought', content: `【计划】replan 已达上限 ${MAX_REPLAN} 次，基于已有结果汇总` }
        break
      }
    }

    yield* synthesizeAnswer(query, stageResults, messages, options.systemPrompt)
  } catch (err) {
    logAgentError({
      ...logCtx,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    throw err
  }
}
