import { describe, it, expect, vi } from 'vitest'
import { extractText, formatZhipuResults, buildEngineChain, searchViaZhipu } from '../../../server/src/tools/search'

describe('search 工具 — 网页抓取', () => {
  it('给定有效 HTML，extractText 返回纯文本内容', () => {
    const html = '<html><body><h1>标题</h1><p>正文内容</p></body></html>'
    const text = extractText(html)
    expect(text).toContain('标题')
    expect(text).toContain('正文内容')
    expect(text).not.toContain('<h1>')
    expect(text).not.toContain('<p>')
  })

  it('返回内容截断至 4000 字符', () => {
    const longHtml = '<p>' + 'A'.repeat(10000) + '</p>'
    const text = extractText(longHtml)
    expect(text.length).toBeLessThanOrEqual(4000)
  })

  it('应移除 script/style/nav 等标签内容', () => {
    const html = '<html><body><script>alert("x")</script><nav>导航</nav><p>正文</p></body></html>'
    const text = extractText(html)
    expect(text).toContain('正文')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('导航')
  })
})

describe('search 工具 — fetchHtml', () => {
  // fetchHtml 需要网络，仅测试错误处理逻辑
  it('无效 URL 应抛出错误', async () => {
    const { fetchHtml } = await import('../../../server/src/tools/search')
    await expect(fetchHtml('not-a-url')).rejects.toThrow(/invalid url/i)
  })
})

describe('search 工具 - 智谱搜索结果格式化', () => {
  it('格式化为编号列表，含标题/链接/摘要', () => {
    const text = formatZhipuResults([
      { title: '石宇奇vs阿尤什', link: 'https://example.com/1', content: '比赛结果摘要' },
      { title: '羽联排名', link: 'https://example.com/2', content: '排名信息' },
    ])
    expect(text).toContain('[1] 石宇奇vs阿尤什')
    expect(text).toContain('https://example.com/1')
    expect(text).toContain('比赛结果摘要')
    expect(text).toContain('[2] 羽联排名')
  })

  it('空结果返回明确提示', () => {
    expect(formatZhipuResults([])).toBe('搜索无结果')
  })

  it('结果超长时截断至 4000 字符', () => {
    const text = formatZhipuResults([
      { title: '长文', link: 'https://example.com', content: 'A'.repeat(10000) },
    ])
    expect(text.length).toBeLessThanOrEqual(4000)
  })
})

describe('search 工具 - 智谱搜索引擎回退链', () => {
  it('默认引擎链 search_std -> search_pro -> quark -> sogou', () => {
    expect(buildEngineChain('search_std')).toEqual([
      'search_std', 'search_pro', 'search-pro-quark', 'search-pro-sogou',
    ])
  })

  it('配置 search_pro 时从该引擎开始，其余按默认顺序随后', () => {
    expect(buildEngineChain('search_pro')).toEqual([
      'search_pro', 'search-pro-quark', 'search-pro-sogou', 'search_std',
    ])
  })

  it('配置 search-pro-sogou 时最后兜底回 search_std', () => {
    expect(buildEngineChain('search-pro-sogou')).toEqual([
      'search-pro-sogou', 'search_std', 'search_pro', 'search-pro-quark',
    ])
  })

  it('未知引擎名时配置引擎在最前，默认链随后', () => {
    expect(buildEngineChain('my-engine')).toEqual([
      'my-engine', 'search_std', 'search_pro', 'search-pro-quark', 'search-pro-sogou',
    ])
  })
})

describe('search 工具 - 引擎失败自动回退', () => {
  it('search_std 失败后自动回退到 search_pro', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429: 额度不足'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ search_result: [{ title: '回退成功', content: 'ok' }] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const out = await searchViaZhipu('测试查询')
      expect(out).toContain('[1] 回退成功')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
      expect(bodies[0].search_engine).toBe('search_std')
      expect(bodies[1].search_engine).toBe('search_pro')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('所有引擎都失败时抛出最后一个错误', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(searchViaZhipu('测试查询')).rejects.toThrow('HTTP 500')
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
