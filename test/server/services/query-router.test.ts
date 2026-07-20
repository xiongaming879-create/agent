import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock 重量级依赖：memory-recall 需要初始化 DB；langchain-adapter 走真实 agent 循环
vi.mock('../../../server/src/services/memory-recall', () => ({
  buildMemoryContext: () => '',
}))

vi.mock('../../../server/src/services/langchain-adapter', () => ({
  langchainAgentRunner: async function* () {
    yield { type: 'done' } as const
  },
}))

// 纯逻辑测试不需要 mock fetch；LLM 兜底测试单独 mock
import {
  classifyByRules,
  classifyByLLM,
  classifyQuery,
  filterTools,
  getToolFilter,
} from '../../../server/src/services/query-router'

// ---------------------------------------------------------------------------
// 辅助：构造最小化的 tool mock（filterTools 只读 name 字段）
// ---------------------------------------------------------------------------

function makeTool(name: string) {
  return { name } as unknown as Parameters<typeof filterTools>[0][number]
}

// ===========================================================================
// Task 2: 规则分类器
// ===========================================================================

describe('classifyByRules', () => {
  it('问候语 -> CHITCHAT', () => {
    expect(classifyByRules('你好', false)).toBe('CHITCHAT')
    expect(classifyByRules('hi', false)).toBe('CHITCHAT')
    expect(classifyByRules('谢谢', false)).toBe('CHITCHAT')
  })

  it('短文本无问号 -> CHITCHAT', () => {
    expect(classifyByRules('好的', false)).toBe('CHITCHAT')
    expect(classifyByRules('知道了', false)).toBe('CHITCHAT')
  })

  it('数学关键词 -> CALCULATION', () => {
    expect(classifyByRules('根号5加根号9', false)).toBe('CALCULATION')
    expect(classifyByRules('计算 x^2 的导数', false)).toBe('CALCULATION')
  })

  it('含搜索意图的数学题不误判为 CALCULATION', () => {
    expect(classifyByRules('查一下根号5的值', false)).toBe('SEARCH')
  })

  it('节假日+年份 -> KNOWLEDGE', () => {
    expect(classifyByRules('2026中秋几号', false)).toBe('KNOWLEDGE')
    expect(classifyByRules('2026年国庆放假安排', false)).toBe('KNOWLEDGE')
  })

  it('相对日期 -> KNOWLEDGE', () => {
    expect(classifyByRules('后天是星期几', false)).toBe('KNOWLEDGE')
    expect(classifyByRules('今天几月几号', false)).toBe('KNOWLEDGE')
  })

  it('明确搜索信号词 -> SEARCH', () => {
    expect(classifyByRules('帮我查一下深圳天气', false)).toBe('SEARCH')
    expect(classifyByRules('后天世界杯赛程', false)).toBe('SEARCH')
  })

  it('规划/计划类 -> COMPLEX', () => {
    expect(classifyByRules('规划13天西藏行程', false)).toBe('COMPLEX')
    expect(classifyByRules('对比A和B两个方案', false)).toBe('COMPLEX')
  })

  it('长文本(>50字) -> COMPLEX', () => {
    const long = '这段文字用来测试长文本分类规则它应该被归类为复杂类型因为它超过了五十个字符的长度阈值并且不包含任何其他类别的关键词'
    expect(classifyByRules(long, false)).toBe('COMPLEX')
  })

  it('未命中规则返回 null', () => {
    expect(classifyByRules('分析一下这个问题的根源', false)).toBeNull()
  })
})

// ===========================================================================
// Task 4: 工具过滤
// ===========================================================================

describe('filterTools', () => {
  const tools = [
    makeTool('calculator'),
    makeTool('search'),
    makeTool('fetch'),
    makeTool('browser_navigate'),
    makeTool('browser_click'),
    makeTool('filesystem_read'),
    makeTool('maps_weather'),
  ]

  it('null -> 返回全部工具', () => {
    expect(filterTools(tools, null)).toHaveLength(tools.length)
  })

  it('[] -> 返回空数组', () => {
    expect(filterTools(tools, [])).toEqual([])
  })

  it('精确匹配 ["calculator"]', () => {
    const result = filterTools(tools, ['calculator'])
    expect(result.map(t => t.name)).toEqual(['calculator'])
  })

  it('前缀匹配 ["search","fetch","browser_*"]', () => {
    const result = filterTools(tools, ['search', 'fetch', 'browser_*'])
    const names = result.map(t => t.name).sort()
    expect(names).toEqual(['browser_click', 'browser_navigate', 'fetch', 'search'])
  })

  it('不含无关工具', () => {
    const result = filterTools(tools, ['search', 'fetch', 'browser_*'])
    const names = result.map(t => t.name)
    expect(names).not.toContain('calculator')
    expect(names).not.toContain('filesystem_read')
    expect(names).not.toContain('maps_weather')
  })

  it('getToolFilter 返回各类别配置', () => {
    expect(getToolFilter('CHITCHAT')).toEqual([])
    expect(getToolFilter('KNOWLEDGE')).toEqual([])
    expect(getToolFilter('CALCULATION')).toEqual(['calculator'])
    expect(getToolFilter('SEARCH')).toEqual(['search', 'fetch', 'browser_*'])
    expect(getToolFilter('COMPLEX')).toBeNull()
  })
})

