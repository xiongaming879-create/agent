import { describe, it, expect, vi } from 'vitest'
import {
  isSearchTypeTool,
  checkSearchEffectiveness,
  createSearchState,
  isToolOutputFailure,
  langchainAgentRunner,
} from '../../../server/src/services/langchain-adapter'

describe('langchain-adapter', () => {
  describe('isSearchTypeTool', () => {
    it('匹配 knowledge_search', () => {
      expect(isSearchTypeTool('knowledge_search')).toBe(true)
    })
    it('匹配 search', () => {
      expect(isSearchTypeTool('search')).toBe(true)
    })
    it('匹配 fetch', () => {
      expect(isSearchTypeTool('fetch')).toBe(true)
    })
    it('匹配 browser_navigate', () => {
      expect(isSearchTypeTool('browser_navigate')).toBe(true)
    })
    it('匹配 parallel_search', () => {
      expect(isSearchTypeTool('parallel_search')).toBe(true)
    })
    it('不匹配 calculator', () => {
      expect(isSearchTypeTool('calculator')).toBe(false)
    })
    it('不匹配 filesystem_read', () => {
      expect(isSearchTypeTool('filesystem_read')).toBe(false)
    })
  })

  describe('checkSearchEffectiveness', () => {
    it('非搜索类工具不停止', () => {
      const state = createSearchState()
      const result = checkSearchEffectiveness('calculator', '1+1', '2', state)
      expect(result.shouldStop).toBe(false)
      expect(state.searchCallCount).toBe(0)
      expect(state.knowledgeSearchCallCount).toBe(0)
    })

    it('knowledge_search 重复输入停止', () => {
      const state = createSearchState()
      checkSearchEffectiveness('knowledge_search', '违约金', 'result', state)
      const result = checkSearchEffectiveness('knowledge_search', '违约金', 'result', state)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('重复调用')
    })

    it('knowledge_search 超过 5 次停止', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        const result = checkSearchEffectiveness('knowledge_search', `query${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      const result = checkSearchEffectiveness('knowledge_search', 'query6', 'result', state)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('超过上限')
      expect(result.reason).toContain('5')
    })

    it('search 超过 25 次停止(不受 knowledge_search 上限影响)', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        checkSearchEffectiveness('knowledge_search', `kq${i}`, 'result', state)
      }
      for (let i = 0; i < 25; i++) {
        const result = checkSearchEffectiveness('search', `q${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      const result = checkSearchEffectiveness('search', 'q26', 'result', state)
      expect(result.shouldStop).toBe(true)
    })

    it('knowledge_search 和 search 计数独立', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        checkSearchEffectiveness('search', `q${i}`, 'result', state)
      }
      for (let i = 0; i < 5; i++) {
        const result = checkSearchEffectiveness('knowledge_search', `kq${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      expect(state.searchCallCount).toBe(5)
      expect(state.knowledgeSearchCallCount).toBe(5)
    })
    it('parallel_search 按批内条数计数', () => {
      const state = createSearchState()
      checkSearchEffectiveness('parallel_search', '{"queries":["a","b","c"]}', 'result', state)
      expect(state.searchCallCount).toBe(3)
    })

    it('parallel_search 非法输入按 1 计数', () => {
      const state = createSearchState()
      checkSearchEffectiveness('parallel_search', 'not-json', 'result', state)
      expect(state.searchCallCount).toBe(1)
    })

    it('parallel_search 混合并发时同样受 25 次上限约束', () => {
      const state = createSearchState()
      for (let i = 0; i < 4; i++) {
        checkSearchEffectiveness('parallel_search', `{"queries":["q${i}a","q${i}b","q${i}c","q${i}d","q${i}e","q${i}f"]}`, 'result', state)
      }
      // 4 批 x 6 条 = 24 次,再加一批 6 条 -> 30 > 25 停止
      const result = checkSearchEffectiveness('parallel_search', '{"queries":["a","b","c","d","e","f"]}', 'result', state)
      expect(state.searchCallCount).toBe(30)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('超过上限')
    })
  })

  describe('isSearchTypeTool - playwright 工具全覆盖', () => {
    it('匹配 browser_click', () => {
      expect(isSearchTypeTool('browser_click')).toBe(true)
    })
    it('匹配 browser_evaluate', () => {
      expect(isSearchTypeTool('browser_evaluate')).toBe(true)
    })
    it('匹配 browser_network_requests', () => {
      expect(isSearchTypeTool('browser_network_requests')).toBe(true)
    })
    it('匹配 browser_wait_for', () => {
      expect(isSearchTypeTool('browser_wait_for')).toBe(true)
    })
  })

  describe('isToolOutputFailure', () => {
    it('识别 Tool error 前缀', () => {
      expect(isToolOutputFailure('Tool error: something failed')).toBe(true)
    })
    it('识别超时', () => {
      expect(isToolOutputFailure('Request timeout after 10s')).toBe(true)
    })
    it('识别 <error> 标签（playwright MCP 格式）', () => {
      expect(isToolOutputFailure('<error>Timed out 30000ms waiting for selector</error>')).toBe(true)
    })
    it('识别 <error> 带属性', () => {
      expect(isToolOutputFailure('<error code="500">Internal error</error>')).toBe(true)
    })
    it('正常结果不误判', () => {
      expect(isToolOutputFailure('[1] 比赛结果摘要\nhttps://example.com')).toBe(false)
    })
  })

  describe('checkSearchEffectiveness - 近似重复检测', () => {
    it('连续 3 次无新关键词的搜索停止', () => {
      const state = createSearchState()
      checkSearchEffectiveness('search', '石宇奇 阿尤什 比分', 'result', state)
      expect(checkSearchEffectiveness('search', '阿尤什 石宇奇 比分', 'result', state).shouldStop).toBe(false)
      expect(checkSearchEffectiveness('search', '石宇奇 比分 阿尤什', 'result', state).shouldStop).toBe(false)
      const result = checkSearchEffectiveness('search', '比分 阿尤什 石宇奇', 'result', state)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('未引入新关键词')
    })

    it('引入新关键词会重置计数', () => {
      const state = createSearchState()
      checkSearchEffectiveness('search', '石宇奇 阿尤什', 'result', state)
      checkSearchEffectiveness('search', '阿尤什 石宇奇', 'result', state)
      // 引入新关键词"世锦赛"，重置
      expect(checkSearchEffectiveness('search', '石宇奇 阿尤什 世锦赛', 'result', state).shouldStop).toBe(false)
      expect(checkSearchEffectiveness('search', '世锦赛 石宇奇', 'result', state).shouldStop).toBe(false)
      expect(checkSearchEffectiveness('search', '石宇奇 世锦赛', 'result', state).shouldStop).toBe(false)
      const result = checkSearchEffectiveness('search', '阿尤什 世锦赛 石宇奇', 'result', state)
      expect(result.shouldStop).toBe(true)
    })

    it('非搜索类工具不影响关键词计数', () => {
      const state = createSearchState()
      checkSearchEffectiveness('search', '石宇奇 阿尤什', 'result', state)
      checkSearchEffectiveness('calculator', '1+1', '2', state)
      expect(state.noNewKeywordStreak).toBe(0)
    })
  })

  describe('langchainAgentRunner - recursionLimit 换算', () => {
    it('recursionLimit 是 maxIterations 的 2 倍（每轮 = agent + tools 两个 step）', async () => {
      const stream = vi.fn(async () => (async function* () {})())
      const agent = { stream } as never
      const events: unknown[] = []
      for await (const e of langchainAgentRunner(agent, [{ role: 'user', content: 'hi' }], { maxIterations: 10 })) {
        events.push(e)
      }
      expect(stream).toHaveBeenCalledTimes(1)
      const callOptions = stream.mock.calls[0][1] as { recursionLimit: number }
      expect(callOptions.recursionLimit).toBe(20)
      expect(events.some(e => (e as { type: string }).type === 'done')).toBe(true)
    })
  })
})

vi.mock('../../../server/src/services/llm-caller', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../../server/src/services/llm-caller'
import { ToolMessage } from '../../../server/node_modules/@langchain/core/messages'
import { synthesizeFromObservations } from '../../../server/src/services/langchain-adapter'

describe('synthesizeFromObservations', () => {
  it('有有效结果时调用 LLM 综合回答', async () => {
    vi.mocked(callLLM).mockReset().mockResolvedValue('综合回答')
    const result = await synthesizeFromObservations(
      [{ role: 'user', content: '今晚比赛结果' }],
      ['搜索结果' + 'x'.repeat(50)],
      '连续 3 次搜索未引入新关键词'
    )
    expect(result).toBe('综合回答')
    const [messages, systemPrompt] = vi.mocked(callLLM).mock.calls[0] as [
      Array<{ role: string; content: string }>, string
    ]
    expect(messages[0].content).toBe('今晚比赛结果')
    expect(systemPrompt).toContain('今晚比赛结果')
    expect(systemPrompt).toContain('连续 3 次搜索未引入新关键词')
    expect(systemPrompt).toContain('尚未发生')
  })

  it('无有效结果返回 null 且不调用 LLM', async () => {
    vi.mocked(callLLM).mockReset()
    const result = await synthesizeFromObservations(
      [{ role: 'user', content: 'q' }],
      ['Tool error: x'],
      null
    )
    expect(result).toBeNull()
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('LLM 失败返回 null（调用方退回原始摘要）', async () => {
    vi.mocked(callLLM).mockReset().mockRejectedValue(new Error('api down'))
    const result = await synthesizeFromObservations(
      [{ role: 'user', content: 'q' }],
      ['有效结果' + 'x'.repeat(50)],
      null
    )
    expect(result).toBeNull()
  })
})

describe('langchainAgentRunner - 停止后综合回答', () => {
  function makeAgentWithToolResult(): never {
    const toolMsg = new ToolMessage({ content: 'x'.repeat(100), tool_call_id: 'tc1', name: 'search' })
    return {
      stream: async function* () {
        yield { tools: { messages: [toolMsg] } }
      },
    } as never
  }

  it('工具结果未生成回答时用 LLM 综合而非倾倒原始结果', async () => {
    vi.mocked(callLLM).mockReset().mockResolvedValue('比赛今晚尚未开始')
    const events: Array<{ type: string; content?: string }> = []
    for await (const e of langchainAgentRunner(
      makeAgentWithToolResult(),
      [{ role: 'user', content: '今晚比赛结果' }],
      { maxIterations: 5 }
    )) {
      events.push(e as { type: string; content?: string })
    }
    const contentEvents = events.filter(e => e.type === 'content')
    expect(contentEvents).toHaveLength(1)
    expect(contentEvents[0].content).toBe('比赛今晚尚未开始')
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('LLM 综合失败时退回原始摘要倾倒', async () => {
    vi.mocked(callLLM).mockReset().mockRejectedValue(new Error('api down'))
    const events: Array<{ type: string; content?: string }> = []
    for await (const e of langchainAgentRunner(
      makeAgentWithToolResult(),
      [{ role: 'user', content: '今晚比赛结果' }],
      { maxIterations: 5 }
    )) {
      events.push(e as { type: string; content?: string })
    }
    const contentEvents = events.filter(e => e.type === 'content')
    expect(contentEvents).toHaveLength(1)
    expect(contentEvents[0].content).toContain('搜索结果 1')
  })
})
