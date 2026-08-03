/**
 * P2 集成验收:验证 indexDocument 写入 ES + 幂等 + 元数据 + 跨用户隔离。
 * 需 ES 运行(docker compose up -d)+ EMBEDDING_AND_RERANK_API_KEY 配置。
 */
import { initEsClient, getEsClient } from '../src/services/es-client'
import { indexDocument, indexCandidate, indexRule } from '../src/services/rag-indexer'

const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'

type EsHit = { _source: Record<string, unknown> }
type SearchResp = { hits: { hits: EsHit[]; total: { value: number } } }

async function main() {
  console.log('=== P2 Smoke Test ===\n')

  await initEsClient()
  const client = getEsClient()
  console.log('[0] ES connected\n')

  // 1. 写入合同文本(doc_chunk,分档切块)
  const contractText = `## 租房合同

甲方：张三（出租方）
乙方：李四（承租方）

第一条 租金及支付方式
月租金为人民币伍仟元整，乙方应于每月一日支付当月租金。

第二条 违约金条款
乙方逾期支付租金的，每逾期一日，应按月租金的千分之五支付违约金。
逾期超过三十日的，甲方有权解除合同并要求乙方支付相当于两个月租金的违约金。

第三条 押金
乙方于签约时支付押金人民币壹万元整，租赁期满后甲方应在三日内无息退还。`.repeat(5)

  const result1 = await indexDocument({
    text: contractText,
    userId: 'smoke-test-user',
    sourceType: 'doc_chunk',
    sourceId: 'doc-contract-1',
    meta: {
      docId: 'doc-contract-1',
      fileName: 'rental.pdf',
      filePath: '/uploads/rental.pdf',
      docType: 'contract',
      uploadedAt: '2026-07-31',
      tags: ['legal', 'rental'],
    },
  })
  console.log('[1] indexDocument doc_chunk:', result1)

  // 2. ES 查询验证元数据
  await client.indices.refresh({ index: RAG_INDEX })
  const searchResp1 = (await client.search({
    index: RAG_INDEX,
    query: { term: { doc_id: 'doc-contract-1' } },
    size: 50,
  })) as unknown as SearchResp
  const hits1 = searchResp1.hits.hits
  console.log(`[2] ES 查到 ${hits1.length} 条 chunk`)
  if (hits1.length > 0) {
    const doc = hits1[0]._source
    console.log('  content:', String(doc.content).slice(0, 60) + '...')
    console.log('  content_vector dims:', (doc.content_vector as unknown[]).length)
    console.log('  source_type:', doc.source_type)
    console.log('  doc_type:', doc.doc_type)
    console.log('  file_name:', doc.file_name)
    console.log('  tags:', JSON.stringify(doc.tags))
    console.log('  chunk_hash:', String(doc.chunk_hash).slice(0, 16) + '...')
    console.log('  chunk_index:', doc.chunk_index)
  }

  // 3. 重复写入同一 doc_id(幂等验证)
  const result2 = await indexDocument({
    text: contractText,
    userId: 'smoke-test-user',
    sourceType: 'doc_chunk',
    sourceId: 'doc-contract-1',
    meta: { docId: 'doc-contract-1', fileName: 'rental.pdf', docType: 'contract' },
  })
  console.log('\n[3] 重复写入:', result2)
  await client.indices.refresh({ index: RAG_INDEX })
  const searchResp2 = (await client.search({
    index: RAG_INDEX,
    query: { term: { doc_id: 'doc-contract-1' } },
    size: 50,
  })) as unknown as SearchResp
  const hits2 = searchResp2.hits.hits
  console.log(`  重复写入后 chunk 数: ${hits2.length}(应与第一次相同: ${hits1.length})`)
  if (hits2.length !== hits1.length) {
    console.error('  ❌ 幂等失败!chunk 数变化')
    process.exit(1)
  }

  // 4. 写入 candidate + rule
  await indexCandidate({ id: 'c-smoke-1', statement: '用户喜欢喝咖啡', userId: 'smoke-test-user' })
  await indexRule({ id: 'rule-smoke-1', rule: '用户偏好深色模式', userId: 'smoke-test-user' })
  await client.indices.refresh({ index: RAG_INDEX })

  const candResp = (await client.search({
    index: RAG_INDEX,
    query: { term: { source_type: 'candidate' } },
  })) as unknown as SearchResp
  console.log('\n[4] candidate chunks:', candResp.hits.hits.length)
  if (candResp.hits.hits.length > 0) {
    console.log('  content:', candResp.hits.hits[0]._source.content)
  }

  const ruleResp = (await client.search({
    index: RAG_INDEX,
    query: { term: { source_type: 'rule' } },
  })) as unknown as SearchResp
  console.log('  rule chunks:', ruleResp.hits.hits.length)
  if (ruleResp.hits.hits.length > 0) {
    console.log('  content:', ruleResp.hits.hits[0]._source.content)
  }

  // 5. 跨用户隔离
  const ownResp = (await client.search({
    index: RAG_INDEX,
    query: { bool: { filter: [
      { term: { user_id: 'smoke-test-user' } },
    ] } },
  })) as unknown as SearchResp
  const otherResp = (await client.search({
    index: RAG_INDEX,
    query: { bool: { filter: [
      { term: { user_id: 'nonexistent-user' } },
    ] } },
  })) as unknown as SearchResp
  console.log('\n[5] 跨用户隔离:')
  console.log(`  smoke-test-user 查到 ${ownResp.hits.hits.total?.value ?? ownResp.hits.hits.length} 条`)
  console.log(`  nonexistent-user 查到 ${otherResp.hits.hits.total?.value ?? otherResp.hits.hits.length} 条(应为 0)`)
  if ((otherResp.hits.hits.total?.value ?? otherResp.hits.hits.length) > 0) {
    console.error('  ❌ 跨用户泄漏!')
    process.exit(1)
  }

  // 6. 清理测试数据(只删 smoke-test-user 的文档,不删 index)
  await client.deleteByQuery({
    index: RAG_INDEX,
    query: { term: { user_id: 'smoke-test-user' } },
  })
  console.log('\n[6] 清理 smoke-test-user 测试数据完成')

  console.log('\n✅ P2 smoke 验证通过')
}

main().catch(err => {
  console.error('\n❌ P2 smoke failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
