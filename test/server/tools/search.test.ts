import { describe, it, expect, vi } from 'vitest'
import { extractText } from '../../../server/src/tools/search'

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
