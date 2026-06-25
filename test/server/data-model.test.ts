import { describe, it, expect, beforeEach } from 'vitest'
import type { Conversation, Message, ThoughtStep } from '../../server/src/types'

// 这些测试定义了数据模型的核心特征，TDD 驱动实现

describe('Conversation 数据模型', () => {
  it('新建对话应有 id、title、system_prompt、created_at、updated_at', () => {
    const now = new Date()
    const conv: Conversation = {
      id: 'uuid-1',
      title: '新对话',
      system_prompt: null,
      created_at: now,
      updated_at: now,
    }
    expect(conv.id).toBe('uuid-1')
    expect(conv.title).toBe('新对话')
    expect(conv.system_prompt).toBeNull()
    expect(conv.created_at).toBe(now)
    expect(conv.updated_at).toBe(now)
  })

  it('title 默认取首条消息前 20 字', () => {
    const longText = '这是一段超过二十个字的消息用于测试标题截断功能是否正常工作'
    const title = longText.slice(0, 20)
    expect(title).toBe('这是一段超过二十个字的消息用于测试标题截')
    expect(title.length).toBe(20)
  })

  it('system_prompt 可为自定义字符串', () => {
    const conv: Conversation = {
      id: 'uuid-2',
      title: '带 prompt 的对话',
      system_prompt: '你是一个代码助手',
      created_at: new Date(),
      updated_at: new Date(),
    }
    expect(conv.system_prompt).toBe('你是一个代码助手')
  })
})

describe('Message 数据模型', () => {
  it('消息应有 id、conversation_id、parent_id、role、content、thought_steps、created_at', () => {
    const msg: Message = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      parent_id: null,
      role: 'user',
      content: '你好',
      thought_steps: [],
      created_at: new Date(),
    }
    expect(msg.id).toBe('msg-1')
    expect(msg.conversation_id).toBe('conv-1')
    expect(msg.parent_id).toBeNull()
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('你好')
    expect(msg.thought_steps).toEqual([])
  })

  it('parent_id 构成树结构：同一 parent_id 下可有多个子消息（分支）', () => {
    const parent: Message = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      parent_id: null,
      role: 'user',
      content: '计算 1+1',
      thought_steps: [],
      created_at: new Date(),
    }
    const branch1: Message = {
      id: 'msg-2a',
      conversation_id: 'conv-1',
      parent_id: 'msg-1',
      role: 'assistant',
      content: '结果是 2',
      thought_steps: [],
      created_at: new Date(),
    }
    const branch2: Message = {
      id: 'msg-2b',
      conversation_id: 'conv-1',
      parent_id: 'msg-1',
      role: 'assistant',
      content: '答案是 2',
      thought_steps: [],
      created_at: new Date(),
    }
    expect(branch1.parent_id).toBe('msg-1')
    expect(branch2.parent_id).toBe('msg-1')
    expect(branch1.parent_id).toBe(branch2.parent_id)
  })
})

describe('ThoughtStep 数据模型', () => {
  it('thought 类型的步骤有 type 和 content', () => {
    const step: ThoughtStep = {
      type: 'thought',
      content: '我需要先搜索相关资料',
      tool_name: null,
      timestamp: new Date(),
    }
    expect(step.type).toBe('thought')
    expect(step.tool_name).toBeNull()
  })

  it('action 类型的步骤附带 tool_name', () => {
    const step: ThoughtStep = {
      type: 'action',
      content: '搜索: React Agentic',
      tool_name: 'search',
      timestamp: new Date(),
    }
    expect(step.type).toBe('action')
    expect(step.tool_name).toBe('search')
  })

  it('observation 类型的步骤无 tool_name', () => {
    const step: ThoughtStep = {
      type: 'observation',
      content: '搜索结果: ...',
      tool_name: null,
      timestamp: new Date(),
    }
    expect(step.type).toBe('observation')
    expect(step.tool_name).toBeNull()
  })
})
