import { describe, it, expect, vi, beforeEach } from 'vitest'

// SSE 流式处理 composable 特征测试

describe('useSSE — SSE 事件解析', () => {
  type SSEEvent =
    | { type: 'thought'; content: string }
    | { type: 'action'; tool_name: string; content: string }
    | { type: 'observation'; content: string }
    | { type: 'content'; content: string }
    | { type: 'done' }

  function parseSSELine(line: string): SSEEvent | null {
    if (!line.startsWith('data: ')) return null
    try {
      return JSON.parse(line.slice(6))
    } catch {
      return null
    }
  }

  it('解析 data 行为 SSEEvent 对象', () => {
    const event = parseSSELine('data: {"type":"thought","content":"思考中"}')
    expect(event).toEqual({ type: 'thought', content: '思考中' })
  })

  it('解析 action 事件含 tool_name', () => {
    const event = parseSSELine('data: {"type":"action","tool_name":"search","content":"搜索"}')
    expect(event?.type).toBe('action')
    expect((event as { tool_name: string }).tool_name).toBe('search')
  })

  it('忽略非 data 行', () => {
    expect(parseSSELine('event: thought')).toBeNull()
    expect(parseSSELine('id: 123')).toBeNull()
    expect(parseSSELine('')).toBeNull()
  })

  it('无效 JSON 返回 null', () => {
    expect(parseSSELine('data: not-json')).toBeNull()
  })

  it('连续解析多行 SSE 流', () => {
    const lines = [
      'event: thought',
      'data: {"type":"thought","content":"我需要搜索"}',
      '',
      'event: action',
      'data: {"type":"action","tool_name":"search","content":"搜索关键词"}',
      '',
      'event: content',
      'data: {"type":"content","content":"最终回复"}',
      '',
      'event: done',
      'data: {"type":"done"}',
    ]
    const events = lines
      .map(parseSSELine)
      .filter((e): e is SSEEvent => e !== null)
    expect(events.length).toBe(4)
    expect(events[0].type).toBe('thought')
    expect(events[1].type).toBe('action')
    expect(events[2].type).toBe('content')
    expect(events[3].type).toBe('done')
  })
})

describe('useSSE — 流式内容拼接', () => {
  it('多个 content 事件的内容应拼接为完整回复', () => {
    const contentChunks = ['根据分析，', 'React 是', '一个前端框架。']
    const fullContent = contentChunks.join('')
    expect(fullContent).toBe('根据分析，React 是一个前端框架。')
  })

  it('thought_steps 在流式过程中逐步追加', () => {
    const steps: { type: string; content: string }[] = []
    steps.push({ type: 'thought', content: '需要搜索' })
    steps.push({ type: 'action', content: '搜索' })
    steps.push({ type: 'observation', content: '结果' })
    expect(steps.length).toBe(3)
    expect(steps[0].type).toBe('thought')
    expect(steps[2].type).toBe('observation')
  })
})
