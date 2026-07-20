import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initMemoryDb,
  resetMemoryDb,
  createRule,
  createCandidate,
  getMemoryDb,
} from '../../../server/src/db/memory-db'
import { buildMemoryContext } from '../../../server/src/services/memory-recall'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEST_DB = path.resolve(__dirname, '../../../server/data/memory-recall-test.db')
process.env.MEMORY_DB_PATH = TEST_DB

describe('Memory Recall - buildMemoryContext()', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
  })

  it('没有规则时返回空字符串', async () => {
    await initMemoryDb()
    const result = buildMemoryContext()
    expect(result).toBe('')
  })

  it('有规则时返回格式化的记忆上下文字符串', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '用户喜欢简洁的回复',
      promotion_reason: 'cross_session',
      supporting_conversations: ['conv-1'],
    })

    const result = buildMemoryContext()
    expect(result).toContain('## 长期记忆（基于历史会话总结的规则）')
    expect(result).toContain('- [用户偏好] 用户喜欢简洁的回复')
  })

  it('不同类型规则使用正确的中文标签', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '偏好规则',
      promotion_reason: 'cross_session',
      supporting_conversations: [],
    })
    createRule({
      kind: 'project_rule',
      rule: '项目规则',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })
    createRule({
      kind: 'stable_fact',
      rule: '稳定事实',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })

    const result = buildMemoryContext()
    expect(result).toContain('- [用户偏好] 偏好规则')
    expect(result).toContain('- [项目规则] 项目规则')
    expect(result).toContain('- [稳定事实] 稳定事实')
  })

  it('多条规则按创建时间排序', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '第一条规则',
      promotion_reason: 'cross_session',
      supporting_conversations: [],
    })
    createRule({
      kind: 'project_rule',
      rule: '第二条规则',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })
    createRule({
      kind: 'stable_fact',
      rule: '第三条规则',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })

    const result = buildMemoryContext()
    const lines = result.split('\n').filter(l => l.startsWith('- ['))
    expect(lines.length).toBe(3)
    // Should be in creation order
    expect(lines[0]).toContain('第一条规则')
    expect(lines[1]).toContain('第二条规则')
    expect(lines[2]).toContain('第三条规则')
  })

  it('规则内容被正确包含在输出中', async () => {
    await initMemoryDb()
    createRule({
      kind: 'stable_fact',
      rule: '地球是圆的，围绕太阳公转',
      promotion_reason: 'explicit',
      supporting_conversations: ['conv-a', 'conv-b'],
    })

    const result = buildMemoryContext()
    expect(result).toContain('地球是圆的，围绕太阳公转')
    expect(result).toMatch(/^## 长期记忆/)
    // Verify there's a newline at the end for clean concatenation
    expect(result.endsWith('\n')).toBe(true)
  })

  it('构建完整输出格式正确', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '用户偏好A',
      promotion_reason: 'cross_session',
      supporting_conversations: ['c1'],
    })
    createRule({
      kind: 'project_rule',
      rule: '项目规则B',
      promotion_reason: 'failure_evidence',
      supporting_conversations: ['c2'],
    })

    const result = buildMemoryContext()
    const expected = '## 长期记忆（基于历史会话总结的规则）\n- [用户偏好] 用户偏好A\n- [项目规则] 项目规则B\n'
    expect(result).toBe(expected)
  })

  // ===== 新增：recall 读 candidates（方案2 / L4） =====

  it('unpromoted user_preference candidate 被注入近期偏好节', async () => {
    await initMemoryDb()
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '用户喜欢深色主题', durable: 0 })

    const result = buildMemoryContext()
    expect(result).toContain('## 近期偏好（待验证）')
    expect(result).toContain('用户喜欢深色主题')
  })

  it('fact/lesson candidate 不被注入（只 user_preference）', async () => {
    await initMemoryDb()
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '一次性事实', durable: 0 })
    createCandidate({ conversation_id: 'conv-b', type: 'lesson', statement: '一次性教训', durable: 0 })

    const result = buildMemoryContext()
    // 无 rules 且无 user_preference candidates -> 空字符串
    expect(result).toBe('')
  })

  it('有 rules 有 candidates 时输出两节', async () => {
    await initMemoryDb()
    createRule({
      kind: 'user_preference_rule',
      rule: '已提升的偏好',
      promotion_reason: 'explicit',
      supporting_conversations: ['conv-a'],
    })
    createCandidate({ conversation_id: 'conv-b', type: 'user_preference', statement: '待验证的偏好', durable: 0 })

    const result = buildMemoryContext()
    expect(result).toContain('## 长期记忆（基于历史会话总结的规则）')
    expect(result).toContain('## 近期偏好（待验证）')
    expect(result).toContain('已提升的偏好')
    expect(result).toContain('待验证的偏好')
    // 两节顺序：长期记忆在前，近期偏好在后
    expect(result.indexOf('## 长期记忆')).toBeLessThan(result.indexOf('## 近期偏好'))
  })

  it('已 promoted 的 candidate 不被注入', async () => {
    await initMemoryDb()
    // 直接 SQL 插入一个 promoted=1 的 user_preference candidate
    const db = getMemoryDb()
    db.run(
      `INSERT INTO memory_candidates (id, conversation_id, type, statement, durable, promoted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['conv-prom#1', 'conv-prom', 'user_preference', '已提升的偏好不应出现', 0, 1, new Date().toISOString()]
    )

    const result = buildMemoryContext()
    expect(result).not.toContain('已提升的偏好不应出现')
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
