import { describe, it, expect } from 'vitest'
import {
  parseSearchResults, parseKnowledgeResults, parseParallelSections, parseJsonKV,
} from '../../../client/src/utils/toolRender'

describe('parseSearchResults', () => {
  it('解析智谱搜索格式为卡片', () => {
    const output = [
      '[1] 量子计算机最新进展\nhttps://tech.example.com/a\n2026年量子纠错技术取得突破',
      '[2] IBM 发布新芯片\nhttps://ibm.com/news/b\n新芯片采用低温控制',
    ].join('\n\n')
    const cards = parseSearchResults(output)
    expect(cards).toHaveLength(2)
    expect(cards![0]).toEqual({
      title: '量子计算机最新进展',
      link: 'https://tech.example.com/a',
      content: '2026年量子纠错技术取得突破',
    })
    expect(cards![1].link).toBe('https://ibm.com/news/b')
  })

  it('标题为空时卡片标题留空', () => {
    const output = '[1] \nhttps://example.com\n内容'
    const cards = parseSearchResults(output)
    expect(cards![0].title).toBe('')
  })

  it('URL 抓取纯文本返回 null', () => {
    expect(parseSearchResults('这是一段网页正文,没有编号列表结构')).toBeNull()
  })

  it('第二行非链接返回 null(不误判 knowledge 格式)', () => {
    expect(parseSearchResults('[1] (来源:文档.pdf p3) 违约金内容')).toBeNull()
  })
})

describe('parseKnowledgeResults', () => {
  it('解析来源+页码+内容', () => {
    const output = [
      '[1] (来源:劳动合同.pdf p3) 违约金不得超过实际损失的百分之三十',
      '[2] (来源:记忆) 用户偏好中文回复',
    ].join('\n\n')
    const cards = parseKnowledgeResults(output)
    expect(cards).toHaveLength(2)
    expect(cards![0]).toEqual({ source: '劳动合同.pdf', page: 'p3', content: '违约金不得超过实际损失的百分之三十' })
    expect(cards![1]).toEqual({ source: '记忆', page: null, content: '用户偏好中文回复' })
  })

  it('空结果提示返回 null', () => {
    expect(parseKnowledgeResults('知识库中未查询到相关内容。')).toBeNull()
  })
})

describe('parseParallelSections', () => {
  it('按【查询N】分段并解析段内搜索卡片', () => {
    const output = [
      '【查询1: 量子计算进展】\n[1] 标题A\nhttps://a.com\n内容A',
      '【查询2: 量子纠错】\n[2] 标题B\nhttps://b.com\n内容B',
    ].join('\n\n')
    const sections = parseParallelSections(output)
    expect(sections).toHaveLength(2)
    expect(sections![0].query).toBe('量子计算进展')
    expect(sections![0].cards![0].title).toBe('标题A')
    expect(sections![1].query).toBe('量子纠错')
  })

  it('段内容非搜索格式时保留 raw', () => {
    const output = '【查询1: q】\n普通文本结果'
    const sections = parseParallelSections(output)
    expect(sections![0].cards).toBeNull()
    expect(sections![0].raw).toBe('普通文本结果')
  })

  it('无分段标记返回 null', () => {
    expect(parseParallelSections('普通输出')).toBeNull()
  })
})

describe('parseJsonKV', () => {
  it('扁平对象转键值行', () => {
    expect(parseJsonKV('{"path":"/tmp/a.txt","size":12}')).toEqual([
      { key: 'path', value: '/tmp/a.txt' },
      { key: 'size', value: '12' },
    ])
  })

  it('数组/嵌套值 JSON.stringify 展示', () => {
    const rows = parseJsonKV('{"tags":["a","b"]}')
    expect(rows![0].value).toBe('["a","b"]')
  })

  it('非 JSON 返回 null', () => {
    expect(parseJsonKV('plain text')).toBeNull()
  })
})
