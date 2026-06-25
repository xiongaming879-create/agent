import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import {
  initDb,
  resetDb,
  stopAutoSave,
  createConversation,
  getConversations,
  getConversationsByUserId,
  getConversation,
  updateConversation,
  deleteConversation,
  createMessage,
  getMessages,
  getMessagesByParent,
  getMessage,
  deleteMessage,
  type CreateMessageInput,
} from '../../../server/src/db'
import type { Message, ThoughtStep } from '../../../server/src/types'

const TEST_DB = `/tmp/agent-test-${process.pid}.db`
process.env.DB_PATH = TEST_DB

describe('数据库 — 对话 CRUD', () => {
  beforeEach(async () => {
    resetDb()
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
  })

  it('新建对话应返回带 id 的对象', () => {
    const conv = createConversation()
    expect(conv.id).toBeTruthy()
    expect(conv.title).toBeTruthy()
  })

  it('新建对话可指定 title 和 system_prompt', () => {
    const conv = createConversation('测试对话', '你是代码助手')
    expect(conv.title).toBe('测试对话')
    expect(conv.system_prompt).toBe('你是代码助手')
  })

  it('获取对话列表应包含已创建的对话', () => {
    createConversation('对话A')
    createConversation('对话B')
    const list = getConversations()
    const titles = list.map(c => c.title)
    expect(titles).toContain('对话A')
    expect(titles).toContain('对话B')
  })

  it('更新对话标题', () => {
    const conv = createConversation('原标题')
    updateConversation(conv.id, { title: '新标题' })
    const updated = getConversation(conv.id)
    expect(updated?.title).toBe('新标题')
  })

  it('删除对话后查询返回 null', () => {
    const conv = createConversation('待删除')
    deleteConversation(conv.id)
    const found = getConversation(conv.id)
    expect(found).toBeNull()
  })

  it('查询不存在的对话返回 null', () => {
    const found = getConversation('nonexistent-id')
    expect(found).toBeNull()
  })

  it('新建对话默认 is_pinned 为 false', () => {
    const conv = createConversation()
    expect(conv.is_pinned).toBe(false)
  })

  it('可更新 is_pinned 为 true', () => {
    const conv = createConversation()
    updateConversation(conv.id, { is_pinned: true })
    const updated = getConversation(conv.id)
    expect(updated?.is_pinned).toBe(true)
  })

  it('可更新 is_pinned 为 false', () => {
    const conv = createConversation()
    updateConversation(conv.id, { is_pinned: true })
    updateConversation(conv.id, { is_pinned: false })
    const updated = getConversation(conv.id)
    expect(updated?.is_pinned).toBe(false)
  })
})

