/**
 * 硅基流动 embedding + rerank 客户端。
 * embedding/rerank 共用一个 key，共享 L0 限流（RPM=2000/TPM=500000）。
 * 配置动态读 env（便于测试覆盖）；批量向量化分批 + 信号量并发，防 429。
 */

const EMBED_DIMS = 1024 // bge-m3 固定 1024 维，ES mapping dims 必须对齐
const MAX_RETRIES = 3

function getConfig() {
  return {
    baseUrl: process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1',
    apiKey: process.env.EMBEDDING_AND_RERANK_API_KEY || '',
    embedModel: process.env.EMBED_MODEL || 'BAAI/bge-m3',
    rerankModel: process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3',
    maxTokens: Number(process.env.EMBED_MAX_TOKENS || 8000),
    batchSize: Number(process.env.EMBED_BATCH_SIZE || 16),
    concurrency: Number(process.env.EMBED_CONCURRENCY || 3),
    retryInitialDelay: Number(process.env.EMBED_RETRY_DELAY || 1000),
  }
}

/** 粗估 token（中文偏保守，字符数/1.5）。P2 换 tiktoken 精确计数。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>
}

interface RerankResponse {
  results: Array<{ index: number; relevance_score: number }>
}

export interface RerankHit {
  index: number
  score: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 单批 embedding 请求，含 429/网络错误指数退避重试。 */
async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const cfg = getConfig()
  const url = `${cfg.baseUrl}/embeddings`
  const body = {
    model: cfg.embedModel,
    input: texts,
    encoding_format: 'float',
  }
  let delay = cfg.retryInitialDelay
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      // 网络错误：未达上限则退避重试
      if (attempt === MAX_RETRIES) throw err
      await sleep(delay)
      delay *= 2
      continue
    }
    if (res.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error(`embedding 429 after ${MAX_RETRIES} retries`)
      await sleep(delay)
      delay *= 2
      continue
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`embedding API error ${res.status}: ${errText.slice(0, 200)}`)
    }
    const data = (await res.json()) as EmbeddingResponse
    return data.data.map(d => new Float32Array(d.embedding))
  }
  throw new Error('embedding batch unreachable')
}

/**
 * 批量嵌入：长度校验 + 分批 + 并发控制。返回 Float32Array[]（每条 1024 维）。
 * 单条超 EMBED_MAX_TOKENS 拒绝调用（避免接口报错）；429 指数退避重试。
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const cfg = getConfig()
  // 长度校验
  for (const text of texts) {
    if (estimateTokens(text) > cfg.maxTokens) {
      throw new Error(
        `chunk 超过 ${cfg.maxTokens} token 上限（前 100 字）：${text.slice(0, 100)}`,
      )
    }
  }
  // 分批
  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += cfg.batchSize) {
    batches.push(texts.slice(i, i + cfg.batchSize))
  }
  // 信号量并发控制
  const results: Float32Array[][] = new Array(batches.length)
  let cursor = 0
  const workerCount = Math.min(cfg.concurrency, batches.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= batches.length) break
      results[idx] = await embedBatch(batches[idx])
    }
  })
  await Promise.all(workers)
  return results.flat()
}

/** 单条嵌入（query 用）。 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const result = await embedTexts([text])
  return result[0]
}

/**
 * rerank：对 documents 按 query 相关性重排，返回 top_n 的 {index, score}。
 * 失败降级返回原序前 topN（不抛错，不阻塞检索）。
 */
export async function rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]> {
  const cfg = getConfig()
  const fallback: RerankHit[] = documents.slice(0, topN).map((_, i) => ({ index: i, score: 0 }))
  try {
    const url = `${cfg.baseUrl}/rerank`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.rerankModel,
        query,
        documents,
        top_n: topN,
        return_documents: false,
      }),
    })
    if (!res.ok) {
      console.warn(`[RAG] rerank API ${res.status}, fallback to original order`)
      return fallback
    }
    const data = (await res.json()) as RerankResponse
    if (!Array.isArray(data.results)) return fallback
    return data.results
      .map(r => ({ index: r.index, score: r.relevance_score }))
      .sort((a, b) => b.score - a.score)
  } catch (err) {
    console.warn(
      '[RAG] rerank failed, fallback to original order:',
      err instanceof Error ? err.message : String(err),
    )
    return fallback
  }
}

/** 预热 embedding 连接（启动时调一次，避免首查冷启动）。失败只 warn，不阻断。 */
export async function warmupEmbedding(): Promise<void> {
  const cfg = getConfig()
  if (!cfg.apiKey) {
    console.warn('[RAG] EMBEDDING_AND_RERANK_API_KEY 未配置，跳过 embedding 预热')
    return
  }
  try {
    await embedQuery('预热')
    console.log('[RAG] embedding warmup ok')
  } catch (err) {
    console.warn(
      '[RAG] embedding warmup failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}
