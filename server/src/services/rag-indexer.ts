/**
 * RAG 索引管道:切块 -> hash 去重 -> embed -> bulk 写入 ES。
 * doc_id 幂等(先删旧再写新);超长二次递归拆分;三路接入辅助函数。
 * ES 不可用时抛错,接入点 catch 降级(fire-and-forget)。
 */
import { createHash } from 'crypto'
import { getEsClient } from './es-client'
import { embedTexts } from './embedding-client'
import { chunkByType, splitOverflow } from './rag-chunker'
import { getMessages } from '../db'

const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'

export interface IndexChunkInput {
  text: string
  userId: string
  sourceType: 'message' | 'candidate' | 'rule' | 'doc_chunk'
  sourceId: string
  meta: {
    docId: string
    fileName?: string
    filePath?: string
    pageNumber?: number
    docType?: string
    uploadedAt?: string
    tags?: string[]
  }
}

interface IndexResult {
  indexed: number
  skipped: number
}

/** 通用写入入口:切块 -> 去重 -> embed -> 写 ES(幂等) */
export async function indexDocument(input: IndexChunkInput): Promise<IndexResult> {
  const client = getEsClient()
  const { text, userId, sourceType, sourceId, meta } = input

  // 1. doc_id 幂等:先删旧 chunk(双 filter:doc_id + user_id,绝不误删)
  await client.deleteByQuery({
    index: RAG_INDEX,
    conflicts: 'proceed',
    query: {
      bool: {
        filter: [
          { term: { doc_id: meta.docId } },
          { term: { user_id: userId } },
        ],
      },
    },
  })

  // 2. 切块:doc_chunk 按类型分档;其他 sourceType 整条单 chunk
  let chunks: string[]
  if (sourceType === 'doc_chunk') {
    chunks = chunkByType(text, meta.docType)
  } else {
    chunks = [text]
  }

  // 3. 超长兜底:单 chunk 超 8K 二次递归拆分
  chunks = chunks.flatMap(c => splitOverflow(c))
  if (chunks.length === 0) return { indexed: 0, skipped: 0 }

  // 4. hash 去重(同批次内存,不查 ES)
  const seen = new Map<string, string>()
  for (const chunk of chunks) {
    const hash = sha256(chunk)
    if (!seen.has(hash)) seen.set(hash, chunk)
  }
  const uniqueChunks = Array.from(seen.values())
  const skipped = chunks.length - uniqueChunks.length

  // 5. embed
  const vectors = await embedTexts(uniqueChunks)

  // 6. bulk 写入
  const now = new Date().toISOString()
  const operations: unknown[] = []
  uniqueChunks.forEach((chunk, i) => {
    operations.push({ index: { _id: `${userId}#${meta.docId}#${i}` } })
    operations.push({
      content: chunk,
      content_vector: Array.from(vectors[i]),
      source_type: sourceType,
      source_id: sourceId,
      user_id: userId,
      doc_id: meta.docId,
      file_name: meta.fileName ?? null,
      file_path: meta.filePath ?? null,
      page_number: meta.pageNumber ?? null,
      doc_type: meta.docType ?? null,
      uploaded_at: meta.uploadedAt ?? null,
      tags: meta.tags ?? [],
      chunk_hash: sha256(chunk),
      chunk_index: i,
      created_at: now,
    })
  })

  const bulkResp = await client.bulk({ index: RAG_INDEX, operations, refresh: false })
  if (bulkResp.errors) {
    console.warn('[RAG] bulk write had partial errors')
  }

  return { indexed: uniqueChunks.length, skipped }
}

/** 历史对话索引:取对话所有消息,每条作为单 chunk 索引 */
export async function indexConversationMessages(convId: string, userId: string): Promise<void> {
  const messages = getMessages(convId)
  for (const msg of messages) {
    if (msg.role === 'system') continue
    await indexDocument({
      text: msg.content,
      userId,
      sourceType: 'message',
      sourceId: msg.id,
      meta: {
        docId: `msg:${msg.id}`,
        docType: 'markdown',
        uploadedAt: msg.created_at,
      },
    })
  }
}

/** 记忆候选索引:statement 整条 */
export async function indexCandidate(input: {
  id: string
  statement: string
  userId: string
}): Promise<void> {
  await indexDocument({
    text: input.statement,
    userId: input.userId,
    sourceType: 'candidate',
    sourceId: input.id,
    meta: { docId: `candidate:${input.id}` },
  })
}

/** 记忆规则索引:rule 整条 */
export async function indexRule(input: {
  id: string
  rule: string
  userId: string
}): Promise<void> {
  await indexDocument({
    text: input.rule,
    userId: input.userId,
    sourceType: 'rule',
    sourceId: input.id,
    meta: { docId: `rule:${input.id}` },
  })
}

/** 按 source_id 批量删除 ES 文档（删对话时级联清理 message/candidate） */
export async function deleteEsBySourceIds(
  userId: string,
  sourceIds: string[],
  options?: { sourceType?: string }
): Promise<number> {
  if (sourceIds.length === 0) return 0
  const client = getEsClient()
  const filter: Record<string, unknown>[] = [
    { term: { user_id: userId } },
    { terms: { source_id: sourceIds } },
  ]
  if (options?.sourceType) {
    filter.push({ term: { source_type: options.sourceType } })
  }
  const resp = await client.deleteByQuery({
    index: RAG_INDEX,
    refresh: true,
    conflicts: 'proceed',
    query: { bool: { filter } },
  })
  return (resp as { deleted?: number }).deleted ?? 0
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
