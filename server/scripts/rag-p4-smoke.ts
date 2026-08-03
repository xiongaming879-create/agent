/**
 * P4 集成验收:文本提取 -> 索引 -> 检索 -> score 阈值 -> 文档列表 -> 删除。
 * 需 ES 运行 + EMBEDDING_AND_RERANK_API_KEY 配置。
 */
import { initEsClient, getEsClient } from '../src/services/es-client'
import { extractText } from '../src/services/document-extractor'
import { indexDocument } from '../src/services/rag-indexer'
import { hybridSearch } from '../src/services/rag-search'

const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'

type SearchResp = { hits: { hits: Array<{ _source: Record<string, unknown> }> } }
type AggResp = { aggregations?: { docs?: { buckets: Array<{ key: string; file_name?: { buckets: Array<{ key: string }> }; chunk_count?: { value: number } }> } } }

async function main() {
  console.log('=== P4 Smoke Test ===\n')
  await initEsClient()
  const client = getEsClient()

  // 1. 文本提取(MD)
  const mdContent = '## 租房合同\n\n第二条 违约金条款\n乙方逾期支付租金的，应按月租金的千分之五支付违约金。'
  const text = await extractText(Buffer.from(mdContent, 'utf-8'), 'contract.md')
  console.log('[1] extractText MD ✅:', text.slice(0, 30) + '...')

  // 2. 上传文档(indexDocument)
  const docId = `p4-smoke:contract.md:${Date.now()}`
  const result = await indexDocument({
    text: mdContent.repeat(3),
    userId: 'p4-smoke-user',
    sourceType: 'doc_chunk',
    sourceId: docId,
    meta: { docId, fileName: 'contract.md', docType: 'markdown', tags: ['legal'] },
  })
  console.log('[2] indexDocument:', result)
  await client.indices.refresh({ index: RAG_INDEX })

  // 3. 检索
  const hits = await hybridSearch('违约金', 'p4-smoke-user', { docType: 'markdown', topN: 5 })
  console.log(`\n[3] hybridSearch 返回 ${hits.length} 条:`)
  for (const hit of hits) {
    console.log(`  score=${hit.score.toFixed(4)} | file=${hit.fileName} | content=${hit.content.slice(0, 40).replace(/\n/g, ' ')}...`)
  }
  if (hits.length === 0) {
    console.error('  ❌ 无检索结果')
    process.exit(1)
  }

  // 4. score 阈值过滤
  const filteredHits = await hybridSearch('违约金', 'p4-smoke-user', { scoreThreshold: 0.5, topN: 5 })
  console.log(`[4] scoreThreshold=0.5 过滤后: ${filteredHits.length} 条`)

  // 5. 文档列表(ES aggregation)
  const listResp = (await client.search({
    index: RAG_INDEX,
    size: 0,
    query: { bool: { filter: [{ term: { user_id: 'p4-smoke-user' } }, { term: { source_type: 'doc_chunk' } }] } },
    aggs: {
      docs: {
        terms: { field: 'doc_id', size: 100 },
        aggs: {
          file_name: { terms: { field: 'file_name', size: 1 } },
          chunk_count: { value_count: { field: 'chunk_hash' } },
        },
      },
    },
  })) as unknown as AggResp
  const buckets = listResp.aggregations?.docs?.buckets ?? []
  console.log(`\n[5] 文档列表: ${buckets.length} 个文档`)
  for (const b of buckets) {
    console.log(`  docId=${b.key.slice(0, 30)} | file=${b.file_name?.buckets[0]?.key} | chunks=${b.chunk_count?.value}`)
  }

  // 6. 删除文档
  await client.deleteByQuery({
    index: RAG_INDEX,
    query: { bool: { filter: [{ term: { doc_id: docId } }, { term: { user_id: 'p4-smoke-user' } }] } },
  })
  await client.indices.refresh({ index: RAG_INDEX })
  const afterDelete = (await client.search({
    index: RAG_INDEX,
    query: { term: { doc_id: docId } },
  })) as unknown as SearchResp
  const remaining = afterDelete.hits.hits.length
  console.log(`\n[6] 删除后残留: ${remaining} 条(应为 0)`)
  if (remaining > 0) {
    console.error('  ❌ 删除失败!')
    process.exit(1)
  }
  console.log('  ✅ 删除成功')

  // 清理
  await client.deleteByQuery({
    index: RAG_INDEX,
    query: { term: { user_id: 'p4-smoke-user' } },
  })
  console.log('\n[7] 清理完成')
  console.log('\n✅ P4 smoke 验证通过')
}

main().catch(err => {
  console.error('\n❌ P4 smoke failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
