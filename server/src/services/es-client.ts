/**
 * ES 客户端：连接管理 + rag_index 自动建表 + 磁盘水位检查。
 * 纯逻辑（mapping 构造、建表判断、水位计算）可单测；真实连接走集成测试。
 */
import { Client } from '@elastic/elasticsearch'

const ES_URL = process.env.ES_URL || 'http://localhost:9200'
const ES_USER = process.env.ES_USER || ''
const ES_PASSWORD = process.env.ES_PASSWORD || ''
const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'
const ES_DISK_WARN_GB = Number(process.env.ES_DISK_WARN_GB || 10)

/** rag_index 的 mapping：1 分片 0 副本 + dense_vector 1024 维 cosine + IK 分词 + 字段化元数据 */
export function buildRagIndexMapping() {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        content: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart' },
        content_vector: { type: 'dense_vector', dims: 1024, index: true, similarity: 'cosine' },
        source_type: { type: 'keyword' },
        source_id: { type: 'keyword' },
        user_id: { type: 'keyword' },
        doc_id: { type: 'keyword' },
        file_name: { type: 'keyword' },
        file_path: { type: 'keyword' },
        page_number: { type: 'integer' },
        doc_type: { type: 'keyword' },
        uploaded_at: { type: 'date' },
        tags: { type: 'keyword' },
        chunk_hash: { type: 'keyword' },
        chunk_index: { type: 'integer' },
        created_at: { type: 'date' },
      },
    },
  }
}

/** ES 客户端最小结构（鸭子类型，便于测试注入 mock，避免依赖真实 Client 类型） */
export interface EsClientLike {
  info(): Promise<unknown>
  indices: {
    exists(params: { index: string }): Promise<unknown>
    create(params: { index: string; settings?: unknown; mappings?: unknown }): Promise<unknown>
  }
  cluster: {
    stats(params?: { metric?: string }): Promise<unknown>
  }
}

/** 兼容 v8（返回 {body}）/ v9（返回 boolean）的 exists 结果归一 */
function normalizeExists(resp: unknown): boolean {
  if (typeof resp === 'boolean') return resp
  if (typeof resp === 'object' && resp !== null && 'body' in resp) {
    return Boolean((resp as { body: unknown }).body)
  }
  return false
}

/** 确保 rag_index 存在，不存在则按 mapping 创建。已存在不重建（遵守"禁止删库"铁律）。 */
export async function ensureRagIndex(client: EsClientLike, indexName: string = RAG_INDEX): Promise<void> {
  const exists = await client.indices.exists({ index: indexName })
  if (normalizeExists(exists)) return
  await client.indices.create({ index: indexName, ...buildRagIndexMapping() })
}

/** 检查 ES 数据盘剩余空间，低于阈值告警（ES flood-stage 95% 水位会变只读，提前预警）。 */
export async function checkDiskWatermark(client: EsClientLike): Promise<{ freeGb: number; warn: boolean }> {
  const raw = await client.cluster.stats()
  // 兼容 v8（返回 {body}）/ v9（直接返回数据）
  const stats = (raw as { body?: { nodes?: { fs?: { free_in_bytes?: number } } } }).body
    ?? (raw as { nodes?: { fs?: { free_in_bytes?: number } } })
  const freeBytes = stats.nodes?.fs?.free_in_bytes ?? 0
  const freeGb = freeBytes / (1024 ** 3)
  return { freeGb, warn: freeGb < ES_DISK_WARN_GB }
}

let _client: Client | null = null

/**
 * 初始化 ES 客户端 + 确保 rag_index 存在。
 * 失败不抛错（RAG 是增强能力，不能让 ES 故障拖垮主服务启动）。
 */
export async function initEsClient(): Promise<void> {
  try {
    const auth = ES_USER && ES_PASSWORD ? { username: ES_USER, password: ES_PASSWORD } : undefined
    _client = new Client({ node: ES_URL, auth })
    await _client.info()
    await ensureRagIndex(_client as unknown as EsClientLike)
    console.log(`[RAG] ES connected, index "${RAG_INDEX}" ready`)
  } catch (err) {
    _client = null
    console.warn('[RAG] ES init failed, RAG degraded:', err instanceof Error ? err.message : String(err))
  }
}

/** 获取已初始化的 ES 客户端；未初始化抛错。 */
export function getEsClient(): Client {
  if (!_client) throw new Error('ES client not initialized. Call initEsClient() first.')
  return _client
}
