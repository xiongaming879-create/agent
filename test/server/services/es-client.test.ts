import { describe, it, expect, vi } from 'vitest'
import {
  buildRagIndexMapping,
  ensureRagIndex,
  checkDiskWatermark,
  initEsClient,
  getEsClient,
  type EsClientLike,
} from '../../../server/src/services/es-client'

describe('buildRagIndexMapping', () => {
  const mapping = buildRagIndexMapping()

  it('settings: 1 分片 0 副本', () => {
    expect(mapping.settings.number_of_shards).toBe(1)
    expect(mapping.settings.number_of_replicas).toBe(0)
  })

  it('content: text + ik_max_word + ik_smart', () => {
    expect(mapping.mappings.properties.content).toEqual({
      type: 'text',
      analyzer: 'ik_max_word',
      search_analyzer: 'ik_smart',
    })
  })

  it('content_vector: dense_vector dims 1024 + cosine + index', () => {
    expect(mapping.mappings.properties.content_vector).toEqual({
      type: 'dense_vector',
      dims: 1024,
      index: true,
      similarity: 'cosine',
    })
  })

  it('元数据全部字段化（非 object 聚合）', () => {
    const props = mapping.mappings.properties
    const expected: Record<string, string> = {
      user_id: 'keyword',
      doc_id: 'keyword',
      file_name: 'keyword',
      file_path: 'keyword',
      page_number: 'integer',
      doc_type: 'keyword',
      uploaded_at: 'date',
      tags: 'keyword',
      chunk_hash: 'keyword',
      chunk_index: 'integer',
      source_type: 'keyword',
      source_id: 'keyword',
      created_at: 'date',
    }
    for (const [field, type] of Object.entries(expected)) {
      expect(props[field]).toBeDefined()
      expect((props[field] as { type: string }).type).toBe(type)
    }
  })
})

describe('ensureRagIndex', () => {
  it('index 不存在时调用 create（带 mapping）', async () => {
    const mockClient = {
      info: vi.fn(),
      indices: {
        exists: vi.fn().mockResolvedValue(false),
        create: vi.fn().mockResolvedValue({}),
      },
      cluster: { stats: vi.fn() },
    }
    await ensureRagIndex(mockClient as unknown as EsClientLike, 'rag_index')
    expect(mockClient.indices.exists).toHaveBeenCalledWith({ index: 'rag_index' })
    expect(mockClient.indices.create).toHaveBeenCalledWith({
      index: 'rag_index',
      ...buildRagIndexMapping(),
    })
  })

  it('index 已存在时不调用 create', async () => {
    const mockClient = {
      indices: {
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn(),
      },
    }
    await ensureRagIndex(mockClient as unknown as EsClientLike, 'rag_index')
    expect(mockClient.indices.create).not.toHaveBeenCalled()
  })

  it('exists 返回 {body:true}（v8 兼容）时不重建', async () => {
    const mockClient = {
      indices: {
        exists: vi.fn().mockResolvedValue({ body: true }),
        create: vi.fn(),
      },
    }
    await ensureRagIndex(mockClient as unknown as EsClientLike, 'rag_index')
    expect(mockClient.indices.create).not.toHaveBeenCalled()
  })

  it('exists 返回 {body:false} 时创建', async () => {
    const mockClient = {
      indices: {
        exists: vi.fn().mockResolvedValue({ body: false }),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    await ensureRagIndex(mockClient as unknown as EsClientLike)
    expect(mockClient.indices.create).toHaveBeenCalled()
  })

  it('默认使用 RAG_INDEX 环境变量值', async () => {
    const mockClient = {
      indices: {
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn(),
      },
    }
    await ensureRagIndex(mockClient as unknown as EsClientLike)
    expect(mockClient.indices.exists).toHaveBeenCalledWith(
      expect.objectContaining({ index: expect.any(String) }),
    )
  })
})

describe('checkDiskWatermark', () => {
  it('剩余 < 阈值 -> warn=true', async () => {
    const mockClient = {
      cluster: { stats: vi.fn().mockResolvedValue({ nodes: { fs: { free_in_bytes: 5 * 1024 ** 3 } } }) },
    }
    const result = await checkDiskWatermark(mockClient as unknown as EsClientLike)
    expect(result.freeGb).toBeCloseTo(5, 1)
    expect(result.warn).toBe(true)
  })

  it('剩余 >= 阈值 -> warn=false', async () => {
    const mockClient = {
      cluster: { stats: vi.fn().mockResolvedValue({ nodes: { fs: { free_in_bytes: 20 * 1024 ** 3 } } }) },
    }
    const result = await checkDiskWatermark(mockClient as unknown as EsClientLike)
    expect(result.warn).toBe(false)
  })

  it('缺 fs 字段 -> freeGb=0, warn=true', async () => {
    const mockClient = {
      cluster: { stats: vi.fn().mockResolvedValue({ nodes: {} }) },
    }
    const result = await checkDiskWatermark(mockClient as unknown as EsClientLike)
    expect(result.freeGb).toBe(0)
    expect(result.warn).toBe(true)
  })
})

// initEsClient 涉及真实 Client 构造 + 网络（v9 客户端有连接/重试机制，mock 不稳定），
// 核心建表逻辑由 ensureRagIndex 覆盖；"ES 不可用不阻断" 走集成测试验证（需真实 ES 环境）。
describe.skip('initEsClient 集成（需 ES 运行）', () => {
  it('ES 未启动时 initEsClient 不抛错，getEsClient 抛错', async () => {
    await expect(initEsClient()).resolves.toBeUndefined()
    expect(() => getEsClient()).toThrow(/not initialized/)
  })
})
