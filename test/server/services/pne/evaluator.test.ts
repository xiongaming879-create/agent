// test/server/services/pne/evaluator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../server/src/services/llm-caller', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../../../server/src/services/llm-caller'
import { evaluateProgress } from '../../../../server/src/services/pne/evaluator'
import type { ExecutionPlan } from '../../../../server/src/services/pne/types'

const callLLMMock = vi.mocked(callLLM)

const plan: ExecutionPlan = {
  reasoning: 'r',
  stages: [{ index: 1, goal: 'g', strategy: 'tool', dependsOn: [] }],
}

describe('evaluateProgress', () => {
  beforeEach(() => {
    callLLMMock.mockReset()
  })

  it.each(['continue', 'achieved', 'replan', 'stuck'] as const)('%s 合法输出 -> 解析判定与原因', async (decision) => {
    callLLMMock.mockResolvedValue(`${decision}|原因说明`)
    const result = await evaluateProgress('q', plan, [])
    expect(result).toEqual({ decision, reason: '原因说明' })
  })

  it('容忍大小写与前后空白', async () => {
    callLLMMock.mockResolvedValue('  Achieved | 已经足够 ')
    const result = await evaluateProgress('q', plan, [])
    expect(result.decision).toBe('achieved')
    expect(result.reason).toBe('已经足够')
  })

  it('多行输出取第一个含判定词的行', async () => {
    callLLMMock.mockResolvedValue('分析如下：\nachieved|信息已足够')
    const result = await evaluateProgress('q', plan, [])
    expect(result.decision).toBe('achieved')
  })

  it('非法输出 -> 抛错（触发上层回退）', async () => {
    callLLMMock.mockResolvedValue('我觉得还行')
    await expect(evaluateProgress('q', plan, [])).rejects.toThrow('非法')
  })

  it('reason 含竖线不截断', async () => {
    callLLMMock.mockResolvedValue('stuck|原因A|原因B')
    const result = await evaluateProgress('q', plan, [])
    expect(result.reason).toBe('原因A|原因B')
  })
})