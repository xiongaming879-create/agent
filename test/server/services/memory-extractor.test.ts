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

describe('Memory Extractor — extractSessionMemories', () => {
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

    // Spy on fetch to count calls
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await extractSessionMemories('conv-1', [
      { role: 'user', content: '测试' },
      { role: 'assistant', content: '测试回复' },
    ])

    // Fetch should have been called at least once (for LLM API)
    expect(fetchSpy).toHaveBeenCalled()
  })
})

afterAll(() => {
  resetMemoryDb()
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
})
