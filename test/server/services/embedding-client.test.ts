import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  estimateTokens,
  embedTexts,
  embedQuery,
  rerank,
  warmupEmbedding,
} from '../../../server/src/services/embedding-client'

function mockResponse(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function makeVec(dim = 1024): number[] {
  return Array(dim).fill(0.1)
}

const mockFetch = vi.fn()

describe('embedding-client', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    process.env.EMBEDDING_AND_RERANK_API_KEY = 'test-key'
    process.env.EMBED_RETRY_DELAY = '0' // 测试用零延迟加速重试
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EMBED_RETRY_DELAY
    delete process.env.EMBED_BATCH_SIZE
    delete process.env.EMBED_CONCURRENCY
    delete process.env.EMBED_MAX_TOKENS
  })

  describe('estimateTokens', () => {
    it('按字符数/1.5 向上取整', () => {
      expect(estimateTokens('abc')).toBe(2) // 3/1.5=2
      expect(estimateTokens('你好世界')).toBe(3) // 4/1.5=2.67->3
    })
  })

  describe('embedTexts', () => {
    it('调用 /embeddings，鉴权 + model + encoding_format', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: [{ embedding: makeVec() }, { embedding: makeVec() }] }),
      )
      const result = await embedTexts(['a', 'b'])
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0]
      expect(String(url)).toContain('/embeddings')
      const initObj = init as { headers: Record<string, string>; body: string }
      expect(initObj.headers.Authorization).toBe('Bearer test-key')
      const body = JSON.parse(initObj.body)
      expect(body.model).toBe('BAAI/bge-m3')
      expect(body.encoding_format).toBe('float')
      expect(body.input).toEqual(['a', 'b'])
      expect(result).toHaveLength(2)
      expect(result[0]).toBeInstanceOf(Float32Array)
      expect(result[0].length).toBe(1024)
    })

    it('分批：batch_size=2 + 3 条 -> 2 次 fetch', async () => {
      process.env.EMBED_BATCH_SIZE = '2'
      mockFetch
        .mockResolvedValueOnce(mockResponse({ data: [{ embedding: makeVec() }, { embedding: makeVec() }] }))
        .mockResolvedValueOnce(mockResponse({ data: [{ embedding: makeVec() }] }))
      const result = await embedTexts(['a', 'b', 'c'])
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toHaveLength(3)
    })

    it('长度校验：超限抛错且不调 fetch', async () => {
      const longText = 'x'.repeat(15000) // 15000/1.5=10000 > 8000
      await expect(embedTexts([longText])).rejects.toThrow(/超过.*token 上限/)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('并发控制：最多 concurrency 个 in-flight', async () => {
      process.env.EMBED_BATCH_SIZE = '1'
      process.env.EMBED_CONCURRENCY = '2'
      let inflight = 0
      let maxInflight = 0
      mockFetch.mockImplementation(async () => {
        inflight++
        maxInflight = Math.max(maxInflight, inflight)
        await new Promise(r => setTimeout(r, 20))
        inflight--
        return mockResponse({ data: [{ embedding: makeVec() }] })
      })
      await embedTexts(['a', 'b', 'c', 'd', 'e'])
      expect(maxInflight).toBeLessThanOrEqual(2)
    })

    it('429 首次 + 200 重试成功', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({}, { ok: false, status: 429 }))
        .mockResolvedValueOnce(mockResponse({ data: [{ embedding: makeVec() }] }))
      const result = await embedTexts(['a'])
      expect(result).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('429 连续 3 次抛错', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, { ok: false, status: 429 }))
      await expect(embedTexts(['a'])).rejects.toThrow(/429/)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('网络错误（fetch reject）重试后抛错', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
      await expect(embedTexts(['a'])).rejects.toThrow(/ECONNREFUSED/)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('非 429 错误（500）直接抛错不重试', async () => {
      mockFetch.mockResolvedValue(mockResponse('server error', { ok: false, status: 500 }))
      await expect(embedTexts(['a'])).rejects.toThrow(/500/)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('embedQuery', () => {
    it('返回单条 Float32Array(1024)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ embedding: makeVec() }] }))
      const result = await embedQuery('hello')
      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(1024)
    })
  })

  describe('rerank', () => {
    it('调用 /rerank，按 score 降序', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.5 },
            { index: 1, relevance_score: 0.7 },
          ],
        }),
      )
      const result = await rerank('q', ['d0', 'd1', 'd2'], 3)
      const [url, init] = mockFetch.mock.calls[0]
      expect(String(url)).toContain('/rerank')
      const body = JSON.parse((init as { body: string }).body)
      expect(body.model).toBe('BAAI/bge-reranker-v2-m3')
      expect(body.top_n).toBe(3)
      expect(body.return_documents).toBe(false)
      expect(result[0]).toEqual({ index: 2, score: 0.9 })
      expect(result[1]).toEqual({ index: 1, score: 0.7 })
      expect(result[2]).toEqual({ index: 0, score: 0.5 })
    })

    it('500 降级原序前 topN', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse('err', { ok: false, status: 500 }))
      const result = await rerank('q', ['d0', 'd1', 'd2'], 2)
      expect(result).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ])
    })

    it('fetch reject 降级原序', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'))
      const result = await rerank('q', ['d0', 'd1'], 2)
      expect(result).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ])
    })

    it('缺 results 字段降级', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}))
      const result = await rerank('q', ['d0', 'd1'], 2)
      expect(result).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ])
    })

    it('documents < topN 降级返回全部', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'))
      const result = await rerank('q', ['only'], 5)
      expect(result).toEqual([{ index: 0, score: 0 }])
    })
  })

  describe('warmupEmbedding', () => {
    it('无 key 跳过，不调 fetch', async () => {
      delete process.env.EMBEDDING_AND_RERANK_API_KEY
      await expect(warmupEmbedding()).resolves.toBeUndefined()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('成功调用 embedQuery', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ embedding: makeVec() }] }))
      await expect(warmupEmbedding()).resolves.toBeUndefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('失败不抛错', async () => {
      mockFetch.mockRejectedValue(new Error('boom'))
      await expect(warmupEmbedding()).resolves.toBeUndefined()
    })
  })
})