// ===========================================================================
// Task 3: LLM 兜底分类器（mock fetch）
// ===========================================================================

describe('classifyByLLM', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mockFetchResponse(text: string) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text }] }),
    }) as unknown as typeof fetch
  }

  it('解析 LLM 返回的类别标签', async () => {
    mockFetchResponse('SEARCH')
    const result = await classifyByLLM('某个规则未命中的查询')
    expect(result).toBe('SEARCH')
  })

  it('LLM 返回乱码默认 COMPLEX', async () => {
    mockFetchResponse('我不知道这是什么类别')
    const result = await classifyByLLM('某个查询')
    expect(result).toBe('COMPLEX')
  })

  it('LLM 调用失败默认 COMPLEX', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch
    const result = await classifyByLLM('某个查询')
    expect(result).toBe('COMPLEX')
  })

  it('LLM 返回带额外文字也能提取标签', async () => {
    mockFetchResponse('类别是 KNOWLEDGE，因为涉及节假日')
    const result = await classifyByLLM('某个查询')
    expect(result).toBe('KNOWLEDGE')
  })
})

// ===========================================================================
// classifyQuery: 规则优先 + LLM 兜底
// ===========================================================================

describe('classifyQuery', () => {
  const originalFetch = global.fetch
  let fetchCalls = 0

  beforeEach(() => {
    fetchCalls = 0
    global.fetch = vi.fn(async () => {
      fetchCalls++
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'COMPLEX' }] }),
      }
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('规则命中时不调用 LLM', async () => {
    const result = await classifyQuery('你好', false)
    expect(result).toBe('CHITCHAT')
    expect(fetchCalls).toBe(0)
  })

  it('规则未命中时调用 LLM', async () => {
    await classifyQuery('分析一下这个问题的根源', false)
    expect(fetchCalls).toBe(1)
  })

  it('有历史上下文且规则未命中时默认 COMPLEX，不调 LLM', async () => {
    const result = await classifyQuery('分析一下这个问题的根源', true)
    expect(result).toBe('COMPLEX')
    expect(fetchCalls).toBe(0)
  })
})

// ===========================================================================
// Task 11: 路由分发器 - complexity 覆盖
// ===========================================================================

describe('runRoutedAgent complexity 覆盖', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // 辅助：mock fetch 返回 SSE 流，content_delta 事件输出给定文本
  function mockSSEStream(text: string) {
    const sseEvents = [
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
      'data: [DONE]',
    ].join('\n')
    const encoder = new TextEncoder()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (mockSSEStreamConsumed) return { done: true, value: undefined }
            mockSSEStreamConsumed = true
            return { done: false, value: encoder.encode(sseEvents) }
          },
          releaseLock: () => {},
        }),
      },
    }) as unknown as typeof fetch
  }
  let mockSSEStreamConsumed = false

  function mockSSEStreamReset() {
    mockSSEStreamConsumed = false
  }

  it('complexity=deep 强制 COMPLEX 路径（thought 显示 COMPLEX）', async () => {
    // COMPLEX 走 LangChain agent，会真实调 fetch；这里不深测，只验证分发器产出 routing thought
    // 使用一个会立即报错的 mock 来验证 fallback；但更稳的方式是验证 thought 事件
    mockSSEStreamReset()
    mockSSEStream('规划完成')

    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    const events: string[] = []
    for await (const ev of runRoutedAgent(
      [{ role: 'user', content: '你好' }],
      { complexity: 'deep' }
    )) {
      if (ev.type === 'thought') events.push(ev.content)
    }
    expect(events.some(t => t.includes('COMPLEX'))).toBe(true)
  })

  it('complexity=fast 不走 COMPLEX（路由 thought 不含 COMPLEX）', async () => {
    mockSSEStreamReset()
    mockSSEStream('你好啊')

    const { runRoutedAgent } = await import('../../../server/src/services/query-router')
    const events: string[] = []
    for await (const ev of runRoutedAgent(
      [{ role: 'user', content: '你好' }],
      { complexity: 'fast' }
    )) {
      if (ev.type === 'thought') events.push(ev.content)
    }
    // fast 模式下 "你好" 应路由到 CHITCHAT，不是 COMPLEX
    expect(events.some(t => t.includes('CHITCHAT'))).toBe(true)
    expect(events.some(t => t.includes('COMPLEX'))).toBe(false)
  })
})
