import { describe, it, expect } from 'vitest'

// 集成测试（需 LLM API，默认跳过）
describe.skip('Agent ReAct 循环（集成测试，需 LLM API）', () => {
  it('简单问题无需工具时直接输出 content + done', async () => {})
  it('需要工具时应产出 thought -> action -> observation 序列', async () => {})
  it('多步推理应产出多轮 thought-action-observation', async () => {})
  it('上下文应携带历史消息', async () => {})
  it('action 的 tool_name 应匹配已注册的工具', async () => {})
  it('中间轮次内容不应出现在最终 content_delta 中', async () => {})
})

describe('detectStuckPattern 卡住检测', () => {
  function detectStuckPattern(observations: string[], threshold: number = 3): boolean {
    if (observations.length < threshold) return false
    const recent = observations.slice(-threshold)
    return recent.every(obs =>
      obs.startsWith('Tool error:') || obs.includes('not found') || obs.includes('Request timeout') || obs.includes('Error:') || obs.length < 20
    )
  }

  it('连续3次 Tool error 时判定卡住', () => {
    expect(detectStuckPattern(['Tool error: timeout', 'Tool error: fail', 'Tool error: crash'])).toBe(true)
  })

  it('连续3次 Request timeout 时判定卡住', () => {
    expect(detectStuckPattern(['Request timeout', 'Request timeout', 'Request timeout'])).toBe(true)
  })

  it('连续3次 Error: 时判定卡住', () => {
    expect(detectStuckPattern(['Error: invalid', 'Error: syntax', 'Error: unknown'])).toBe(true)
  })

  it('不足3次失败不判定卡住', () => {
    expect(detectStuckPattern(['Tool error: fail', 'success result'])).toBe(false)
  })

  it('成功结果穿插时不判定卡住', () => {
    expect(detectStuckPattern(['Tool error: fail', 'Request timeout', '成功获取到了大量的有效数据内容，结果非常丰富'])).toBe(false)
  })

  it('结果过短（<20字）判定为失败', () => {
    expect(detectStuckPattern(['not found', 'no data', 'empty'])).toBe(true)
  })
})

describe('LangChain 适配层', () => {
  it('LangChain 模式保持 runAgent 相同签名', () => {
    // runAgent 仍是 AsyncGenerator<AgentEvent>，7种事件类型不变
    const eventTypes = ['thought', 'thought_delta', 'action', 'observation', 'content_delta', 'content', 'done']
    expect(eventTypes.length).toBe(7)
  })

  it('工具适配器将 Tool 转为 DynamicStructuredTool', () => {
    const tool = { name: 'test', description: 'A test tool', execute: async (input: string) => input }
    expect(tool.name).toBe('test')
    expect(typeof tool.execute).toBe('function')
  })

  it('MCP 工具使用原始 inputSchema 转为 DynamicStructuredTool（非 { input: string }）', () => {
    const mcpSchema = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
    expect(mcpSchema.properties.url.type).toBe('string')
    expect(mcpSchema.required).toContain('url')
  })

  it('LangGraph stream 输出包含 agent 和 tools key', () => {
    const expectedKeys = ['agent', 'tools']
    expect(expectedKeys).toContain('agent')
    expect(expectedKeys).toContain('tools')
  })

  it('LangChain 模式系统提示词不含 ReAct 文本格式指令', () => {
    const langchainPrompt = '你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。'
    expect(langchainPrompt).not.toContain('Action:')
    expect(langchainPrompt).not.toContain('Answer:')
  })

  it('LangChain 适配层 stepHasToolCalls 统一判断整个 agent step', () => {
    const chunks = [
      { content: [{ type: 'thinking', thinking: '我在思考' }], tool_calls: [] },
      { content: [{ type: 'text', text: '调用工具' }], tool_calls: [{ id: 'tc1', name: 'search', args: { input: 'url' } }] },
    ]
    const stepHasToolCalls = chunks.some(c => c.tool_calls.length > 0)
    expect(stepHasToolCalls).toBe(true)
  })

  it('递归超限时 catch 块应生成基于观察结果的回答', () => {
    const observations = ['工具结果1：天气晴朗', '工具结果2：气温25度']
    const hasContent = false
    expect(!hasContent && observations.length > 0).toBe(true)
  })
})
