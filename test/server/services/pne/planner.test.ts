import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../server/src/services/llm-caller', async () => {
  const actual = await vi.importActual<typeof import('../../../../server/src/services/llm-caller')>(
    '../../../../server/src/services/llm-caller'
  )
  return {
    callLLM: vi.fn(),
    extractFirstJsonObject: actual.extractFirstJsonObject,
    stripMarkdownCodeFence: actual.stripMarkdownCodeFence,
  }
})

import { callLLM } from '../../../../server/src/services/llm-caller'
import { planQuery } from '../../../../server/src/services/pne/planner'

const callLLMMock = vi.mocked(callLLM)

async function collect(gen: AsyncGenerator<unknown, string, unknown>) {
  const events: unknown[] = []
  let result = ''
  while (true) {
    const { value, done } = await gen.next()
    if (done) { result = value; break }
    events.push(value)
  }
  return { events, result }
}

describe('planQuery', () => {
  beforeEach(() => {
    callLLMMock.mockReset()
  })

  it('yield 一条 thought 事件 + 返回解析后的计划', async () => {
    callLLMMock.mockResolvedValue(JSON.stringify({
      reasoning: '先查后汇总',
      stages: [{ index: 1, goal: '查数据', strategy: 'tool', dependsOn: [] }],
    }))
    const { events, result } = await collect(planQuery('对比A和B', [], [], '- search - 搜索'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'thought' })
    expect(result.stages[0]).toMatchObject({ goal: '查数据', strategy: 'tool' })
  })

  it('LLM 返回带 markdown 围栏/前后说明文字的 JSON 也能解析', async () => {
    callLLMMock.mockResolvedValue('好的，以下是计划：\n```json\n{"stages":[{"goal":"g","dependsOn":[]}]}\n```')
    const { result } = await collect(planQuery('q', [], [], ''))
    expect(result.stages).toHaveLength(1)
  })

  it('LLM 输出非法 JSON -> 抛错', async () => {
    callLLMMock.mockResolvedValue('我无法生成计划')
    await expect(collect(planQuery('q', [], [], ''))).rejects.toThrow()
  })

  it('重规划时 stageResults 注入 prompt', async () => {
    callLLMMock.mockResolvedValue('{"stages":[{"goal":"g","dependsOn":[]}]}')
    await collect(planQuery('q', [{ index: 1, goal: '旧阶段', outcome: '旧结果' }], [], ''))
    const passed = callLLMMock.mock.calls[0]
    expect(JSON.stringify(passed)).toContain('旧结果')
  })
})