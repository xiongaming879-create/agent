import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initMemoryDb,
  resetMemoryDb,
  createCandidate,
  getUnpromotedCandidates,
  getAllRules,
} from '../../../server/src/db/memory-db'
import { promoteCandidates } from '../../../server/src/services/memory-promoter'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEST_DB = path.resolve(__dirname, '../../../server/data/memory-promoter-test.db')
process.env.MEMORY_DB_PATH = TEST_DB
process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
process.env.ANTHROPIC_BASE_URL = 'https://api.test.com'
process.env.AGENT_MODEL = 'test-model'

describe('Memory Promoter - promoteCandidates', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
    // Mock fetch to return no merge (LLM merge returns null, falls through to individual evaluation)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Mocked fetch failure'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('没有候选时返回 promoted: 0, kept: 0', async () => {
    const result = await promoteCandidates()
    expect(result).toEqual({ promoted: 0, kept: 0 })
  })

  it('单个候选不会触发晋升，保留为 kept', async () => {
    // A single candidate with no promotion-qualifying properties (no durable, not lesson, single conversation, fact type)
    createCandidate({
      conversation_id: 'conv-1',
      type: 'fact',
      statement: '普通候选无特殊属性',
      durable: 0,
    })

    const result = await promoteCandidates()
    expect(result).toEqual({ promoted: 0, kept: 1 })
  })

  it('跨会话候选（≥2 不同 conversation_id）晋升为 cross_session', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '用户使用 TypeScript', durable: 0 })
    createCandidate({ conversation_id: 'conv-b', type: 'fact', statement: '用户使用 TypeScript', durable: 0 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)
    expect(result.kept).toBe(0)

    const rules = getAllRules()
    expect(rules.length).toBe(1)
    expect(rules[0].kind).toBe('user_preference_rule')
    expect(rules[0].promotion_reason).toBe('cross_session')
    expect(rules[0].rule).toContain('TypeScript')

    // Candidates should be marked promoted
    const unpromoted = getUnpromotedCandidates()
    expect(unpromoted.length).toBe(0)
  })

  it('durable=true 的候选晋升为 explicit', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '用户要求记住主题', durable: 1 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)
    expect(result.kept).toBe(0)

    const rules = getAllRules()
    expect(rules.length).toBe(1)
    expect(rules[0].promotion_reason).toBe('explicit')
  })

  it('type=lesson 的候选晋升为 failure_evidence', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'lesson', statement: '不要直接修改生产数据库', durable: 0 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)
    expect(result.kept).toBe(0)

    const rules = getAllRules()
    expect(rules.length).toBe(1)
    expect(rules[0].promotion_reason).toBe('failure_evidence')
  })

  it('多个候选：跨会话优先于其他条件', async () => {
    // cross_session (conv-a + conv-b) should take priority over explicit (durable=1)
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '使用 React 框架', durable: 0 })
    createCandidate({ conversation_id: 'conv-b', type: 'fact', statement: '使用 React 框架', durable: 1 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)

    const rules = getAllRules()
    expect(rules[0].promotion_reason).toBe('cross_session')
  })

  it('多个候选：failure_evidence 优先级高于 explicit', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'lesson', statement: '避免内存泄漏', durable: 1 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)

    const rules = getAllRules()
    expect(rules[0].promotion_reason).toBe('failure_evidence')
  })

  it('晋升后候选被标记为 promoted=1', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'lesson', statement: '测试标记', durable: 0 })

    await promoteCandidates()

    const unpromoted = getUnpromotedCandidates()
    expect(unpromoted.length).toBe(0)
  })

  it('晋升后规则被写入 memory_rules 表', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '测试规则写入', durable: 1 })

    await promoteCandidates()

    const rules = getAllRules()
    expect(rules.length).toBe(1)
    expect(rules[0].rule).toContain('测试规则写入')
    expect(rules[0].supporting_conversations).toContain('conv-a')
  })

  // ===== 新增：user_preference 单会话提升（方案2 / L3） =====

  it('单会话 user_preference（durable=0）晋升为 explicit（个人偏好无需跨会话重复）', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '用户中午12-14点睡午觉', durable: 0 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)
    expect(result.kept).toBe(0)

    const rules = getAllRules()
    expect(rules.length).toBe(1)
    expect(rules[0].kind).toBe('user_preference_rule')
    expect(rules[0].promotion_reason).toBe('explicit')
    expect(rules[0].rule).toContain('睡午觉')
  })

  it('单会话 fact（durable=0）不提升（fact 需跨会话或 durable=1）', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'fact', statement: '一次性事实', durable: 0 })

    const result = await promoteCandidates()
    expect(result).toEqual({ promoted: 0, kept: 1 })

    const rules = getAllRules()
    expect(rules.length).toBe(0)
  })

  it('cross_session 优先于单会话 user_preference（两会话同偏好）', async () => {
    createCandidate({ conversation_id: 'conv-a', type: 'user_preference', statement: '用户喜欢简洁回复', durable: 0 })
    createCandidate({ conversation_id: 'conv-b', type: 'user_preference', statement: '用户喜欢简洁回复', durable: 0 })

    const result = await promoteCandidates()
    expect(result.promoted).toBe(1)

    const rules = getAllRules()
    expect(rules[0].promotion_reason).toBe('cross_session')
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
