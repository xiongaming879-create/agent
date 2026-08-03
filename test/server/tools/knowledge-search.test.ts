import { describe, it, expect, beforeEach, vi } from 'vitest'
import { knowledgeSearchTool } from '../../../server/src/tools/knowledge-search'
import { hybridSearch } from '../../../server/src/services/rag-search'

vi.mock('../../../server/src/services/rag-search', () => ({
  hybridSearch: vi.fn(),
}))

describe('knowledge-search tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有 userId: 调 hybridSearch,返回格式化字符串', async () => {
    vi.mocked(hybridSearch).mockResolvedValue([
      { content: '违约金月租200%', sourceType: 'doc_chunk', sourceId: 'd1', fileName: 'rental.pdf', pageNumber: 3, score: 0.95 },
    ])
    const result = await knowledgeSearchTool.invoke(
      { query: '违约金' },
      { configurable: { userId: 'u1' } },
    )
    expect(hybridSearch).toHaveBeenCalledWith('违约金', 'u1', { topN: 5, docType: undefined, tags: undefined })
    expect(result).toContain('[1]')
    expect(result).toContain('rental.pdf')
    expect(result).toContain('p3')
    expect(result).toContain('违约金月租200%')
  })

  it('无 userId: 返回错误提示,不调 hybridSearch', async () => {
    const result = await knowledgeSearchTool.invoke(
      { query: 'test' },
      { configurable: {} },
    )
    expect(result).toContain('missing userId')
    expect(hybridSearch).not.toHaveBeenCalled()
  })

  it('无 config: 返回错误提示', async () => {
    const result = await knowledgeSearchTool.invoke(
      { query: 'test' },
      { configurable: {} },
    )
    expect(result).toContain('missing userId')
  })

  it('无命中: 返回"知识库中未查询到相关内容"', async () => {
    vi.mocked(hybridSearch).mockResolvedValue([])
    const result = await knowledgeSearchTool.invoke(
      { query: '不存在' },
      { configurable: { userId: 'u1' } },
    )
    expect(result).toBe('知识库中未查询到相关内容。')
  })

  it('ES 不可用: 返回降级提示(不抛错)', async () => {
    vi.mocked(hybridSearch).mockRejectedValue(new Error('ES unavailable'))
    const result = await knowledgeSearchTool.invoke(
      { query: 'test' },
      { configurable: { userId: 'u1' } },
    )
    expect(result).toContain('知识库检索暂时不可用')
    expect(result).toContain('ES unavailable')
    expect(result).toContain('search')
  })

  it('docType/tags 透传到 hybridSearch', async () => {
    vi.mocked(hybridSearch).mockResolvedValue([])
    await knowledgeSearchTool.invoke(
      { query: '违约金', docType: 'contract', tags: ['legal'] },
      { configurable: { userId: 'u1' } },
    )
    expect(hybridSearch).toHaveBeenCalledWith('违约金', 'u1', { topN: 5, docType: 'contract', tags: ['legal'] })
  })

  it('多 hit 格式化: 每条带序号和来源', async () => {
    vi.mocked(hybridSearch).mockResolvedValue([
      { content: 'content1', sourceType: 'message', sourceId: 'm1', score: 0.9 },
      { content: 'content2', sourceType: 'rule', sourceId: 'r1', score: 0.8 },
    ])
    const result = await knowledgeSearchTool.invoke(
      { query: 'test' },
      { configurable: { userId: 'u1' } },
    )
    expect(result).toContain('[1]')
    expect(result).toContain('content1')
    expect(result).toContain('message')
    expect(result).toContain('[2]')
    expect(result).toContain('content2')
    expect(result).toContain('rule')
  })
})
