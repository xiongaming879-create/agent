import * as cheerio from 'cheerio'

const MAX_CONTENT_LENGTH = 4000
const FETCH_TIMEOUT = 15000
const SEARCH_TIMEOUT = 15000

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || ''
const ZHIPU_BASE_URL = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn'
const ZHIPU_SEARCH_ENGINE = process.env.ZHIPU_SEARCH_ENGINE || 'search_std'

/** 智谱搜索引擎回退优先级：std -> pro -> quark -> sogou */
const ZHIPU_ENGINE_DEFAULT_ORDER = ['search_std', 'search_pro', 'search-pro-quark', 'search-pro-sogou']

/**
 * 构建引擎回退链：配置的引擎优先，耗尽/报错后按默认优先级轮换到下一个，
 * 兜底回到链首（如 sogou 之后回 search_std）。
 */
export function buildEngineChain(configured: string): string[] {
  const idx = ZHIPU_ENGINE_DEFAULT_ORDER.indexOf(configured)
  if (idx === -1) return [configured, ...ZHIPU_ENGINE_DEFAULT_ORDER]
  return [...ZHIPU_ENGINE_DEFAULT_ORDER.slice(idx), ...ZHIPU_ENGINE_DEFAULT_ORDER.slice(0, idx)]
}

/**
 * Detect if the input looks like a search query rather than a URL.
 * Returns true for non-URL strings (Chinese text, phrases without protocol/domain).
 */
function isSearchQuery(input: string): boolean {
  // If it has a valid protocol, it's a URL
  if (/^https?:\/\//i.test(input.trim())) return false
  // If it contains Chinese characters, likely a search query
  if (/[一-鿿]/.test(input)) return true
  // If it contains spaces and no dots (like a domain would), likely a query
  if (/\s/.test(input) && !/\.\w{2,}/.test(input)) return true
  // If no dot and no path, treat as query
  if (!input.includes('.') && !input.includes('/')) return true
  return false
}

export async function fetchHtml(url: string): Promise<string> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    return await res.text()
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function extractText(html: string): string {
  const $ = cheerio.load(html)
  // Remove script, style, nav, footer
  $('script, style, nav, footer, header, noscript').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  return text.length > MAX_CONTENT_LENGTH ? text.slice(0, MAX_CONTENT_LENGTH) : text
}

// --- 智谱 web-search-pro ---

interface ZhipuSearchResult {
  title?: string
  link?: string
  content?: string
  media?: string
  publish_date?: string
}

/** 把智谱搜索结果格式化为 LLM 友好的编号列表 */
export function formatZhipuResults(results: ZhipuSearchResult[]): string {
  if (results.length === 0) return '搜索无结果'
  return results
    .map((r, i) => `[${i + 1}] ${r.title || ''}\n${r.link || ''}\n${r.content || ''}`)
    .join('\n\n')
    .slice(0, MAX_CONTENT_LENGTH)
}

async function searchWithEngine(engine: string, query: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT)
  try {
    const res = await fetch(`${ZHIPU_BASE_URL}/api/paas/v4/web_search`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        search_engine: engine,
        search_query: query,
        count: 10,
        content_size: 'medium',
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const data = (await res.json()) as { search_result?: ZhipuSearchResult[] }
    return formatZhipuResults(data.search_result || [])
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function searchViaZhipu(query: string): Promise<string> {
  let lastErr: unknown = null
  for (const engine of buildEngineChain(ZHIPU_SEARCH_ENGINE)) {
    try {
      return await searchWithEngine(engine, query)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('智谱搜索全部引擎失败')
}

export async function searchTool(input: string): Promise<string> {
  // 搜索词走智谱 web-search-pro API；URL 走直接抓取
  if (isSearchQuery(input)) {
    if (!ZHIPU_API_KEY) throw new Error('Tool error: ZHIPU_API_KEY 未配置，无法执行搜索')
    return searchViaZhipu(input)
  }
  const html = await fetchHtml(input)
  return extractText(html)
}
