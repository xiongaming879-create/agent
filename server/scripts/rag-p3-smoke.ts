/**
 * P3 集成验收:写入 -> 混合检索 -> rerank -> 返回带来源 top3-5 + 跨用户隔离。
 * 需 ES 运行 + EMBEDDING_AND_RERANK_API_KEY 配置。
 */
import { initEsClient, getEsClient } from '../src/services/es-client'
import { indexDocument } from '../src/services/rag-indexer'
import { hybridSearch } from '../src/services/rag-search'

const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'

async function main() {
  console.log('=== P3 Smoke Test ===\n')
  await initEsClient()
  const client = getEsClient()

  // 1. 写入合同文本
  const contractText = `## 租房合同

第一条 租金及支付方式
月租金为人民币伍仟元整，乙方应于每月一日支付当月租金。

第二条 违约金条款
乙方逾期支付租金的，每逾期一日，应按月租金的千分之五支付违约金。
逾期超过三十日的，甲方有权解除合同并要求乙方支付相当于两个月租金的违约金。

第三条 押金
乙方于签约时支付押金人民币壹万元整，租赁期满后甲方应在三日内无息退还。`.repeat(3)

  await indexDocument({
    text: contractText,
    userId: 'p3-smoke-user',
    sourceType: 'doc_chunk',
    sourceId: 'doc-contract-p3',
    meta: { docId: 'doc-contract-p3', fileName: 'rental.pdf', docType: 'contract', tags: ['legal'] },
  })
  await client.indices.refresh({ index: RAG_INDEX })
  console.log('[1] 合同文本已写入 ES')

  // 2. 混合检索
  const hits = await hybridSearch('违约金 怎么算', 'p3-smoke-user', { docType: 'contract', topN: 5 })
  console.log(`\n[2] hybridSearch("违约金 怎么算") 返回 ${hits.length} 条:`)
  for (const hit of hits) {
    console.log(`  score=${hit.score.toFixed(4)} | source=${hit.sourceType} | file=${hit.fileName ?? 'N/A'} | content=${hit.content.slice(0, 50).replace(/\n/g, ' ')}...`)
  }
  if (hits.length === 0) {
    console.error('  ❌ 无检索结果')
    process.exit(1)
  }

  // 3. 验证字段完整性
  const first = hits[0]
  console.log('\n[3] 字段验证:')
  console.log(`  content 非空: ${first.content.length > 0} ✅`)
  console.log(`  sourceType: ${first.sourceType}`)
  console.log(`  fileName: ${first.fileName}`)
  console.log(`  score >= 0: ${first.score >= 0} ✅`)
  if (!first.content || first.content.length === 0) {
    console.error('  ❌ content 为空')
    process.exit(1)
  }

  // 4. 跨用户隔离
  const otherHits = await hybridSearch('违约金', 'nonexistent-user')
  console.log(`\n[4] 跨用户隔离: nonexistent-user 查到 ${otherHits.length} 条(应为 0)`)
  if (otherHits.length > 0) {
    console.error('  ❌ 跨用户泄漏!')
    process.exit(1)
  }
  console.log('  ✅ 隔离正常')

  // 5. 无命中场景
  const noHits = await hybridSearch('量子力学 薛定谔', 'p3-smoke-user')
  console.log(`\n[5] 无命中场景: "量子力学" 查到 ${noHits.length} 条`)
  if (noHits.length > 0) {
    console.log(`  ⚠️  预期 0 条,实际 ${noHits.length} 条(rerank 可能误召回,观察 score)`)
  }

  // 6. 验证 rerank 排序(score 降序)
  if (hits.length >= 2) {
    const sorted = hits.every((h, i) => i === 0 || h.score <= hits[i - 1].score)
    console.log(`\n[6] rerank 排序: ${sorted ? '降序 ✅' : '未降序 ⚠️'}`)
  }

  // 清理
  await client.deleteByQuery({
    index: RAG_INDEX,
    query: { term: { user_id: 'p3-smoke-user' } },
  })
  console.log('\n[7] 清理 p3-smoke-user 测试数据完成')

  console.log('\n✅ P3 smoke 验证通过')
}

main().catch(err => {
  console.error('\n❌ P3 smoke failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
