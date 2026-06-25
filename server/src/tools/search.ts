import * as cheerio from 'cheerio'

const MAX_CONTENT_LENGTH = 4000
const FETCH_TIMEOUT = 10000

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
    const res = await fetch(url, { signal: controller.signal })
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

export async function searchTool(url: string): Promise<string> {
  const html = await fetchHtml(url)
  return extractText(html)
}
