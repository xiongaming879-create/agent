/**
 * RAG 混合检索:前置 filter + BM25/kNN 加权融合 + rerank。
 * user_id 必带 filter;ES 不可用抛错让工具层 catch 降级。
 */
import { getEsClient } from './es-client'
import { embedQuery, rerank } from './embedding-client'

const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'
const DEFAULT_TOP_K = 20
const DEFAULT_TOP_N = 5
const DEFAULT_BM25_WEIGHT = 0.35
const DEFAULT_VECTOR_WEIGHT = 0.65

export interface RagHit {
  content: string
  sourceType: string
  sourceId: string
  fileName?: string
  pageNumber?: number
  score: number
}

export interface SearchOptions {
  topK?: number
  topN?: number
  sourceType?: string
  docType?: string
  docId?: string
  tags?: string[]
  bm25Weight?: number
  vectorWeight?: number
  scoreThreshold?: number
}

interface EsSearchHit {
  _source: Record<string, unknown>
  _score: number
}

interface EsSearchResponse {
  hits: { hits: EsSearchHit[]; total?: { value: number } }
}

/** 混合检索:BM25 + kNN 加权融合 -> rerank -> top3-5 */
export async function hybridSearch(
  query: string,
  userId: string,
  options?: SearchOptions,
): Promise<RagHit[]> {
  const client = getEsClient()
  const topK = options?.topK ?? DEFAULT_TOP_K
  const topN = options?.topN ?? DEFAULT_TOP_N
  const bm25Weight = options?.bm25Weight ?? DEFAULT_BM25_WEIGHT
  const vectorWeight = options?.vectorWeight ?? DEFAULT_VECTOR_WEIGHT
  const scoreThreshold = options?.scoreThreshold ?? Number(process.env.RAG_SCORE_THRESHOLD || 0)

  // 1. embed query
  const queryVector = await embedQuery(query)

  // 2. 构建 filter(user_id 必带)
  const filter: Record<string, unknown>[] = [{ term: { user_id: userId } }]
  if (options?.sourceType) filter.push({ term: { source_type: options.sourceType } })
  if (options?.docType) filter.push({ term: { doc_type: options.docType } })
  if (options?.docId) filter.push({ term: { doc_id: options.docId } })
  if (options?.tags?.length) filter.push({ terms: { tags: options.tags } })

  // 3. ES 混合检索(BM25 match + kNN 并列,ES 自动组合得分)
  const resp = (await client.search({
    index: RAG_INDEX,
    size: topK,
    _source: ['content', 'source_type', 'source_id', 'file_name', 'page_number'],
    query: {
      bool: {
        must: [{ match: { content: { query, boost: bm25Weight } } }],
        filter,
      },
    },
    knn: {
      field: 'content_vector',
      query_vector: Array.from(queryVector),
      k: topK,
      num_candidates: 100,
      boost: vectorWeight,
      filter,
    },
  })) as unknown as EsSearchResponse

  const hits = resp.hits.hits
  if (hits.length === 0) return []

  // 4. rerank(失败降级原序前 topN,P1 已实现)
  const documents = hits.map(h => String(h._source.content))
  const rerankHits = await rerank(query, documents, topN)

  // 5. 拼装结果(过滤低于 scoreThreshold 的 hit)
  return rerankHits
    .filter(rh => rh.score >= scoreThreshold)
    .map(rh => {
      const hit = hits[rh.index]
      return {
        content: String(hit._source.content),
        sourceType: String(hit._source.source_type ?? ''),
        sourceId: String(hit._source.source_id ?? ''),
        fileName: hit._source.file_name as string | undefined,
        pageNumber: hit._source.page_number as number | undefined,
        score: rh.score,
      }
    })
}
