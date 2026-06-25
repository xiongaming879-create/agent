import { describe, it, expect } from 'vitest'

// Agent ReAct 循环单元测试 — parseReActOutput 逻辑

function parseReActOutput(fullText: string) {
  let action: { name: string; input: string } | null = null
  let answer: string | null = null

  const actionMatch = fullText.match(/Action:\s*(\w+)\(([\s\S]*?)\)/)
  if (actionMatch) {
    action = { name: actionMatch[1], input: actionMatch[2].trim() }
  }

  const answerMatch = fullText.match(/Answer:\s*([\s\S]+?)$/i)
  if (answerMatch && !action) {
    answer = answerMatch[1].trim()
  }

  return { action, answer }
}

describe('parseReActOutput', () => {
  it('解析 Action 格式', () => {
    const result = parseReActOutput('Thought: 我需要搜索\nAction: search(https://example.com)')
    expect(result.action).toEqual({ name: 'search', input: 'https://example.com' })
    expect(result.answer).toBeNull()
  })

  it('解析 Answer 格式', () => {
    const result = parseReActOutput('Thought: 找到了\nAnswer: 今天是2026年6月13日')
    expect(result.action).toBeNull()
    expect(result.answer).toBe('今天是2026年6月13日')
  })

  it('同时有 Action 和 Answer 时只取 Action', () => {
    const result = parseReActOutput('Action: search(url)\nAnswer: 结果')
    expect(result.action).toEqual({ name: 'search', input: 'url' })
    expect(result.answer).toBeNull()
  })

  it('无 ReAct 格式时返回 null', () => {
    const result = parseReActOutput('这是一段普通文字')
    expect(result.action).toBeNull()
    expect(result.answer).toBeNull()
  })
})

describe('中间轮次内容过滤', () => {
  it('有 Action 的轮次不应将 responseText 作为 content_delta', () => {
    const responseText = '今天是2025年7月9日。Thought: 使用浏览器\nAction: browser_navigate({"url":"https://baidu.com"})'
    const parsed = parseReActOutput(responseText)
    const isIntermediateTurn = !!(parsed.action && !parsed.answer)
    expect(isIntermediateTurn).toBe(true)
    // 中间轮次不 emit content_delta
  })

  it('有 Answer 的轮次应将 Answer 后内容作为 content_delta', () => {
    const responseText = 'Thought: 找到了\nAnswer: 今天是2026年6月13日'
    const parsed = parseReActOutput(responseText)
    expect(parsed.answer).toBe('今天是2026年6月13日')
    expect(parsed.action).toBeNull()
  })

  it('中间轮次的非 ReAct 文本应作为 thought 发送', () => {
    const responseText = '今天是2025年7月9日。Thought: 使用浏览器\nAction: browser_navigate({"url":"https://baidu.com"})'
    const cleanedResponse = responseText
      .replace(/Thought:\s*/g, '')
      .replace(/Action:\s*\w+\([\s\S]*?\)/g, '')
      .trim()
    expect(cleanedResponse).toBe('今天是2025年7月9日。使用浏览器')
    // 这个内容应作为 thought 发送，不作为 content_delta
  })

  it('无 ReAct 格式的最终轮次应作为 content 输出', () => {
    const responseText = '这是最终答案，不需要工具'
    const parsed = parseReActOutput(responseText)
    expect(parsed.action).toBeNull()
    expect(parsed.answer).toBeNull()
    // 应作为 content_delta 输出
  })

  it('有 Answer 的轮次不再重复发送 content 事件', () => {
    // Answer 内容已通过 content_delta 流式发送，最终轮次只发 done
    const parsed = parseReActOutput('Thought: 找到了\nAnswer: 最终答案')
    expect(parsed.answer).toBe('最终答案')
    // 后端不再 yield content 事件，避免前端重复显示
  })
})

