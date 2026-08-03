import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hybridSearch } from '../../../server/src/services/rag-search'
import { getEsClient } from '../../../server/src/services/es-client'
import { embedQuery, rerank } from '../../../server/src/services/embedding-client'

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    search: vi.fn(),
  },
}))

vi.mock('../../../server/src/services/es-client', () => ({
  getEsClient: vi.fn(() => mockClient),
}))

vi.mock('../../../server/src/services/embedding-client', () => ({
  embedQuery: vi.fn(),
  rerank: vi.fn(),
}))

describe('rag-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEsClient).mockReturnValue(mockClient)
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array(1024))
  })

  it('正常检索:ES 返回 hits -> rerank -> 返回 topN RagHit', async () => {
    mockClient.search.mockResolvedValue({
      hits: {
        hits: [
          { _source: { content: '违约金月租200%', source_type: 'doc_chunk', source_id: 'd1', file_name: 'rental.pdf', page_number: 3 }, _score: 1.5 },
          { _source: { content: '押金一万', source_type: 'doc_chunk', source_id: 'd1', file_name: 'rental.pdf', page_number: 5 }, _score: 1.2 },
        ],
      },
    })
    vi.mocked(rerank).mockResolvedValue([
      { index: 0, score: 0.95 },
      { index: 1, score: 0.3 },
    ])

    const result = await hybridSearch('违约金', 'u1')

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('违约金月租200%')
    expect(result[0].sourceType).toBe('doc_chunk')
    expect(result[0].fileName).toBe('rental.pdf')
    expect(result[0].pageNumber).toBe(3)
    expect(result[0].score).toBe(0.95)
  })

  it('空结果:ES 返回 0 hits -> 返回 []', async () => {
    mockClient.search.mockResolvedValue({ hits: { hits: [] } })
    const result = await hybridSearch('不存在的内容', 'u1')
    expect(result).toEqual([])
  })

  it('filter 构建:user_id 必带 + docType + tags', async () => {
    mockClient.search.mockResolvedValue({ hits: { hits: [] } })
    await hybridSearch('query', 'u1', { docType: 'contract', tags: ['legal'] })
    const params = mockClient.search.mock.calls[0][0] as {
      query: { bool: { filter: Record<string, unknown>[] } }
      knn: { filter: Record<string, unknown>[] }
    }
    // query.bool.filter 和 knn.filter 都应有 user_id + doc_type + tags
    expect(params.query.bool.filter).toEqual([
      { term: { user_id: 'u1' } },
      { term: { doc_type: 'contract' } },
      { terms: { tags: ['legal'] } },
    ])
    expect(params.knn.filter).toEqual([
      { term: { user_id: 'u1' } },
      { term: { doc_type: 'contract' } },
      { terms: { tags: ['legal'] } },
    ])
  })

  it('knn 参数:query_vector / k / num_candidates / boost 正确', async () => {
    mockClient.search.mockResolvedValue({ hits: { hits: [] } })
    await hybridSearch('query', 'u1', { topK: 10, bm25Weight: 0.3, vectorWeight: 0.7 })
    const params = mockClient.search.mock.calls[0][0] as {
      size: number
      knn: { field: string; query_vector: number[]; k: number; num_candidates: number; boost: number }
      query: { bool: { must: Array<Record<string, unknown>> } }
    }
    expect(params.size).toBe(10)
    expect(params.knn.field).toBe('content_vector')
    expect(params.knn.query_vector.length).toBe(1024)
    expect(params.knn.k).toBe(10)
    expect(params.knn.num_candidates).toBe(100)
    expect(params.knn.boost).toBe(0.7)
    expect(params.query.bool.must[0].match.content.boost).toBe(0.3)
  })

  it('rerank 失败降级:返回原序前 topN', async () => {
    mockClient.search.mockResolvedValue({
      hits: {
        hits: [
          { _source: { content: 'A' }, _score: 1 },
          { _source: { content: 'B' }, _score: 0.8 },
        ],
      },
    })
    // rerank 降级返回原序前 topN(score=0)
    vi.mocked(rerank).mockResolvedValue([
      { index: 0, score: 0 },
      { index: 1, score: 0 },
    ])
    const result = await hybridSearch('query', 'u1', { topN: 2 })
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('A')
    expect(result[1].content).toBe('B')
  })

  it('ES 不可用(getEsClient 抛错)-> hybridSearch 抛错', async () => {
    vi.mocked(getEsClient).mockImplementation(() => {
      throw new Error('ES unavailable')
    })
    await expect(hybridSearch('query', 'u1')).rejects.toThrow('ES unavailable')
  })

  it('embedQuery 失败 -> hybridSearch 抛错', async () => {
    vi.mocked(embedQuery).mockRejectedValue(new Error('embed failed'))
    await expect(hybridSearch('query', 'u1')).rejects.toThrow('embed failed')
  })

  it('topN 截断:rerank 返回数 <= topN', async () => {
    mockClient.search.mockResolvedValue({
      hits: {
        hits: Array.from({ length: 5 }, (_, i) => ({
          _source: { content: `content${i}` },
          _score: 1,
        })),
      },
    })
    vi.mocked(rerank).mockResolvedValue([
      { index: 0, score: 0.9 },
      { index: 1, score: 0.8 },
      { index: 2, score: 0.7 },
    ])
    const result = await hybridSearch('query', 'u1', { topN: 3 })
    expect(result).toHaveLength(3)
  })

  it('score 阈值过滤:低于 scoreThreshold 的 hit 被过滤', async () => {
    mockClient.search.mockResolvedValue({
      hits: {
        hits: [
          { _source: { content: '高分内容' }, _score: 1 },
          { _source: { content: '低分内容' }, _score: 0.5 },
        ],
      },
    })
    vi.mocked(rerank).mockResolvedValue([
      { index: 0, score: 0.9 },
      { index: 1, score: 0.1 },
    ])
    const result = await hybridSearch('query', 'u1', { scoreThreshold: 0.5 })
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('高分内容')
  })
})
