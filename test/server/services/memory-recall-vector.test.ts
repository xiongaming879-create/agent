import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

vi.mock('../../../server/src/services/rag-search', () => ({
  hybridSearch: vi.fn(),
}))

import { buildMemoryContext, MEMORY_RECALL_TIMEOUT_MS } from '../../../server/src/services/memory-recall'
import { hybridSearch } from '../../../server/src/services/rag-search'
import {
  initMemoryDb,
  resetMemoryDb,
  createRule,
  createCandidate,
} from '../../../server/src/db/memory-db'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEST_DB = path.resolve(__dirname, '../../../server/data/memory-recall-vector-test.db')
process.env.MEMORY_DB_PATH = TEST_DB

describe('Memory Recall - rules 全量 + candidates 向量检索', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    vi.clearAllMocks()
  })

  it('rules 全量注入,不走向量检索(即使有 query + userId)', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '用户住在深圳坂田',
      promotion_reason: 'explicit',
      supporting_conversations: [],
      user_id: 'user-1',
    })
    createRule({
      kind: 'stable_fact',
      rule: '地球是圆的',
      promotion_reason: 'explicit',
      supporting_conversations: [],
      user_id: 'user-1',
    })

    // hybridSearch mock 只对 candidate 返回空(模拟无 candidate 命中)
    vi.mocked(hybridSearch).mockResolvedValue([])

    const result = await buildMemoryContext('user-1', '今天天气怎么样')
    // 所有 rules 全量注入,不按 query 过滤
    expect(result).toContain('用户住在深圳坂田')
    expect(result).toContain('地球是圆的')
    // hybridSearch 只被调一次(只查 candidate,不查 rule)
    expect(hybridSearch).toHaveBeenCalledTimes(1)
  })

  it('candidates 走向量检索,只注入 user_preference 类型', async () => {
    await initMemoryDb()
    createCandidate({
      conversation_id: 'conv-a',
      type: 'user_preference',
      statement: '用户偏好深色主题',
      durable: 0,
      user_id: 'user-1',
    })
    createCandidate({
      conversation_id: 'conv-b',
      type: 'fact',
      statement: '一次性事实',
      durable: 0,
      user_id: 'user-1',
    })

    vi.mocked(hybridSearch).mockImplementation(async (_q, _u, options) => {
      if (options?.sourceType === 'candidate') {
        return [
          { content: '用户偏好深色主题', sourceType: 'candidate', sourceId: 'conv-a#1', score: 0.8 },
          { content: '一次性事实', sourceType: 'candidate', sourceId: 'conv-b#1', score: 0.7 },
        ]
      }
      return []
    })

    const result = await buildMemoryContext('user-1', '主题偏好')
    expect(result).toContain('用户偏好深色主题')
    expect(result).not.toContain('一次性事实')
  })

  it('candidates 按 ES score 排序', async () => {
    await initMemoryDb()
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '偏好A', durable: 0, user_id: 'user-1' })
    createCandidate({ conversation_id: 'conv-b', type: 'user_preference', statement: '偏好B', durable: 0, user_id: 'user-1' })

    vi.mocked(hybridSearch).mockImplementation(async (_q, _u, options) => {
      if (options?.sourceType === 'candidate') {
        return [
          { content: '偏好B', sourceType: 'candidate', sourceId: 'conv-b#1', score: 0.95 },
          { content: '偏好A', sourceType: 'candidate', sourceId: 'conv-a#1', score: 0.80 },
        ]
      }
      return []
    })

    const result = await buildMemoryContext('user-1', '测试')
    const lines = result.split('\n').filter(l => l.startsWith('- '))
    expect(lines[0]).toContain('偏好B')
    expect(lines[1]).toContain('偏好A')
  })

  it('ES 不可用时 candidates fallback 全量注入', async () => {
    await initMemoryDb()
    createCandidate({
      conversation_id: 'conv-a',
      type: 'user_preference',
      statement: '用户喜欢深色主题',
      durable: 0,
      user_id: 'user-1',
    })

    vi.mocked(hybridSearch).mockRejectedValue(new Error('ES connection refused'))

    const result = await buildMemoryContext('user-1', '你好')
    expect(result).toContain('用户喜欢深色主题')
  })

  it('无 query 时 candidates fallback 全量,不调 hybridSearch', async () => {
    await initMemoryDb()
    createCandidate({
      conversation_id: 'conv-a',
      type: 'user_preference',
      statement: '用户喜欢简洁回复',
      durable: 0,
      user_id: 'user-1',
    })

    const result = await buildMemoryContext('user-1')
    expect(result).toContain('用户喜欢简洁回复')
    expect(hybridSearch).not.toHaveBeenCalled()
  })

  it('无 userId 时 fallback 全量,不调 hybridSearch', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '用户喜欢简洁回复',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })

    const result = await buildMemoryContext(undefined, '你好')
    expect(result).toContain('用户喜欢简洁回复')
    expect(hybridSearch).not.toHaveBeenCalled()
  })

  it('向量检索无 candidate 命中时,rules 仍全量注入', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '用户住在深圳坂田',
      promotion_reason: 'explicit',
      supporting_conversations: [],
      user_id: 'user-1',
    })

    vi.mocked(hybridSearch).mockResolvedValue([])

    const result = await buildMemoryContext('user-1', '不相关的问题')
    // rules 仍全量注入
    expect(result).toContain('用户住在深圳坂田')
    // 但无 candidates 节
    expect(result).not.toContain('## 近期偏好')
  })

  it('hybridSearch 超时时 candidates fallback 全量注入', async () => {
    await initMemoryDb()
    createCandidate({
      conversation_id: 'conv-a',
      type: 'user_preference',
      statement: '用户喜欢简单',
      durable: 0,
      user_id: 'user-1',
    })

    // 永挂起的 hybridSearch,模拟 ES/embedding 卡住
    vi.mocked(hybridSearch).mockImplementation(() => new Promise(() => {}))

    vi.useFakeTimers()
    try {
      const resultPromise = buildMemoryContext('user-1', '你好')
      await vi.advanceTimersByTimeAsync(MEMORY_RECALL_TIMEOUT_MS + 1)
      const result = await resultPromise
      expect(result).toContain('用户喜欢简单')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rules 和 candidates 同时注入时保持两节结构', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '已提升的偏好',
      promotion_reason: 'explicit',
      supporting_conversations: ['conv-a'],
      user_id: 'user-1',
    })
    createCandidate({ conversation_id: 'conv-b', type: 'user_preference', statement: '待验证的偏好', durable: 0, user_id: 'user-1' })

    vi.mocked(hybridSearch).mockImplementation(async (_q, _u, options) => {
      if (options?.sourceType === 'candidate') {
        return [{ content: '待验证的偏好', sourceType: 'candidate', sourceId: 'conv-b#1', score: 0.9 }]
      }
      return []
    })

    const result = await buildMemoryContext('user-1', '测试')
    expect(result).toContain('## 长期记忆（基于历史会话总结的规则）')
    expect(result).toContain('## 近期偏好（待验证）')
    expect(result).toContain('已提升的偏好')
    expect(result).toContain('待验证的偏好')
    expect(result.indexOf('## 长期记忆')).toBeLessThan(result.indexOf('## 近期偏好'))
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
