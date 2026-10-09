// server/src/services/pne/types.ts
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped'
export type StageStrategy = 'tool' | 'reasoning' | 'hybrid'

export interface Stage {
  index: number
  goal: string
  strategy: StageStrategy
  toolHint?: string
  toolArgs?: string
  dependsOn: number[]
}

export interface ExecutionPlan {
  reasoning: string
  stages: Stage[]
}

export interface StageResult {
  index: number
  goal: string
  outcome: string
}

/** 与 llm-caller 的 ChatMessage 结构一致（该类型未导出，此处镜像定义） */
export interface PneChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export const MAX_STAGES = 5

/** 解析并防御性归一 Planner 输出。非法结构抛错，由上层回退 ReAct。 */
export function parsePlan(json: string): ExecutionPlan {
  const data = JSON.parse(json) as { reasoning?: unknown; stages?: unknown }
  if (!Array.isArray(data.stages) || data.stages.length === 0) {
    throw new Error('计划缺少有效 stages')
  }
  if (data.stages.length > MAX_STAGES) {
    throw new Error(`阶段数 ${data.stages.length} 超上限 ${MAX_STAGES}`)
  }
  const stages: Stage[] = data.stages.map((s, i) => {
    const st = s as Record<string, unknown>
    if (typeof st.goal !== 'string' || !st.goal.trim()) {
      throw new Error(`阶段 ${i + 1} 缺 goal`)
    }
    const index = typeof st.index === 'number' ? st.index : i + 1
    const strategy: StageStrategy =
      st.strategy === 'reasoning' || st.strategy === 'hybrid' ? st.strategy : 'tool'
    const dependsOn = Array.isArray(st.dependsOn)
      ? st.dependsOn.filter((d): d is number => typeof d === 'number' && d !== index)
      : []
    return {
      index,
      goal: st.goal,
      strategy,
      toolHint: typeof st.toolHint === 'string' && st.toolHint.trim() ? st.toolHint : undefined,
      toolArgs: typeof st.toolArgs === 'string' && st.toolArgs.trim() ? st.toolArgs : undefined,
      dependsOn,
    }
  })
  // 依赖指向不存在的阶段 -> 丢弃，防死锁
  const indexes = new Set(stages.map(s => s.index))
  for (const s of stages) {
    s.dependsOn = s.dependsOn.filter(d => indexes.has(d))
  }
  return { reasoning: typeof data.reasoning === 'string' ? data.reasoning : '', stages }
}

/** 阶段结果格式化为文本块（Planner/Evaluator/Executor/Synthesizer 共用） */
export function formatStageResults(results: StageResult[]): string {
  if (results.length === 0) return '（尚无已完成阶段）'
  return results
    .map(r => `阶段 ${r.index}. ${r.goal}\n结果：${r.outcome}`)
    .join('\n\n')
}