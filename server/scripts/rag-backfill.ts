/**
 * 历史对话全量回填:遍历所有 conversation,逐个索引消息到 ES rag_index。
 * 手动运行:npx tsx scripts/rag-backfill.ts
 * 需 ES 运行 + EMBEDDING_AND_RERANK_API_KEY 配置。
 */
import { initDb, getConversations } from '../src/db'
import { initMemoryDb } from '../src/db/memory-db'
import { initEsClient } from '../src/services/es-client'
import { indexConversationMessages } from '../src/services/rag-indexer'

async function main() {
  console.log('=== RAG Backfill ===\n')
  await initDb()
  await initMemoryDb()
  await initEsClient()

  const conversations = getConversations()
  console.log(`[Backfill] 共 ${conversations.length} 个对话\n`)

  let success = 0
  let failed = 0
  let skipped = 0
  for (const conv of conversations) {
    if (!conv.user_id) {
      skipped++
      continue
    }
    try {
      await indexConversationMessages(conv.id, conv.user_id)
      success++
      console.log(`✅ ${conv.id} (${conv.title?.slice(0, 20) ?? '无标题'})`)
    } catch (err) {
      failed++
      console.error(`❌ ${conv.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`\n[Backfill] 完成: ${success} 成功, ${failed} 失败, ${skipped} 跳过(无 user_id)`)
  process.exit(0)
}

main().catch(err => {
  console.error('[Backfill] failed:', err)
  process.exit(1)
})
