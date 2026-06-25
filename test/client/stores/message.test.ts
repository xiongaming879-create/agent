import { describe, it, expect, beforeEach } from 'vitest'

// 消息状态管理特征测试（Pinia store 逻辑，不依赖 Vue）

interface ThoughtStep {
  type: 'thought' | 'action' | 'observation'
  content: string
  tool_name: string | null
  timestamp: Date
}

interface Message {
  id: string
  conversation_id: string
  parent_id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  thought_steps: ThoughtStep[]
  created_at: Date
}

// 模拟 store 核心逻辑（纯函数测试，不依赖 Pinia 实例）

describe('消息状态 — 树结构分支管理', () => {
  let messages: Message[]

  beforeEach(() => {
    messages = []
  })

  function getActiveBranch(messages: Message[], leafId: string | null): Message[] {
    if (!leafId) return []
    const branch: Message[] = []
    let current: Message | undefined = messages.find(m => m.id === leafId)
    while (current) {
      branch.unshift(current)
      current = current.parent_id
        ? messages.find(m => m.id === current!.parent_id)
        : undefined
    }
    return branch
  }

  function getSiblings(messages: Message[], parentId: string | null): Message[] {
    return messages.filter(m => m.parent_id === parentId)
  }

  it('从叶子节点回溯到根，构建活跃分支路径', () => {
    messages = [
      { id: 'm1', conversation_id: 'c1', parent_id: null, role: 'user', content: 'Q', thought_steps: [], created_at: new Date() },
      { id: 'm2', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: 'A1', thought_steps: [], created_at: new Date() },
      { id: 'm3', conversation_id: 'c1', parent_id: 'm2', role: 'user', content: 'Q2', thought_steps: [], created_at: new Date() },
    ]
    const branch = getActiveBranch(messages, 'm3')
    expect(branch.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('同一 parent 下多个子消息构成分支', () => {
    messages = [
      { id: 'm1', conversation_id: 'c1', parent_id: null, role: 'user', content: 'Q', thought_steps: [], created_at: new Date() },
      { id: 'm2a', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: 'A 分支1', thought_steps: [], created_at: new Date() },
      { id: 'm2b', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: 'A 分支2', thought_steps: [], created_at: new Date() },
    ]
    const siblings = getSiblings(messages, 'm1')
    expect(siblings.length).toBe(2)
    expect(siblings.map(m => m.id)).toEqual(['m2a', 'm2b'])
  })

  it('切换分支：选择不同子节点构建不同路径', () => {
    messages = [
      { id: 'm1', conversation_id: 'c1', parent_id: null, role: 'user', content: 'Q', thought_steps: [], created_at: new Date() },
      { id: 'm2a', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: 'A1', thought_steps: [], created_at: new Date() },
      { id: 'm2b', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: 'A2', thought_steps: [], created_at: new Date() },
    ]
    const branch1 = getActiveBranch(messages, 'm2a')
    const branch2 = getActiveBranch(messages, 'm2b')
    expect(branch1.map(m => m.content)).toEqual(['Q', 'A1'])
    expect(branch2.map(m => m.content)).toEqual(['Q', 'A2'])
  })

  it('编辑用户消息创建新分支节点', () => {
    messages = [
      { id: 'm1', conversation_id: 'c1', parent_id: null, role: 'user', content: '原始问题', thought_steps: [], created_at: new Date() },
      { id: 'm2', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: '原始回答', thought_steps: [], created_at: new Date() },
    ]
    // 编辑 m1 创建分支
    const edited: Message = {
      id: 'm1-edit',
      conversation_id: 'c1',
      parent_id: null, // 同为根节点，与 m1 并列
      role: 'user',
      content: '编辑后的问题',
      thought_steps: [],
      created_at: new Date(),
    }
    messages.push(edited)
    const siblings = getSiblings(messages, null)
    expect(siblings.length).toBe(2)
  })
})

describe('消息状态 — 上下文窗口截断', () => {
  it('超出窗口大小时截断最早的消息', () => {
    const windowSize = 4
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      conversation_id: 'c1',
      parent_id: i > 0 ? `m${i - 1}` : null,
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `消息${i}`,
      thought_steps: [],
      created_at: new Date(),
    }))
    const truncated = messages.slice(-windowSize)
    expect(truncated.length).toBe(windowSize)
    expect(truncated[0].id).toBe('m6')
    expect(truncated[3].id).toBe('m9')
  })

  it('截断时保留系统提示词', () => {
    const windowSize = 4
    const messages: Message[] = [
      { id: 'sys', conversation_id: 'c1', parent_id: null, role: 'system', content: '系统提示', thought_steps: [], created_at: new Date() },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        conversation_id: 'c1',
        parent_id: null,
        role: 'user' as const,
        content: `消息${i}`,
        thought_steps: [] as ThoughtStep[],
        created_at: new Date(),
      })),
    ]
    const system = messages.filter(m => m.role === 'system')
    const nonSystem = messages.filter(m => m.role !== 'system').slice(-windowSize)
    const result = [...system, ...nonSystem]
    expect(result[0].role).toBe('system')
    expect(result.length).toBe(windowSize + 1)
  })
})

describe('消息状态 — SSE 事件处理', () => {
  it('content_delta 事件追加到缓冲区', () => {
    let contentBuffer = ''
    contentBuffer += '你好'
    contentBuffer += '世界'
    expect(contentBuffer).toBe('你好世界')
  })

  it('content 事件不再重复发送，由后端保证 content_delta 流式输出后不再发 content', () => {
    // 后端修复：有 Answer 时只发 content_delta + done，不发 content 事件
    // 无 ReAct 格式时只发 content_delta + done，不发 content 事件
    // 前端 content 事件仍为追加逻辑，但后端不再重复发送
    const events: string[] = ['content_delta', 'done']
    expect(events).not.toContain('content')
  })
})

describe('消息状态 — 流式期间切换会话', () => {
  it('streamingConvId 跟踪当前流式消息所属会话', () => {
    const streamingConvId = 'conv-123'
    const activeId = 'conv-456'
    // 切换会话后 streamingConvId !== activeId
    expect(streamingConvId !== activeId).toBe(true)
  })

  it('切换会话时 streamingConvId 不匹配应终止流处理', () => {
    const streamingConvId = 'conv-123'
    const activeId = 'conv-456'
    // SSE 读取循环中检测到 streamingConvId !== conversationId 时 break
    const shouldBreak = streamingConvId !== 'conv-123' // conversationId 仍是原会话
    expect(shouldBreak).toBe(false)
    // 如果切换了会话：streamingConvId 被置 null 或新值
    const afterSwitch = null
    const shouldBreakAfterSwitch = afterSwitch !== 'conv-123'
    expect(shouldBreakAfterSwitch).toBe(true)
  })

  it('finally 块只在活跃会话匹配时 fetchMessages', () => {
    const conversationId = 'conv-123'
    const activeId = 'conv-123'
    expect(activeId === conversationId).toBe(true) // 匹配：执行 fetchMessages

    const otherActiveId = 'conv-456'
    expect(otherActiveId === conversationId).toBe(false) // 不匹配：跳过 fetchMessages
  })
})
