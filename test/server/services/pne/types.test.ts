import { describe, it, expect } from 'vitest'
import {
  parsePlan, formatStageResults, MAX_STAGES,
  type StageResult,
} from '../../../../server/src/services/pne/types'

describe('parsePlan', () => {
  it('合法 JSON 解析为 ExecutionPlan', () => {
    const plan = parsePlan(JSON.stringify({
      reasoning: '先查数据再汇总',
      stages: [
        { index: 1, goal: '查天气', strategy: 'tool', toolHint: 'search', dependsOn: [] },
        { index: 2, goal: '汇总行程', strategy: 'reasoning', dependsOn: [1] },
      ],
    }))
    expect(plan.reasoning).toBe('先查数据再汇总')
    expect(plan.stages).toHaveLength(2)
    expect(plan.stages[0]).toMatchObject({ index: 1, goal: '查天气', strategy: 'tool', dependsOn: [] })
    expect(plan.stages[1]).toMatchObject({ index: 2, strategy: 'reasoning', dependsOn: [1] })
  })

  it('缺 index 自动按序号补齐,非法 strategy 归一为 tool', () => {
    const plan = parsePlan(JSON.stringify({
      stages: [
        { goal: 'a', strategy: 'whatever', dependsOn: [] },
        { goal: 'b' },
      ],
    }))
    expect(plan.stages[0]).toMatchObject({ index: 1, strategy: 'tool' })
    expect(plan.stages[1]).toMatchObject({ index: 2, strategy: 'tool', dependsOn: [] })
  })

  it('缺 stages / 空 stages / goal 缺失 -> 抛错', () => {
    expect(() => parsePlan('{"stages": []}')).toThrow()
    expect(() => parsePlan('{"reasoning": "x"}')).toThrow()
    expect(() => parsePlan(JSON.stringify({ stages: [{ strategy: 'tool', dependsOn: [] }] }))).toThrow('goal')
  })

  it(`阶段数超过 ${MAX_STAGES} -> 抛错`, () => {
    const stages = Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({
      index: i + 1, goal: `g${i}`, strategy: 'tool', dependsOn: [],
    }))
    expect(() => parsePlan(JSON.stringify({ stages }))).toThrow('上限')
  })

  it('依赖指向不存在阶段/自身 -> 丢弃该依赖', () => {
    const plan = parsePlan(JSON.stringify({
      stages: [
        { index: 1, goal: 'a', strategy: 'tool', dependsOn: [99, 1] },
      ],
    }))
    expect(plan.stages[0].dependsOn).toEqual([])
  })

  it('非法 JSON -> 抛错', () => {
    expect(() => parsePlan('not json')).toThrow()
  })
})

describe('formatStageResults', () => {
  it('空结果输出占位提示', () => {
    expect(formatStageResults([])).toContain('尚无')
  })

  it('按阶段序号列出 goal + outcome', () => {
    const results: StageResult[] = [
      { index: 1, goal: '查天气', outcome: '晴 31°C' },
      { index: 2, goal: '查汇率', outcome: '0.14' },
    ]
    const text = formatStageResults(results)
    expect(text).toContain('1. 查天气')
    expect(text).toContain('晴 31°C')
    expect(text).toContain('2. 查汇率')
  })
})