import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initMemoryDb,
  resetMemoryDb,
  getMemoryDb,
} from '../../../server/src/db/memory-db'
import { extractSessionMemories } from '../../../server/src/services/memory-extractor'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEST_DB = path.resolve(__dirname, '../../../server/data/memory-extractor-test.db')
process.env.MEMORY_DB_PATH = TEST_DB
process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
process.env.ANTHROPIC_BASE_URL = 'https://api.test.com'
process.env.AGENT_MODEL = 'test-model'

function mockLLMResponse(responseBody: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      content: [{ text: JSON.stringify(responseBody) }],
    }), { status: 200 })
  )
}

function mockLLMTextResponse(text: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      content: [{ text }],
    }), { status: 200 })
  )
}

function mockLLMFailure() {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
}

function mockLLMInvalidResponse() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      content: [{ text: '这不是有效的 JSON 格式' }],
    }), { status: 200 })
  )
}

describe('Memory Extractor - extractSessionMemories', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    resetMemoryDb()
    await initMemoryDb()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('消息数 < 2 时直接返回，不调用 API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await extractSessionMemories('conv-1', [
      { role: 'user', content: '你好' },
    ])

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('正常抽取：调用 createEpisode 和 createCandidate', async () => {
    mockLLMResponse({
      episode_summary: '用户询问了天气，助手给出了回答',
      memory_items: [
        { type: 'fact', statement: '用户住在北京', durable: false },
        { type: 'user_preference', statement: '用户喜欢简洁回复', durable: true },
      ],
    })

    await extractSessionMemories('conv-1', [
      { role: 'user', content: '北京今天天气怎么样？' },
      { role: 'assistant', content: '北京今天晴，20-25度。' },
    ])

    // Verify episode was created
    const db = getMemoryDb()
    const episodes = db.exec('SELECT conversation_id, summary FROM memory_episodes')
    expect(episodes[0].values.length).toBe(1)
    expect(episodes[0].values[0][0]).toBe('conv-1')
    expect(episodes[0].values[0][1]).toContain('用户询问了天气')

    // Verify candidates were created
    const candidates = db.exec('SELECT type, statement, durable FROM memory_candidates')
    expect(candidates[0].values.length).toBe(2)
    const statements = candidates[0].values.map(r => r[1] as string)
    expect(statements).toContain('用户住在北京')
    expect(statements).toContain('用户喜欢简洁回复')
  })

  it('API 调用失败时不抛异常，只打 warning', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockLLMFailure()

    await expect(
      extractSessionMemories('conv-1', [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮助你的？' },
      ])
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('解析失败时（返回无效格式）不抛异常，只打 warning', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockLLMInvalidResponse()

    await expect(
      extractSessionMemories('conv-1', [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！' },
      ])
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('单条消息内容超过 2000 字符时被截断', async () => {
    const longContent = 'a'.repeat(3000)
    let capturedBody = ''

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      capturedBody = options?.body as string
      return new Response(JSON.stringify({
        content: [{ text: JSON.stringify({
          episode_summary: '测试截断',
          memory_items: [],
        }) }],
      }), { status: 200 })
    })

    await extractSessionMemories('conv-1', [
      { role: 'user', content: longContent },
      { role: 'assistant', content: '回复' },
    ])

    // The long content should be truncated to 2000 chars in the API request
    expect(capturedBody).toContain('a'.repeat(2000))
    expect(capturedBody).not.toContain('a'.repeat(2001))
  })

  it('promoteCandidates() 被调用（fire-and-forget）', async () => {
    // Mock fetch for both LLM call and any internal calls
    mockLLMResponse({
      episode_summary: '测试 promote',
      memory_items: [
        { type: 'fact', statement: '测试', durable: false },
      ],
    })

    // Spy on Fetch to count calls
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await extractSessionMemories('conv-1', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '测试回复' },
    ])

    // Fetch should have been called at least once (for LLM API)
    expect(fetchSpy).toHaveBeenCalled()
  })

  // ===== 新增：parseResponse 容错测试（方案1 / L1） =====

  it('markdown 代码块包裹的 JSON 能解析', async () => {
    mockLLMTextResponse('```json\n{"episode_summary":"测试 markdown 包裹","memory_items":[{"type":"user_preference","statement":"用户喜欢深色主题","durable":true}]}\n```')
    await extractSessionMemories('conv-md', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '回复' },
    ])
    const db = getMemoryDb()
    const episodes = db.exec('SELECT summary FROM memory_episodes')
    expect(episodes[0].values[0][0]).toBe('测试 markdown 包裹')
    const candidates = db.exec('SELECT statement FROM memory_candidates')
    expect(candidates[0].values[0][0]).toBe('用户喜欢深色主题')
  })

  it('字段顺序反转的 JSON 能解析（memory_items 在 episode_summary 前）', async () => {
    mockLLMTextResponse('{"memory_items":[{"type":"fact","statement":"事实A","durable":false}],"episode_summary":"顺序反转测试"}')
    await extractSessionMemories('conv-rev', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '回复' },
    ])
    const db = getMemoryDb()
    const episodes = db.exec('SELECT summary FROM memory_episodes')
    expect(episodes[0].values[0][0]).toBe('顺序反转测试')
  })

  it('JSON 前后有说明文字时仍能提取（extractFirstJsonObject）', async () => {
    mockLLMTextResponse('好的，以下是提取的记忆：\n{"episode_summary":"带说明文字","memory_items":[]}\n以上是结果。')
    await extractSessionMemories('conv-explain', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '回复' },
    ])
    const db = getMemoryDb()
    const episodes = db.exec('SELECT summary FROM memory_episodes')
    expect(episodes[0].values[0][0]).toBe('带说明文字')
  })

  it('中文冒号的文本格式能解析', async () => {
    mockLLMTextResponse('episode_summary：用户询问了偏好\ntype：user_preference\nstatement：用户中午12-14点睡午觉\ndurable：true')
    await extractSessionMemories('conv-cn', [
      { role: 'user', content: '我有睡午觉习惯' },
      { role: 'assistant', content: '好的' },
    ])
    const db = getMemoryDb()
    const candidates = db.exec('SELECT statement, durable FROM memory_candidates')
    expect(candidates[0].values[0][0]).toBe('用户中午12-14点睡午觉')
    expect(candidates[0].values[0][1]).toBe(1) // durable=true -> 1
  })

  // ===== 新增：标准化 callLLM 测试（方案1 / L5） =====

  it('请求 body 的 system 是顶层字段，messages 不含 system role', async () => {
    let capturedBody = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      capturedBody = options?.body as string
      return new Response(JSON.stringify({
        content: [{ text: JSON.stringify({ episode_summary: '测试', memory_items: [] }) }],
      }), { status: 200 })
    })
    await extractSessionMemories('conv-sys', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '回复' },
    ])
    const body = JSON.parse(capturedBody)
    expect(body.system).toBeTruthy()
    expect(typeof body.system).toBe('string')
    expect(Array.isArray(body.messages)).toBe(true)
    for (const m of body.messages) {
      expect(m.role).not.toBe('system')
    }
  })

  // ===== 新增：prompt 含 durable 判定标准（方案3 / L2） =====

  it('prompt 含个人习惯/长期偏好的 durable 判定标准', async () => {
    let capturedBody = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      capturedBody = options?.body as string
      return new Response(JSON.stringify({
        content: [{ text: JSON.stringify({ episode_summary: '测试', memory_items: [] }) }],
      }), { status: 200 })
    })
    await extractSessionMemories('conv-prompt', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '回复' },
    ])
    const body = JSON.parse(capturedBody)
    expect(body.system).toContain('个人习惯')
    expect(body.system).toContain('长期偏好')
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
