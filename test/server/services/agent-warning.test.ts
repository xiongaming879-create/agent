import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../server/src/services/query-router', () => ({
  runRoutedAgent: vi.fn(),
}))

import { runAgent, JUDGE_TIMEOUT_MS } from '../../../server/src/services/agent'
import type { AgentEvent } from '../../../server/src/types'

async function* mockRoutedAgent(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event
  }
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) {
    events.push(event)
  }
  return events
}

describe('runAgent 后置校验 warning 事件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validateAnswer 校验失败时 yield warning 事件', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'observation', content: '搜索结果：今天是晴天' },
        { type: 'content_delta', content: '今天是雨天' },
        { type: 'done' },
      ])
    )

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '否\n回答中的天气与观察数据不符' } }],
      }),
    }) as typeof fetch

    const events = await collectEvents(
      runAgent([{ role: 'user', content: '今天天气' }], [], { complexity: 'medium' })
    )

    const warning = events.find(e => e.type === 'warning')
    expect(warning).toBeDefined()
    expect(warning!.type === 'warning').toBe(true)
    if (warning!.type === 'warning') {
      expect(warning!.content).toContain('天气与观察数据不符')
    }
  })

  it('validateAnswer 校验通过时不 yield warning', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'observation', content: '搜索结果：今天是晴天' },
        { type: 'content_delta', content: '今天是晴天' },
        { type: 'done' },
      ])
    )

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '是' } }],
      }),
    }) as typeof fetch

    const events = await collectEvents(
      runAgent([{ role: 'user', content: '今天天气' }], [], { complexity: 'medium' })
    )

    expect(events.find(e => e.type === 'warning')).toBeUndefined()
  })

  it('validateAnswer API 失败时不 yield warning(fallback valid: true)', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'observation', content: '搜索结果' },
        { type: 'content_delta', content: '回答内容' },
        { type: 'done' },
      ])
    )

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof fetch

    const events = await collectEvents(
      runAgent([{ role: 'user', content: 'test' }], [], { complexity: 'medium' })
    )

    expect(events.find(e => e.type === 'warning')).toBeUndefined()
  })

  it('无 observation 时不触发校验,不 yield warning', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'content_delta', content: '你好！' },
        { type: 'done' },
      ])
    )

    const events = await collectEvents(
      runAgent([{ role: 'user', content: '你好' }], [], { complexity: 'medium' })
    )

    expect(events.find(e => e.type === 'warning')).toBeUndefined()
  })

  it('validateAnswer 超时时不 yield warning,流正常结束', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'observation', content: '搜索结果' },
        { type: 'content_delta', content: '回答内容' },
        { type: 'done' },
      ])
    )

    // fetch 挂起直到 abort,模拟校验器迟迟不返回
    global.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        )
      })
    ) as typeof fetch

    vi.useFakeTimers()
    try {
      const eventsPromise = collectEvents(
        runAgent([{ role: 'user', content: 'test' }], [], { complexity: 'medium' })
      )
      await vi.advanceTimersByTimeAsync(JUDGE_TIMEOUT_MS + 1)
      const events = await eventsPromise

      expect(events.find(e => e.type === 'warning')).toBeUndefined()
      expect(events.at(-1)?.type).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('warning 事件在 done 之前 yield', async () => {
    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    vi.mocked(runRoutedAgent).mockReturnValue(
      mockRoutedAgent([
        { type: 'observation', content: '结果' },
        { type: 'content_delta', content: '回答' },
        { type: 'done' },
      ])
    )

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '否\n编造了数据' } }],
      }),
    }) as typeof fetch

    const events = await collectEvents(
      runAgent([{ role: 'user', content: 'test' }], [], { complexity: 'medium' })
    )

    const warningIdx = events.findIndex(e => e.type === 'warning')
    const doneIdx = events.findIndex(e => e.type === 'done')
    expect(warningIdx).toBeGreaterThanOrEqual(0)
    expect(doneIdx).toBeGreaterThan(warningIdx)
  })
})
