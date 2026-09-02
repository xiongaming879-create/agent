export interface SearchResultCard {
  title: string
  link: string
  content: string
}

export interface KnowledgeCard {
  source: string
  page: string | null
  content: string
}

export interface ParallelSection {
  query: string
  cards: SearchResultCard[] | null
  raw: string
}

export interface KVRow {
  key: string
  value: string
}

/**
 * 解析 search 工具输出(formatZhipuResults 格式):
 * `[N] title\nlink\ncontent` 段落,空行分隔。
 * URL 抓取输出(纯文本)解析失败返回 null。
 */
export function parseSearchResults(output: string): SearchResultCard[] | null {
  const blocks = output.split(/\n\n(?=\[\d+\] )/)
  if (!/^\[\d+\] /.test(blocks[0].trim())) return null
  const cards: SearchResultCard[] = []
  for (const block of blocks) {
    const m = block.match(/^\[\d+\] ([^\n]*)\n([^\n]*)\n?([\s\S]*)$/)
    if (!m || !/^https?:\/\//i.test(m[2].trim())) return null
    cards.push({ title: m[1].trim(), link: m[2].trim(), content: m[3].trim() })
  }
  return cards.length ? cards : null
}

/**
 * 解析 knowledge_search 输出:
 * `[N] (来源:文档名 pN) 内容` 段落。
 */
export function parseKnowledgeResults(output: string): KnowledgeCard[] | null {
  const blocks = output.split(/\n\n(?=\[\d+\] )/)
  if (!/^\[\d+\] \(来源:/.test(blocks[0].trim())) return null
  const cards: KnowledgeCard[] = []
  for (const block of blocks) {
    const m = block.match(/^\[\d+\] \(来源:(.+?)(?: (p\d+))?\) ?([\s\S]*)$/)
    if (!m) return null
    cards.push({ source: m[1].trim(), page: m[2] ?? null, content: m[3].trim() })
  }
  return cards.length ? cards : null
}

/**
 * 解析 parallel_search 输出:
 * `【查询N: q】\n内容` 分段,段内容再尝试解析为搜索卡片。
 */
export function parseParallelSections(output: string): ParallelSection[] | null {
  const re = /【查询\d+[:：]\s*([^】]*)】\n?/g
  const marks = [...output.matchAll(re)]
  if (marks.length === 0) return null
  const sections: ParallelSection[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = (marks[i].index ?? 0) + marks[i][0].length
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? output.length) : output.length
    const content = output.slice(start, end).trim()
    sections.push({ query: marks[i][1].trim(), cards: parseSearchResults(content), raw: content })
  }
  return sections
}

/** 顶层扁平 JSON 对象转键值行(数组/嵌套对象 JSON.stringify 展示) */
export function parseJsonKV(text: string): KVRow[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rows = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: typeof value === 'string'
        ? (value.length > 300 ? value.slice(0, 300) + '…' : value)
        : JSON.stringify(value),
    }))
    return rows.length ? rows : null
  } catch {
    return null
  }
}

export function parseInputJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch { /* plain string input */ }
  return null
}

export function hostOf(link: string): string {
  try {
    return new URL(link).hostname
  } catch {
    return link
  }
}
