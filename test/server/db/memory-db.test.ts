import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initMemoryDb,
  resetMemoryDb,
  getMemoryDb,
  createEpisode,
  createCandidate,
  getUnpromotedCandidates,
  markCandidatePromoted,
  createRule,
  getAllRules,
  backfillMemoryUserIds,
} from '../../../server/src/db/memory-db'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEST_DB = path.resolve(__dirname, '../../../server/data/memory-test.db')
process.env.MEMORY_DB_PATH = TEST_DB

describe('Memory Database — 数据库初始化', () => {
  beforeEach(() => {
    // Clean up any previous test database
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
  })

  it('initMemoryDb() 创建数据库文件和表', async () => {
    expect(fs.existsSync(TEST_DB)).toBe(false)
    await initMemoryDb()
    expect(fs.existsSync(TEST_DB)).toBe(true)

    const db = getMemoryDb()
    // Verify all three tables exist
    const tables = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    )
    const tableNames = tables[0]?.values.map(r => r[0] as string) ?? []
    expect(tableNames).toContain('memory_episodes')
    expect(tableNames).toContain('memory_candidates')
    expect(tableNames).toContain('memory_rules')
  })

  it('重复调用 initMemoryDb() 不会报错', async () => {
    await initMemoryDb()
    await initMemoryDb() // Should not throw
    const db = getMemoryDb()
    expect(db).toBeTruthy()
  })
})

describe('Memory Database — Episode CRUD', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  it('createEpisode() 写入并读取 episode', () => {
    const episode = createEpisode({
      conversation_id: 'conv-1',
      summary: '用户询问了天气情况',
      candidate_count: 0,
    })
    expect(episode.id).toBeTruthy()
    expect(typeof episode.id).toBe('string')

    // Verify by direct query
    const db = getMemoryDb()
    const result = db.exec('SELECT id, conversation_id, summary, candidate_count FROM memory_episodes WHERE id = ?', [episode.id])
    expect(result[0].values.length).toBe(1)
    const row = result[0].values[0]
    expect(row[1]).toBe('conv-1')
    expect(row[2]).toBe('用户询问了天气情况')
    expect(row[3]).toBe(0)
  })

  it('createEpisode() 可设置 candidate_count', () => {
    const episode = createEpisode({
      conversation_id: 'conv-2',
      summary: '用户反馈了偏好',
      candidate_count: 3,
    })
    const db = getMemoryDb()
    const result = db.exec('SELECT candidate_count FROM memory_episodes WHERE id = ?', [episode.id])
    expect(result[0].values[0][0]).toBe(3)
  })
})

describe('Memory Database — Candidate CRUD', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  it('createCandidate() 写入 candidate，id 格式为 {conversation_id}#{index}', () => {
    const candidate = createCandidate({
      conversation_id: 'conv-a',
      type: 'user_preference',
      statement: '用户喜欢简洁的回复',
      durable: 1,
    })
    expect(candidate.id).toBe('conv-a#1')
  })

  it('createCandidate() 自增 index', () => {
    const c1 = createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '事实1', durable: 0 })
    const c2 = createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '事实2', durable: 0 })
    const c3 = createCandidate({ conversation_id: 'conv-b', type: 'fact', statement: '其他会话', durable: 0 })
    expect(c1.id).toBe('conv-a#1')
    expect(c2.id).toBe('conv-a#2')
    expect(c3.id).toBe('conv-b#1')
  })

  it('createCandidate() 写入后可查询到正确字段', () => {
    createCandidate({
      conversation_id: 'conv-c',
      type: 'lesson',
      statement: '用户学到了新知识',
      durable: 1,
    })
    const db = getMemoryDb()
    const result = db.exec(
      'SELECT id, conversation_id, type, statement, durable, promoted FROM memory_candidates WHERE id = ?',
      ['conv-c#1']
    )
    expect(result[0].values.length).toBe(1)
    const row = result[0].values[0]
    expect(row[1]).toBe('conv-c')
    expect(row[2]).toBe('lesson')
    expect(row[3]).toBe('用户学到了新知识')
    expect(row[4]).toBe(1)
    expect(row[5]).toBe(0) // default promoted = 0
  })
})

