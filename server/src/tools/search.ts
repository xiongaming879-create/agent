import * as cheerio from 'cheerio'

const MAX_CONTENT_LENGTH = 4000
const FETCH_TIMEOUT = 15000

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

/**
 * Convert a search query to a search engine URL.
 * Bing (cn.bing.com) is reachable in China; DuckDuckGo is blocked/unstable.
 */
function queryToSearchUrl(query: string): string {
  return `https://cn.bing.com/search?q=${encodeURIComponent(query.trim())}`
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

export async function searchTool(input: string): Promise<string> {
  // Auto-detect: if input is a search query, convert to Bing search URL
  const url = isSearchQuery(input) ? queryToSearchUrl(input) : input
  const html = await fetchHtml(url)
  return extractText(html)
}
