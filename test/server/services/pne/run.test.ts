// test/server/services/pne/run.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 全量 mock 子模块：planner 按 plans 队列出计划，executor 按 stages 脚本出结果，evaluator 按 decisions 队列出判定
const plans: Array<{ reasoning: string; stages: Array<Record<string, unknown>> }> = []
const stageOutcomes = new Map<number, string>()
const decisions: Array<{ decision: string; reason: string }> = []

vi.mock('../../../../server/src/services/pne/planner', () => ({
  planQuery: async function* () {
    const plan = plans.shift()
    if (!plan) throw new Error('plans exhausted')
    yield { type: 'thought', content: '【规划】' }
    return plan
  },
}))
vi.mock('../../../../server/src/services/pne/executor', () => ({
  executeStage: async (stage: { index: number; goal: string }) => {
    const outcome = stageOutcomes.get(stage.index) ?? `结果${stage.index}`
    return {
      events: [
        { type: 'action', tool_name: 'search', content: '{}', call_id: `c${stage.index}` },
        { type: 'observation', tool_name: 'search', content: outcome, call_id: `c${stage.index}`, duration_ms: 1, success: true },
      ],
      outcome,
    }
  },
}))
vi.mock('../../../../server/src/services/pne/evaluator', () => ({
  evaluateProgress: async () => {
    const d = decisions.shift()
    if (!d) throw new Error('decisions exhausted')
    return d
  },
}))
vi.mock('../../../../server/src/services/pne/synthesizer', () => ({
  synthesizeAnswer: async function* () {
    yield { type: 'content_delta', content: '最终回答' }
    yield { type: 'done' }
  },
}))
vi.mock('../../../../server/src/tools', () => ({
  tools: [],
  lcTools: [],
}))
vi.mock('../../../../server/src/services/tool-adapter', () => ({
  wrapAllTools: () => [],
}))

import { findReadyStages, runPneAgent } from '../../../../server/src/services/pne/run'
import type { ExecutionPlan, StageStatus } from '../../../../server/src/services/pne/types'

function planOf(stages: Array<{ index: number; goal?: string; strategy?: string; dependsOn?: number[] }>): ExecutionPlan {
  return {
    reasoning: 'r',
    stages: stages.map((s, i) => ({
      index: s.index,
      goal: s.goal ?? `g${s.index}`,
      strategy: (s.strategy ?? 'tool') as 'tool',
      dependsOn: s.dependsOn ?? [],
    })),
  }
}

function statusesOf(plan: ExecutionPlan, init: StageStatus = 'pending'): Map<number, StageStatus> {
  return new Map(plan.stages.map(s => [s.index, init]))
}

async function collect(options: { history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> } = {}) {
  const events: Array<Record<string, unknown>> = []
  for await (const ev of runPneAgent(
    options.history ?? [{ role: 'user', content: 'q' }],
    {}
  )) {
    events.push(ev as Record<string, unknown>)
  }
  return events
}

const lastPlan = (events: Array<Record<string, unknown>>) =>
  [...events].reverse().find(e => e.type === 'plan') as { stages: Array<Record<string, unknown>> }

beforeEach(() => {
  plans.length = 0
  decisions.length = 0
  stageOutcomes.clear()
})

describe('findReadyStages', () => {
  it('无依赖阶段 ready，未满足依赖的阶段不 ready', () => {
    const plan = planOf([
      { index: 1, dependsOn: [] },
      { index: 2, dependsOn: [1] },
      { index: 3, dependsOn: [2] },
    ])
    const statuses = statusesOf(plan)
    expect(findReadyStages(plan, statuses).map(s => s.index)).toEqual([1])
    statuses.set(1, 'done')
    expect(findReadyStages(plan, statuses).map(s => s.index)).toEqual([2])
    statuses.set(2, 'done')
    expect(findReadyStages(plan, statuses).map(s => s.index)).toEqual([3])
  })

  it('running/done/skipped 阶段不再 ready', () => {
    const plan = planOf([{ index: 1 }, { index: 2 }])
    const statuses = statusesOf(plan)
    statuses.set(1, 'running')
    statuses.set(2, 'skipped')
    expect(findReadyStages(plan, statuses)).toHaveLength(0)
  })
})

