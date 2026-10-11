// test/server/services/query-router-pne.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 重量级/外部位移依赖：与现有 query-router.test.ts 风格一致
// 加上 PnE 的 gate 与 run，使 runComplex 分流分支可控
vi.mock('../../../server/src/services/memory-recall', () => ({
  buildMemoryContext: () => '',
}))

vi.mock('../../../server/src/services/langchain-adapter', () => ({
  langchainAgentRunner: async function* () {
    yield { type: 'content_delta', content: 'ReAct 回答' } as const
    yield { type: 'done' } as const
  },
}))

const pneGateResult = vi.fn<() => Promise<boolean>>()
vi.mock('../../../server/src/services/pne/gate', () => ({
  shouldUsePne: (...args: unknown[]) => pneGateResult(...(args as [])),
}))

const pneRunBehavior = {
  mode: 'events' as 'events' | 'throw-before-content' | 'throw-after-content',
}
vi.mock('../../../server/src/services/pne/run', () => ({
  runPneAgent: async function* (): AsyncGenerator<{ type: string; content?: string; stages?: unknown[] }> {
    if (pneRunBehavior.mode === 'throw-before-content') {
      yield { type: 'thought', content: '【PnE】规划中' }
      throw new Error('PnE 崩了')
    }
    if (pneRunBehavior.mode === 'throw-after-content') {
      yield { type: 'content_delta', content: 'PnE 部分回答' }
      throw new Error('PnE 中途崩了')
    }
    yield { type: 'plan', stages: [{ index: 1, goal: 'g1', strategy: 'tool', dependsOn: [], status: 'pending' }] }
    yield { type: 'content_delta', content: 'PnE 回答' }
    yield { type: 'done' }
  },
}))

import { runRoutedAgent } from '../../../server/src/services/query-router'

async function collect(query: string, complexity: 'deep' | 'medium' | 'fast'): Promise<Array<{ type: string; content?: string }>> {
  const events: Array<{ type: string; content?: string }> = []
  for await (const ev of runRoutedAgent([{ role: 'user', content: query }], { complexity })) {
    events.push(ev as { type: string; content?: string })
  }
  return events
}

beforeEach(() => {
  pneGateResult.mockReset()
  pneRunBehavior.mode = 'events'
})

describe('runComplex PnE 二级分流', () => {
  it('gate=true → PnE 事件透传，不进入 ReAct', async () => {
    pneGateResult.mockResolvedValue(true)

    const events = await collect('对比 React 和 Vue 的状态管理', 'deep')

    expect(events.some(e => e.type === 'plan')).toBe(true)
    expect(events.some(e => e.type === 'content_delta' && e.content === 'PnE 回答')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(events.some(e => e.type === 'content_delta' && e.content === 'ReAct 回答')).toBe(false)
  })

  it('gate=true + PnE 输出正文前抛错 → 回退 ReAct', async () => {
    pneGateResult.mockResolvedValue(true)
    pneRunBehavior.mode = 'throw-before-content'

    const events = await collect('对比 React 和 Vue 的状态管理', 'deep')

    expect(events.some(e => e.type === 'thought' && (e.content ?? '').includes('回退 ReAct'))).toBe(true)
    expect(events.some(e => e.type === 'content_delta' && e.content === 'ReAct 回答')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('gate=true + PnE 输出正文后抛错 → 不回退，thought + done', async () => {
    pneGateResult.mockResolvedValue(true)
    pneRunBehavior.mode = 'throw-after-content'

    const events = await collect('对比 React 和 Vue 的状态管理', 'deep')

    expect(events.some(e => e.type === 'content_delta' && e.content === 'PnE 部分回答')).toBe(true)
    expect(events.some(e => e.type === 'thought' && (e.content ?? '').includes('执行中断'))).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(events.some(e => e.type === 'content_delta' && e.content === 'ReAct 回答')).toBe(false)
  })

  it('gate=false → 直接走 ReAct，无 PnE 事件', async () => {
    pneGateResult.mockResolvedValue(false)

    const events = await collect('对比 React 和 Vue 的状态管理', 'medium')

    expect(events.some(e => e.type === 'plan')).toBe(false)
    expect(events.some(e => e.type === 'content_delta' && e.content === 'ReAct 回答')).toBe(true)
  })
})
