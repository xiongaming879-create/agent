import { describe, it, expect } from 'vitest'
import { groupThoughtSteps, type PlanStageView } from '../../../client/src/utils/thoughtGroup'
import type { ThoughtStep } from '../../../client/src/types'

const STAGES: PlanStageView[] = [
  { index: 1, goal: '查天气', strategy: 'tool', status: 'done', dependsOn: [], outcome: '晴 31°C' },
  { index: 2, goal: '规划行程', strategy: 'reasoning', status: 'running', dependsOn: [1] },
]

function planStep(stages: PlanStageView[]): ThoughtStep {
  return { type: 'plan', content: JSON.stringify(stages), tool_name: null, timestamp: 't' }
}

describe('groupThoughtSteps: plan 步骤', () => {
  it("type==='plan' -> kind:'plan' 条目，stages 快照完整", () => {
    const items = groupThoughtSteps([planStep(STAGES)])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'plan', stages: STAGES })
  })

  it('plan 与 note/round 混排时位置保留', () => {
    const items = groupThoughtSteps([
      { type: 'thought', content: '开始处理', tool_name: null, timestamp: 't' },
      planStep(STAGES),
      { type: 'action', content: '{}', tool_name: 'search', timestamp: 't', call_id: 'c1' },
      { type: 'observation', content: '结果', tool_name: 'search', timestamp: 't', call_id: 'c1' },
    ])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ kind: 'note', content: '开始处理' })
    expect(items[1]).toMatchObject({ kind: 'plan' })
    expect(items[2]).toMatchObject({ kind: 'round', toolName: 'search' })
  })

  it('content 非法 JSON -> 降级为 note', () => {
    const items = groupThoughtSteps([
      { type: 'plan', content: '不是JSON', tool_name: null, timestamp: 't' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'note', content: '不是JSON' })
  })

  it('老数据无 plan 步骤 -> 输出与原逻辑一致（不产生 plan 条目）', () => {
    const items = groupThoughtSteps([
      { type: 'thought', content: '想法', tool_name: null, timestamp: 't' },
      { type: 'action', content: 'q', tool_name: 'search', timestamp: 't', call_id: 'c1' },
      { type: 'observation', content: 'r', tool_name: 'search', timestamp: 't', call_id: 'c1' },
    ])
    expect(items.every(i => i.kind !== 'plan')).toBe(true)
    expect(items).toHaveLength(1)
  })

  it("type==='evaluation' -> kind:'note' 条目，content 保留", () => {
    const items = groupThoughtSteps([
      { type: 'evaluation', content: '【计划评估】continue：第 1 步已完成', tool_name: null, timestamp: 't' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'note', content: '【计划评估】continue：第 1 步已完成' })
  })
})