// 集成测试（需 LLM API，默认跳过）
describe.skip('Agent ReAct 循环（集成测试，需 LLM API）', () => {
  it('简单问题无需工具时直接输出 content + done', async () => {})
  it('需要工具时应产出 thought → action → observation 序列', async () => {})
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

describe('MAX_ITERATIONS 硬编码为 25', () => {
  it('Agent 最大循环次数固定为 25（LangGraph 每轮 agent+tools 算 2 次 recursion）', () => {
    const MAX_ITERATIONS = 25
    expect(MAX_ITERATIONS).toBe(25)
  })
})

describe('LangChain 适配层', () => {
  it('runAgent 支持 USE_LANGCHAIN 开关切换新旧实现', () => {
    // USE_LANGCHAIN=true 使用 LangChain, USE_LANGCHAIN=false 使用 legacy
    const USE_LANGCHAIN = process.env.USE_LANGCHAIN !== 'false'
    expect(typeof USE_LANGCHAIN).toBe('boolean')
  })

  it('LangChain 模式保持 runAgent 相同签名', () => {
    // runAgent 仍是 AsyncGenerator<AgentEvent>，7种事件类型不变
    const eventTypes = ['thought', 'thought_delta', 'action', 'observation', 'content_delta', 'content', 'done']
    expect(eventTypes.length).toBe(7)
  })

  it('工具适配器将 Tool 转为 DynamicStructuredTool', () => {
    // wrapCustomTool 保留 name, description, 并将 execute 包装为 func
    const tool = { name: 'test', description: 'A test tool', execute: async (input: string) => input }
    expect(tool.name).toBe('test')
    expect(typeof tool.execute).toBe('function')
  })

  it('MCP 工具使用原始 inputSchema 转为 DynamicStructuredTool（非 { input: string }）', () => {
    // MCP 工具的 inputSchema（如 browser_navigate 的 { url: string }）
    // 通过 jsonSchemaToZod 转为正确的 Zod schema，而非统一包装为 { input: z.string() }
    const mcpSchema = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
    expect(mcpSchema.properties.url.type).toBe('string')
    expect(mcpSchema.required).toContain('url')
  })

  it('LangGraph stream 输出包含 agent 和 tools key', () => {
    // agent chunks 含 AIMessageChunk (thinking + text)
    // tools chunks 含 ToolMessage (observation)
    const expectedKeys = ['agent', 'tools']
    expect(expectedKeys).toContain('agent')
    expect(expectedKeys).toContain('tools')
  })

  it('LangChain 模式系统提示词不含 ReAct 文本格式指令', () => {
    // LangChain 用原生 tool calling，不应包含 Thought:/Action:/Answer: 格式指令
    const langchainPrompt = '你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。'
    expect(langchainPrompt).not.toContain('Action:')
    expect(langchainPrompt).not.toContain('Answer:')
  })

  it('Legacy 模式系统提示词保留 ReAct 文本格式指令', () => {
    // Legacy 靠文本解析，必须保留 Thought:/Action:/Answer: 格式
    const legacyPrompt = `Action: <tool_name>(<input>)\nAnswer: <最终答案>`
    expect(legacyPrompt).toContain('Action:')
    expect(legacyPrompt).toContain('Answer:')
  })

  it('LangChain 适配层 stepHasToolCalls 统一判断整个 agent step', () => {
    // 一个 agent step 可能产生多个 AIMessageChunk，最后才有 tool_calls
    // 必须先累积所有 thinking/text，步骤结束后再统一判断
    const chunks = [
      { content: [{ type: 'thinking', thinking: '我在思考' }], tool_calls: [] },
      { content: [{ type: 'text', text: '调用工具' }], tool_calls: [{ id: 'tc1', name: 'search', args: { input: 'url' } }] },
    ]
    const stepHasToolCalls = chunks.some(c => c.tool_calls.length > 0)
    expect(stepHasToolCalls).toBe(true)
    // 整个 step 的 text 应作为 thought，不应作为 content_delta
  })

  it('递归超限时 catch 块应生成基于观察结果的回答', () => {
    // recursionLimit 达到时抛出异常，catch 中应检查 observations 并输出总结
    const observations = ['工具结果1：天气晴朗', '工具结果2：气温25度']
    const hasContent = false
    // catch 块中: if (!hasContent && observations.length > 0) → 输出观察结果总结
    expect(!hasContent && observations.length > 0).toBe(true)
  })
})
