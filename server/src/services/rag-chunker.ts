/**
 * 分类型语义切块器(自实现,不依赖 @langchain/textsplitters)。
 * 按文档类型分档 chunkSize/overlap,按语义边界递归切分,超长二次拆分兜底。
 * token 计数复用 embedding-client 的 estimateTokens(字符数/1.5 估算)。
 */
import { estimateTokens } from './embedding-client'

const EMBED_MAX_TOKENS = 8000

const CHUNK_PROFILES: Record<string, { chunkSize: number; overlap: number }> = {
  markdown: { chunkSize: 650, overlap: 80 },
  article: { chunkSize: 650, overlap: 80 },
  code: { chunkSize: 400, overlap: 50 },
  table: { chunkSize: 400, overlap: 50 },
  contract: { chunkSize: 300, overlap: 40 },
}

const DEFAULT_PROFILE = { chunkSize: 650, overlap: 80 }

const SEPARATORS = ['\n## ', '\n### ', '\n\n', '\n', '。', '；', ';', ' ', '']

/** 按文档类型分档切块 */
export function chunkByType(text: string, docType?: string): string[] {
  const profile = (docType && CHUNK_PROFILES[docType]) || DEFAULT_PROFILE
  return recursiveChunk(text, profile.chunkSize, profile.overlap, SEPARATORS)
}

/**
 * 递归语义切块:按分隔符优先级切分到 <= chunkSize 的小块,再合并 + overlap。
 * separators 按优先级从高到低,前缀语义边界(## 标题 -> 段落 -> 换行 -> 句号 -> 空格 -> 硬切)。
 */
export function recursiveChunk(
  text: string,
  chunkSize: number,
  overlap: number,
  separators: string[],
): string[] {
  if (!text) return []
  const splits = splitToSplits(text, chunkSize, separators)
  if (splits.length === 0) return []
  return mergeWithOverlap(splits, chunkSize, overlap)
}

/** 单 chunk 超长兜底:递归减半 chunkSize 拆分,仍超限截断告警 */
export function splitOverflow(text: string, maxTokens: number = EMBED_MAX_TOKENS): string[] {
  if (!text) return []
  if (estimateTokens(text) <= maxTokens) return [text]
  let chunkSize = maxTokens
  let result = recursiveChunk(text, chunkSize, 0, SEPARATORS)
  while (result.some(c => estimateTokens(c) > maxTokens) && chunkSize > 100) {
    chunkSize = Math.floor(chunkSize / 2)
    result = recursiveChunk(text, chunkSize, 0, SEPARATORS)
  }
  const maxChars = Math.ceil(maxTokens * 1.5)
  return result.map(c => {
    if (estimateTokens(c) > maxTokens) {
      console.warn(`[RAG] chunk 仍超 ${maxTokens} token,截断`)
      return c.slice(0, maxChars)
    }
    return c
  })
}

function splitToSplits(text: string, chunkSize: number, separators: string[]): string[] {
  if (estimateTokens(text) <= chunkSize) return [text]
  if (separators.length === 0) return hardSplitByTokens(text, chunkSize)
  const sep = separators[0]
  const rest = separators.slice(1)
  const parts = splitBySeparator(text, sep)
  const result: string[] = []
  for (const part of parts) {
    if (estimateTokens(part) <= chunkSize) {
      result.push(part)
    } else {
      result.push(...splitToSplits(part, chunkSize, rest))
    }
  }
  return result
}

function mergeWithOverlap(splits: string[], chunkSize: number, overlap: number): string[] {
  if (splits.length === 0) return []
  const chunks: string[] = []
  let current = splits[0]
  for (let i = 1; i < splits.length; i++) {
    const candidate = current + splits[i]
    if (estimateTokens(candidate) <= chunkSize) {
      current = candidate
    } else {
      chunks.push(current)
      if (overlap > 0) {
        current = takeTailByTokens(current, overlap) + splits[i]
      } else {
        current = splits[i]
      }
    }
  }
  chunks.push(current)
  return chunks
}

function splitBySeparator(text: string, sep: string): string[] {
  if (sep === '') return [text]
  const parts = text.split(sep)
  return parts
    .map((p, i) => (i < parts.length - 1 ? p + sep : p))
    .filter(p => p.length > 0)
}

function hardSplitByTokens(text: string, chunkSize: number): string[] {
  const charSize = Math.ceil(chunkSize * 1.5)
  const result: string[] = []
  for (let i = 0; i < text.length; i += charSize) {
    result.push(text.slice(i, i + charSize))
  }
  return result
}

function takeTailByTokens(text: string, overlapTokens: number): string {
  const charSize = Math.ceil(overlapTokens * 1.5)
  return text.slice(-charSize)
}