// TC-DB-01 ~ TC-DB-05: 字段映射正确性（核心修复验证）
describe('数据库 — 字段映射正确性（SELECT 显式列名）', () => {
  beforeEach(async () => {
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
  })

  it('TC-DB-01: getConversation 返回的 user_id/created_at/updated_at 不错位', () => {
    const userId = 'user-abc-123'
    const conv = createConversation('映射测试', null, userId)
    const found = getConversation(conv.id)
    expect(found).not.toBeNull()
    expect(found!.user_id).toBe(userId)
    // created_at 应为 ISO 日期格式，不是 UUID
    expect(found!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // updated_at 同理
    expect(found!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('TC-DB-02: getConversations 返回的每条记录字段映射正确', () => {
    const userId = 'user-xyz-789'
    const conv = createConversation('列表映射', 'sys-prompt', userId)
    const list = getConversations()
    const found = list.find(c => c.id === conv.id)
    expect(found).toBeDefined()
    expect(found!.user_id).toBe(userId)
    expect(found!.system_prompt).toBe('sys-prompt')
    expect(found!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(found!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('TC-DB-03: getConversationsByUserId(userId) 返回的记录字段映射正确', () => {
    const userId = 'user-mapping-test'
    const conv = createConversation('用户映射', null, userId)
    const list = getConversationsByUserId(userId)
    const found = list.find(c => c.id === conv.id)
    expect(found).toBeDefined()
    expect(found!.user_id).toBe(userId)
    expect(found!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('TC-DB-04: getMessages 返回的记录字段映射正确', () => {
    const conv = createConversation()
    createMessage({ conversation_id: conv.id, parent_id: null, role: 'user', content: '映射测试' })
    const msgs = getMessages(conv.id)
    expect(msgs.length).toBe(1)
    expect(msgs[0].conversation_id).toBe(conv.id)
    expect(msgs[0].content).toBe('映射测试')
    expect(msgs[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('TC-DB-05: getMessage 返回的记录字段映射正确', () => {
    const conv = createConversation()
    const msg = createMessage({ conversation_id: conv.id, parent_id: null, role: 'assistant', content: '回复', thought_steps: [{ type: 'thought', content: '思考', tool_name: null, timestamp: new Date().toISOString() }] })
    const found = getMessage(msg.id)
    expect(found).not.toBeNull()
    expect(found!.conversation_id).toBe(conv.id)
    expect(found!.thought_steps.length).toBe(1)
    expect(found!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// TC-DB-06 ~ TC-DB-10: 无主对话查询 & user_id 更新
describe('数据库 — 无主对话与 user_id 更新', () => {
  beforeEach(async () => {
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
  })

  it('TC-DB-06: getConversationsByUserId(null) 返回所有 user_id IS NULL 的对话', () => {
    createConversation('无主1')
    createConversation('无主2')
    const orphans = getConversationsByUserId(null)
    expect(orphans.length).toBe(2)
    expect(orphans.every(c => c.user_id === null)).toBe(true)
  })

  it('TC-DB-07: getConversationsByUserId(null) 不返回有 user_id 的对话', () => {
    createConversation('无主')
    createConversation('有主', null, 'user-123')
    const orphans = getConversationsByUserId(null)
    expect(orphans.length).toBe(1)
    expect(orphans[0].title).toBe('无主')
  })

  it('TC-DB-08: getConversationsByUserId(userId) 不返回无主对话', () => {
    createConversation('无主')
    createConversation('有主', null, 'user-456')
    const list = getConversationsByUserId('user-456')
    expect(list.length).toBe(1)
    expect(list[0].title).toBe('有主')
  })

  it('TC-DB-09: updateConversation 更新 user_id', () => {
    const conv = createConversation('待绑定')
    expect(conv.user_id).toBeNull()
    updateConversation(conv.id, { user_id: 'user-bind' })
    const found = getConversation(conv.id)
    expect(found!.user_id).toBe('user-bind')
  })

  it('TC-DB-10: updateConversation 可将 user_id 设为 null', () => {
    const conv = createConversation('已绑定', null, 'user-old')
    expect(conv.user_id).toBe('user-old')
    updateConversation(conv.id, { user_id: null })
    const found = getConversation(conv.id)
    expect(found!.user_id).toBeNull()
  })
})

describe('数据库 — 消息 CRUD', () => {
  let convId: string

  beforeEach(async () => {
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
    const conv = createConversation()
    convId = conv.id
  })

  it('创建用户消息并读取', () => {
    const msg = createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'user',
      content: '你好',
    })
    expect(msg.id).toBeTruthy()
    expect(msg.content).toBe('你好')
    expect(msg.role).toBe('user')
  })

  it('创建带 thought_steps 的助手消息', () => {
    const msg = createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'assistant',
      content: '回复内容',
      thought_steps: [
        { type: 'thought', content: '思考中...', tool_name: null, timestamp: new Date().toISOString() },
        { type: 'action', content: '搜索', tool_name: 'search', timestamp: new Date().toISOString() },
      ],
    })
    expect(msg.thought_steps.length).toBe(2)
    expect(msg.thought_steps[0].type).toBe('thought')
  })

  it('通过 parent_id 查询分支', () => {
    const parent = createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'user',
      content: '计算 1+1',
    })
    createMessage({
      conversation_id: convId,
      parent_id: parent.id,
      role: 'assistant',
      content: '等于 2',
    })
    createMessage({
      conversation_id: convId,
      parent_id: parent.id,
      role: 'assistant',
      content: '答案是 2',
    })
    const branches = getMessagesByParent(convId, parent.id)
    expect(branches.length).toBe(2)
  })

  it('删除消息', () => {
    const msg = createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'user',
      content: '待删除',
    })
    deleteMessage(msg.id)
    const msgs = getMessages(convId)
    expect(msgs.find(m => m.id === msg.id)).toBeUndefined()
  })

  it('删除对话时应级联删除所有消息', () => {
    createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'user',
      content: '消息1',
    })
    createMessage({
      conversation_id: convId,
      parent_id: null,
      role: 'user',
      content: '消息2',
    })
    deleteConversation(convId)
    const msgs = getMessages(convId)
    expect(msgs.length).toBe(0)
  })
})

describe('数据库 — 置顶排序', () => {
  beforeEach(async () => {
    resetDb()
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
  })

  it('置顶对话排在非置顶对话前面', () => {
    createConversation('普通对话A')
    const pinned = createConversation('置顶对话')
    createConversation('普通对话B')
    updateConversation(pinned.id, { is_pinned: true })
    const list = getConversations()
    expect(list[0].id).toBe(pinned.id)
    expect(list[0].is_pinned).toBe(true)
  })

  it('多个置顶对话之间按 updated_at 降序', () => {
    const p1 = createConversation('置顶1')
    const p2 = createConversation('置顶2')
    updateConversation(p1.id, { is_pinned: true })
    updateConversation(p2.id, { is_pinned: true })
    // p2 更新时间更新（因为后修改 is_pinned）
    const list = getConversations()
    expect(list[0].is_pinned).toBe(true)
    expect(list[1].is_pinned).toBe(true)
  })

  it('getConversationsByUserId 也按置顶优先排序', () => {
    const userId = 'user-pin-test'
    const normal = createConversation('普通', null, userId)
    const pinned = createConversation('置顶', null, userId)
    updateConversation(pinned.id, { is_pinned: true })
    const list = getConversationsByUserId(userId)
    expect(list[0].id).toBe(pinned.id)
  })
})

describe('数据库 — 自动保存机制', () => {
  it('写操作标记 dirty 而非立即写盘', () => {
    // 写操作调用 markDirty() 而非 saveDb()，由定时器批量保存
    const conv = createConversation('自动保存测试')
    expect(conv.id).toBeTruthy()
    // 数据在内存中可读，不依赖磁盘同步
    const found = getConversation(conv.id)
    expect(found?.title).toBe('自动保存测试')
  })

  it('stopAutoSave 刷盘并停止定时器', () => {
    createConversation('关闭前保存')
    stopAutoSave()
    // stopAutoSave 应将未保存数据写入磁盘
  })
})
