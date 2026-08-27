import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../server/src/tools/search', () => ({
  searchTool: vi.fn(),
}))
vi.mock('../../../server/src/services/logger', () => ({
  logToolCall: vi.fn(),
}))

import { parallelSearchTool, softTruncate } from '../../../server/src/tools/parallel-search'
import { searchTool } from '../../../server/src/tools/search'
import { createSearchState, MAX_SEARCH_CALLS, type SearchState } from '../../../server/src/services/langchain-adapter'

function invoke(queries: string[], searchState?: SearchState) {
  return parallelSearchTool.invoke(
    { queries },
    { configurable: { userId: 'u1', ...(searchState ? { searchState } : {}) } },
  )
}

describe('parallel_search 工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('多查询全部执行,输出按【查询N】分段', async () => {
    vi.mocked(searchTool).mockImplementation(async q => `结果:${q}`)
    const out = await invoke(['天气', '机票'])
    expect(searchTool).toHaveBeenCalledTimes(2)
    expect(out).toContain('【查询1: 天气】')
    expect(out).toContain('【查询2: 机票】')
    expect(out).toContain('结果:天气')
    expect(out).toContain('结果:机票')
  })

  it('单个子查询失败不毁整批,失败项带错误标记', async () => {
    vi.mocked(searchTool).mockImplementation(async q => {
      if (q === '失败词') throw new Error('HTTP 429')
      return `结果:${q}`
    })
    const out = await invoke(['a', '失败词', 'c'])
    expect(out).toContain('结果:a')
    expect(out).toContain('[搜索失败: 失败词] 错误: HTTP 429')
    expect(out).toContain('结果:c')
  })

  it('剩余额度不足时截断 queries,只执行剩余数并返回提示', async () => {
    vi.mocked(searchTool).mockResolvedValue('结果')
    const state = createSearchState()
    state.searchCallCount = MAX_SEARCH_CALLS - 2 // 剩 2 次
    const out = await invoke(['a', 'b', 'c', 'd'], state)
    expect(searchTool).toHaveBeenCalledTimes(2)
    expect(out).toContain('仅执行前 2/4 个查询')
  })

  it('额度耗尽时不执行任何搜索,直接返回上限提示', async () => {
    vi.mocked(searchTool).mockResolvedValue('结果')
    const state = createSearchState()
    state.searchCallCount = MAX_SEARCH_CALLS
    const out = await invoke(['a', 'b'], state)
    expect(searchTool).not.toHaveBeenCalled()
    expect(out).toContain('搜索次数已达上限')
  })

  it('queries.length=1 合法执行', async () => {
    vi.mocked(searchTool).mockResolvedValue('结果')
    const out = await invoke(['唯一查询'])
    expect(searchTool).toHaveBeenCalledTimes(1)
    expect(out).toContain('【查询1: 唯一查询】')
  })

  it('无 searchState(直接调用)时不限额,全部执行', async () => {
    vi.mocked(searchTool).mockResolvedValue('结果')
    const out = await invoke(['a', 'b', 'c'])
    expect(searchTool).toHaveBeenCalledTimes(3)
    expect(out).toContain('【查询3: c】')
  })
})

describe('softTruncate', () => {
  it('短文本原样返回', () => {
    expect(softTruncate('abc', 100)).toBe('abc')
  })

  it('超长文本按换行边界截断,不切在行中间', () => {
    const text = 'A'.repeat(50) + '\n' + 'B'.repeat(500)
    const out = softTruncate(text, 100)
    expect(out.endsWith('(内容过长已截断)')).toBe(true)
    expect(out).not.toContain('B')
  })

  it('前半段无换行边界时退回首 limit 字符硬截断', () => {
    const text = 'A'.repeat(1000)
    const out = softTruncate(text, 100)
    expect(out).toBe('A'.repeat(100) + '\n(内容过长已截断)')
  })
})
