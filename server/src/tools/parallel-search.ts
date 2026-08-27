/**
 * parallel_search 复合工具:一次提交多个独立搜索词,服务端并发执行。
 * 把"模型需在一轮发多个 tool_calls"压缩成"一次调用+数组",命中率远高于 prompt 引导。
 *
 * 计数分工:
 * - 本工具只读 searchState 计算剩余额度,超限截断 queries 只跑剩余数(不写计数)
 * - langchain-adapter 的 checkSearchEffectiveness 事后按 queries.length 累加
 *   (含被截断未执行的:尝试了就计入,偏严格,防反复试探绕过上限)
 */
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchTool } from './search'
import { MAX_SEARCH_CALLS, type SearchState } from '../services/langchain-adapter'
import { logToolCall } from '../services/logger'

const MAX_PARALLEL_QUERIES = 6
const CONCURRENCY = 4
const PER_QUERY_LIMIT = 1000

/** 按段落/换行边界软截断,避免硬切 markdown/表格;前半段找不到边界退回首 limit 字符 */
export function softTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const boundary = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'))
  const cut = boundary >= limit * 0.5 ? boundary : limit
  return text.slice(0, cut) + '\n(内容过长已截断)'
}

/** 固定并发上限的 map:并发而非串行(同时消耗 RPM),上限 4 防瞬时打爆限流 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

export const parallelSearchTool = new DynamicStructuredTool({
  name: 'parallel_search',
  description: `并行执行多个独立的网络搜索,一次调用返回全部结果,适合多子查询一次性收集(如旅游规划需同时查机票/酒店/天气/景点)。

何时调用:需要 ≥2 个互不依赖的搜索词一次性收集。
何时不调用:单一搜索词直接用 search,禁止用本工具包一层;查询间有依赖(后一个依赖前一个结果)时串行调用 search。`,
  schema: z.object({
    queries: z.array(z.string()).min(1).max(MAX_PARALLEL_QUERIES).describe('2-6 个互不依赖的搜索词'),
  }),
  func: async ({ queries }, _runManager, config) => {
    const configurable = config?.configurable as { userId?: string; searchState?: SearchState } | undefined
    const state = configurable?.searchState
    const userId = configurable?.userId

    let effective = queries.map(q => q.trim()).filter(Boolean).slice(0, MAX_PARALLEL_QUERIES)
    if (effective.length === 0) return '未提供有效搜索词'

    // 剩余额度保护:不足时不全部执行完才停,截断只跑剩余数
    let truncatedNote = ''
    if (state) {
      const remaining = MAX_SEARCH_CALLS - state.searchCallCount
      if (remaining <= 0) {
        return `搜索次数已达上限(${MAX_SEARCH_CALLS}),请基于已有信息综合回答,不要再发起搜索`
      }
      if (effective.length > remaining) {
        truncatedNote = `\n\n[已达搜索次数上限,仅执行前 ${remaining}/${effective.length} 个查询,其余未执行]`
        effective = effective.slice(0, remaining)
      }
    }

    // 逐项容错:单个子查询失败不毁掉整批结果,失败项以错误标记占位
    const results = await mapWithConcurrency(effective, async (q, i) => {
      const startedAt = Date.now()
      const inputPreview = `#${i + 1} ${q}`.slice(0, 100)
      try {
        const result = await searchTool(q)
        logToolCall({ userId, step: i + 1, toolName: 'parallel_search', inputPreview, outputLength: result.length, durationMs: Date.now() - startedAt, success: true })
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logToolCall({ userId, step: i + 1, toolName: 'parallel_search', inputPreview, outputLength: 0, durationMs: Date.now() - startedAt, success: false })
        return `[搜索失败: ${q}] 错误: ${msg}`
      }
    }, CONCURRENCY)

    return effective
      .map((q, i) => `【查询${i + 1}: ${q}】\n${softTruncate(results[i], PER_QUERY_LIMIT)}`)
      .join('\n\n') + truncatedNote
  },
})
