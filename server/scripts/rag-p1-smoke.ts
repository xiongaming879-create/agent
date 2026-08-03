/**
 * RAG P1 冒烟脚本：验证 initEsClient 连通 + rag_index 自动建表 + mapping 字段。
 * 用法：cd server && npx tsx scripts/rag-p1-smoke.ts
 * 前置：ES 已运行（docker compose up -d --build）。
 */
import { initEsClient, getEsClient } from '../src/services/es-client'

console.log('[smoke] initializing ES client...')
await initEsClient()

try {
  const client = getEsClient()
  const exists = await client.indices.exists({ index: 'rag_index' })
  console.log('[smoke] rag_index exists:', exists)
  if (exists) {
    const mapping = await client.indices.getMapping({ index: 'rag_index' })
    console.log('[smoke] rag_index mapping:')
    console.log(JSON.stringify(mapping, null, 2))
  }
  // IK 中文分词验证（脚本内中文为 UTF-8，避免 bash 命令行编码问题）
  const analyzeResp = await client.indices.analyze({ analyzer: 'ik_max_word', text: '违约金条款' })
  const tokens = (analyzeResp as { body?: { tokens?: { token: string }[] } }).body?.tokens
    ?? (analyzeResp as { tokens?: { token: string }[] }).tokens ?? []
  console.log('[smoke] IK analyze "违约金条款":', tokens.map((t: { token: string }) => t.token))
} catch (err) {
  console.error('[smoke] error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
}

console.log('[smoke] done')
process.exit(0)