describe('Memory Database — 候选晋升管理', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  it('getUnpromotedCandidates() 只返回 promoted=0 的候选', () => {
    createCandidate({ conversation_id: 'conv-x', type: 'fact', statement: '未晋升1', durable: 0 })
    createCandidate({ conversation_id: 'conv-x', type: 'fact', statement: '未晋升2', durable: 0 })
    const c3 = createCandidate({ conversation_id: 'conv-x', type: 'fact', statement: '已晋升', durable: 0 })
    markCandidatePromoted(c3.id)

    const unpromoted = getUnpromotedCandidates()
    expect(unpromoted.length).toBe(2)
    expect(unpromoted.every(c => c.promoted === 0)).toBe(true)
    expect(unpromoted.map(c => c.statement)).not.toContain('已晋升')
  })

  it('markCandidatePromoted() 正确标记 promoted=1', () => {
    const c = createCandidate({ conversation_id: 'conv-y', type: 'fact', statement: '待晋升', durable: 0 })
    expect(c.promoted).toBe(0)

    markCandidatePromoted(c.id)
    const db = getMemoryDb()
    const result = db.exec('SELECT promoted FROM memory_candidates WHERE id = ?', [c.id])
    expect(result[0].values[0][0]).toBe(1)
  })

  it('getUnpromotedCandidates() 返回完整字段', () => {
    createCandidate({ conversation_id: 'conv-z', type: 'user_preference', statement: '偏好记录', durable: 1 })
    const candidates = getUnpromotedCandidates()
    expect(candidates.length).toBe(1)
    expect(candidates[0].id).toBe('conv-z#1')
    expect(candidates[0].conversation_id).toBe('conv-z')
    expect(candidates[0].type).toBe('user_preference')
    expect(candidates[0].statement).toBe('偏好记录')
    expect(candidates[0].durable).toBe(1)
    expect(candidates[0].promoted).toBe(0)
    expect(candidates[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('Memory Database — Rule CRUD', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  it('createRule() 写入 rule，id 格式为 rule_{n}（自增）', () => {
    const r1 = createRule({
      kind: 'user_preference_rule',
      rule: '用户喜欢简洁回复',
      promotion_reason: 'cross_session',
      supporting_conversations: ['conv-1'],
    })
    expect(r1.id).toBe('rule_1')

    const r2 = createRule({
      kind: 'project_rule',
      rule: '代码使用 TypeScript',
      promotion_reason: 'explicit',
      supporting_conversations: [],
    })
    expect(r2.id).toBe('rule_2')
  })

  it('createRule() 写入后字段正确', () => {
    createRule({
      kind: 'stable_fact',
      rule: '地球是圆的',
      promotion_reason: 'explicit',
      supporting_conversations: ['conv-a', 'conv-b'],
    })
    const db = getMemoryDb()
    const result = db.exec(
      'SELECT id, kind, rule, promotion_reason, supporting_conversations FROM memory_rules WHERE id = ?',
      ['rule_1']
    )
    expect(result[0].values.length).toBe(1)
    const row = result[0].values[0]
    expect(row[0]).toBe('rule_1')
    expect(row[1]).toBe('stable_fact')
    expect(row[2]).toBe('地球是圆的')
    expect(row[3]).toBe('explicit')
    // supporting_conversations is stored as JSON array string
    expect(JSON.parse(row[4] as string)).toEqual(['conv-a', 'conv-b'])
  })

  it('getAllRules() 返回所有规则', () => {
    createRule({ kind: 'user_preference_rule', rule: '规则A', promotion_reason: 'cross_session', supporting_conversations: [] })
    createRule({ kind: 'project_rule', rule: '规则B', promotion_reason: 'failure_evidence', supporting_conversations: [] })
    createRule({ kind: 'stable_fact', rule: '规则C', promotion_reason: 'explicit', supporting_conversations: [] })

    const rules = getAllRules()
    expect(rules.length).toBe(3)
    expect(rules.map(r => r.rule)).toContain('规则A')
    expect(rules.map(r => r.rule)).toContain('规则B')
    expect(rules.map(r => r.rule)).toContain('规则C')
  })

  it('getAllRules() 返回完整字段', () => {
    createRule({
      kind: 'user_preference_rule',
      rule: '测试规则',
      promotion_reason: 'cross_session',
      supporting_conversations: ['conv-1'],
    })
    const rules = getAllRules()
    expect(rules.length).toBe(1)
    const r = rules[0]
    expect(r.id).toBe('rule_1')
    expect(r.kind).toBe('user_preference_rule')
    expect(r.rule).toBe('测试规则')
    expect(r.promotion_reason).toBe('cross_session')
    expect(r.supporting_conversations).toEqual(['conv-1'])
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('getAllRules() 没有规则时返回空数组', () => {
    const rules = getAllRules()
    expect(rules).toEqual([])
  })
})

describe('Memory Database - 用户隔离（user_id）', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  it('createCandidate 带 user_id 时正确写入', () => {
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '事实', durable: 0, user_id: 'user-1' })
    const db = getMemoryDb()
    const result = db.exec('SELECT user_id FROM memory_candidates WHERE id = ?', ['conv-a#1'])
    expect(result[0].values[0][0]).toBe('user-1')
  })

  it('getUnpromotedCandidates(userId) 只返回该用户的候选', () => {
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: 'A的候选', durable: 0, user_id: 'user-1' })
    createCandidate({ conversation_id: 'conv-b', type: 'fact', statement: 'B的候选', durable: 0, user_id: 'user-2' })
    const user1 = getUnpromotedCandidates('user-1')
    expect(user1.length).toBe(1)
    expect(user1[0].statement).toBe('A的候选')
  })

  it('getAllRules(userId) 只返回该用户的规则', () => {
    createRule({ kind: 'user_preference_rule', rule: '用户1的规则', promotion_reason: 'explicit', supporting_conversations: [], user_id: 'user-1' })
    createRule({ kind: 'user_preference_rule', rule: '用户2的规则', promotion_reason: 'explicit', supporting_conversations: [], user_id: 'user-2' })
    const user1Rules = getAllRules('user-1')
    expect(user1Rules.length).toBe(1)
    expect(user1Rules[0].rule).toBe('用户1的规则')
  })

  it('backfillMemoryUserIds 通过 conversation_id 回填 user_id', () => {
    const db = getMemoryDb()
    db.run(
      `INSERT INTO memory_candidates (id, conversation_id, type, statement, durable, promoted, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['conv-x#1', 'conv-x', 'fact', '老数据', 0, 0, new Date().toISOString(), null]
    )
    const result = backfillMemoryUserIds((convId) => convId === 'conv-x' ? 'backfilled-user' : null)
    expect(result.candidates).toBe(1)
    const cands = getUnpromotedCandidates('backfilled-user')
    expect(cands.length).toBe(1)
    expect(cands[0].statement).toBe('老数据')
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