describe('runPneAgent', () => {
  it('串行依赖:阶段逐批执行,事件序列含 plan/action/observation/evaluation', async () => {
    plans.push(planOf([{ index: 1 }, { index: 2, dependsOn: [1] }]))
    decisions.push({ decision: 'continue', reason: '等阶段2' }, { decision: 'achieved', reason: '够了' })

    const events = await collect()

    const plans1 = events.filter(e => e.type === 'plan')
    // 初始快照 + running/done 快照x2 + achieved 快照 >= 4
    expect(plans1.length).toBeGreaterThanOrEqual(4)
    expect(events.some(e => e.type === 'action' && (e as { call_id?: string }).call_id === 'c1')).toBe(true)
    expect(events.filter(e => e.type === 'evaluation')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    // 最终快照:阶段1、2 均 done(阶段2 在 achieved 判定前已执行;achieved 仅 skip pending 阶段)
    const final = lastPlan(events)
    expect(final.stages[0]).toMatchObject({ status: 'done' })
    expect(final.stages[1]).toMatchObject({ status: 'done' })
  })

  it('无依赖阶段同批并行执行', async () => {
    plans.push(planOf([{ index: 1 }, { index: 2 }]))
    decisions.push({ decision: 'achieved', reason: '够' })
    const events = await collect()
    // 两个 action 都发出（同批），4 帧：initial + running + done + achieved 后（无 pending 可 skip，快照内容不变）
    const planFrames = events.filter(e => e.type === 'plan')
    expect(planFrames.length).toBe(4)
    expect(events.filter(e => e.type === 'action')).toHaveLength(2)
  })

  it('replan:第 3 次 replan 决策触发强制汇总,旧结果保留,不超过上限 2 次实际 replan', async () => {
    plans.push(planOf([{ index: 1 }]))
    plans.push(planOf([{ index: 1 }, { index: 2 }]))
    plans.push(planOf([{ index: 1 }]))
    decisions.push({ decision: 'replan', reason: '方向错' }, { decision: 'replan', reason: '还是错' }, { decision: 'replan', reason: '第三次仍错' })
    const events = await collect()
    // 前 2 次 replan 允许回 Planner,第 3 个 replan 决策后 replanCount=3 > MAX_REPLAN=2 -> 强制汇总
    expect(events.filter(e => e.type === 'plan').length).toBeGreaterThanOrEqual(4)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(events.some(e => e.type === 'content_delta' && e.content === '最终回答')).toBe(true)
  })

  it('依赖死锁:无 ready 阶段时 pending 标 skipped 并汇总', async () => {
    // 计划里 index 2 依赖 99，parsePlan 会丢弃该依赖——直接构造绕过 parsePlan 的场景:
    // 阶段 2 依赖阶段 1,而 planner 第二轮计划只含阶段 2(stageResults 为空时 ready 为空)
    plans.push(planOf([{ index: 2, dependsOn: [1] }])) // stages 里没有 index 1 -> 依赖永远不满足
    const events = await collect()
    const final = lastPlan(events)
    expect(final.stages[0]).toMatchObject({ status: 'skipped' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('stuck:直接汇总,不 skip pending', async () => {
    plans.push(planOf([{ index: 1 }, { index: 2 }]))
    decisions.push({ decision: 'stuck', reason: '反复失败' })
    const events = await collect()
    const final = lastPlan(events)
    // stuck 不触发 skip 标记(只有 achieved 才 skip)
    expect(final.stages[1]).toMatchObject({ status: 'done' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('planner 抛错 -> 异常上抛(由 runComplex 捕获回退 ReAct)', async () => {
    // plans 为空 -> planQuery mock 抛 'plans exhausted'
    await expect(collect()).rejects.toThrow('plans exhausted')
  })
})
