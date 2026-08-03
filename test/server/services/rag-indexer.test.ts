import { describe, it, expect, beforeEach, vi } from 'vitest'
import { indexDocument, indexConversationMessages, indexCandidate, indexRule } from '../../../server/src/services/rag-indexer'
import { getEsClient } from '../../../server/src/services/es-client'
import { embedTexts } from '../../../server/src/services/embedding-client'
import { getMessages } from '../../../server/src/db'
import { chunkByType, splitOverflow } from '../../../server/src/services/rag-chunker'

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    deleteByQuery: vi.fn(),
    bulk: vi.fn(),
  },
}))

vi.mock('../../../server/src/services/es-client', () => ({
  getEsClient: vi.fn(() => mockClient),
}))

vi.mock('../../../server/src/services/embedding-client', () => ({
  embedTexts: vi.fn(),
}))

vi.mock('../../../server/src/services/rag-chunker', () => ({
  chunkByType: vi.fn(),
  splitOverflow: vi.fn(),
}))

vi.mock('../../../server/src/db', () => ({
  getMessages: vi.fn(),
}))

describe('rag-indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.deleteByQuery.mockResolvedValue({ deleted: 0 })
    mockClient.bulk.mockResolvedValue({ errors: false })
    vi.mocked(getEsClient).mockReturnValue(mockClient)
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(() => new Float32Array(1024)),
    )
    vi.mocked(chunkByType).mockImplementation((text: string) => [text])
    vi.mocked(splitOverflow).mockImplementation((c: string) => [c])
    vi.mocked(getMessages).mockReturnValue([])
  })

  describe('indexDocument', () => {
    it('正常流程:单 chunk 写入', async () => {
      const result = await indexDocument({
        text: 'hello world',
        userId: 'u1',
        sourceType: 'message',
        sourceId: 'm1',
        meta: { docId: 'msg:m1' },
      })
      expect(result.indexed).toBe(1)
      expect(result.skipped).toBe(0)
      expect(mockClient.deleteByQuery).toHaveBeenCalledTimes(1)
      expect(embedTexts).toHaveBeenCalledWith(['hello world'])
      expect(mockClient.bulk).toHaveBeenCalledTimes(1)
    })

    it('doc_id 幂等:deleteByQuery 带 doc_id + user_id 双 filter', async () => {
      await indexDocument({
        text: 'test',
        userId: 'u1',
        sourceType: 'message',
        sourceId: 'm1',
        meta: { docId: 'msg:m1' },
      })
      const params = mockClient.deleteByQuery.mock.calls[0][0] as {
        query: { bool: { filter: unknown[] } }
      }
      expect(params.query.bool.filter).toEqual([
        { term: { doc_id: 'msg:m1' } },
        { term: { user_id: 'u1' } },
      ])
    })

    it('sourceType=doc_chunk 走 chunkByType(多 chunk)', async () => {
      vi.mocked(chunkByType).mockReturnValue(['chunk1', 'chunk2'])
      const result = await indexDocument({
        text: 'long text',
        userId: 'u1',
        sourceType: 'doc_chunk',
        sourceId: 'doc1',
        meta: { docId: 'doc1', docType: 'markdown' },
      })
      expect(result.indexed).toBe(2)
      expect(embedTexts).toHaveBeenCalledWith(['chunk1', 'chunk2'])
      const bulkParams = mockClient.bulk.mock.calls[0][0] as { operations: unknown[] }
      expect(bulkParams.operations.length).toBe(4)
    })

    it('hash 去重:相同 chunk 只 embed 一次', async () => {
      vi.mocked(chunkByType).mockReturnValue(['same', 'same', 'diff'])
      const result = await indexDocument({
        text: 'text',
        userId: 'u1',
        sourceType: 'doc_chunk',
        sourceId: 'doc1',
        meta: { docId: 'doc1' },
      })
      expect(result.indexed).toBe(2)
      expect(result.skipped).toBe(1)
      expect(embedTexts).toHaveBeenCalledWith(['same', 'diff'])
    })

    it('ES 不可用(getEsClient 抛错)-> indexDocument 抛错', async () => {
      vi.mocked(getEsClient).mockImplementation(() => {
        throw new Error('ES unavailable')
      })
      await expect(
        indexDocument({
          text: 'test',
          userId: 'u1',
          sourceType: 'message',
          sourceId: 'm1',
          meta: { docId: 'msg:m1' },
        }),
      ).rejects.toThrow('ES unavailable')
    })

    it('embedTexts 失败 -> indexDocument 抛错', async () => {
      vi.mocked(embedTexts).mockRejectedValue(new Error('embed failed'))
      await expect(
        indexDocument({
          text: 'test',
          userId: 'u1',
          sourceType: 'message',
          sourceId: 'm1',
          meta: { docId: 'msg:m1' },
        }),
      ).rejects.toThrow('embed failed')
    })

    it('bulk 写入携带完整元数据', async () => {
      await indexDocument({
        text: 'test',
        userId: 'u1',
        sourceType: 'doc_chunk',
        sourceId: 'doc1',
        meta: {
          docId: 'doc1',
          fileName: 'contract.pdf',
          filePath: '/uploads/contract.pdf',
          pageNumber: 3,
          docType: 'contract',
          uploadedAt: '2026-07-31',
          tags: ['legal', 'rental'],
        },
      })
      const bulkParams = mockClient.bulk.mock.calls[0][0] as { operations: unknown[] }
      const doc = bulkParams.operations[1] as Record<string, unknown>
      expect(doc.content).toBe('test')
      expect(doc.source_type).toBe('doc_chunk')
      expect(doc.source_id).toBe('doc1')
      expect(doc.user_id).toBe('u1')
      expect(doc.doc_id).toBe('doc1')
      expect(doc.file_name).toBe('contract.pdf')
      expect(doc.page_number).toBe(3)
      expect(doc.doc_type).toBe('contract')
      expect(doc.tags).toEqual(['legal', 'rental'])
      expect(doc.chunk_hash).toBeTruthy()
      expect(doc.chunk_index).toBe(0)
    })

    it('_id 格式为 userId#docId#chunkIndex', async () => {
      vi.mocked(chunkByType).mockReturnValue(['a', 'b'])
      await indexDocument({
        text: 'text',
        userId: 'u1',
        sourceType: 'doc_chunk',
        sourceId: 'doc1',
        meta: { docId: 'doc1' },
      })
      const bulkParams = mockClient.bulk.mock.calls[0][0] as { operations: unknown[] }
      const id0 = (bulkParams.operations[0] as { index: { _id: string } }).index._id
      const id1 = (bulkParams.operations[2] as { index: { _id: string } }).index._id
      expect(id0).toBe('u1#doc1#0')
      expect(id1).toBe('u1#doc1#1')
    })
  })

  describe('indexConversationMessages', () => {
    it('逐条索引消息(跳过 system)', async () => {
      vi.mocked(getMessages).mockReturnValue([
        { id: 'm1', role: 'system', content: 'sys', created_at: '2026-01-01' },
        { id: 'm2', role: 'user', content: 'hello', created_at: '2026-01-01' },
        { id: 'm3', role: 'assistant', content: 'hi', created_at: '2026-01-01' },
      ] as unknown as ReturnType<typeof getMessages>)
      await indexConversationMessages('conv1', 'u1')
      expect(mockClient.deleteByQuery).toHaveBeenCalledTimes(2)
      expect(mockClient.bulk).toHaveBeenCalledTimes(2)
    })
  })

  describe('indexCandidate', () => {
    it('整条索引 candidate', async () => {
      await indexCandidate({ id: 'c1', statement: '用户喜欢咖啡', userId: 'u1' })
      expect(embedTexts).toHaveBeenCalledWith(['用户喜欢咖啡'])
      const bulkParams = mockClient.bulk.mock.calls[0][0] as { operations: unknown[] }
      const doc = bulkParams.operations[1] as Record<string, unknown>
      expect(doc.source_type).toBe('candidate')
      expect(doc.source_id).toBe('c1')
      expect(doc.doc_id).toBe('candidate:c1')
    })
  })

  describe('indexRule', () => {
    it('整条索引 rule', async () => {
      await indexRule({ id: 'rule_1', rule: '用户偏好深色模式', userId: 'u1' })
      expect(embedTexts).toHaveBeenCalledWith(['用户偏好深色模式'])
      const bulkParams = mockClient.bulk.mock.calls[0][0] as { operations: unknown[] }
      const doc = bulkParams.operations[1] as Record<string, unknown>
      expect(doc.source_type).toBe('rule')
      expect(doc.source_id).toBe('rule_1')
      expect(doc.doc_id).toBe('rule:rule_1')
    })
  })
})
