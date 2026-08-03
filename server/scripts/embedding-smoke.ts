/**
 * RAG P1 embedding/rerank 冒烟脚本：验证硅基流动 API 真实调用。
 * 用法：cd server && npx tsx scripts/embedding-smoke.ts
 * 前置：配置 EMBEDDING_AND_RERANK_API_KEY 环境变量。
 */
import { embedTexts, embedQuery, rerank } from '../src/services/embedding-client'

const key = process.env.EMBEDDING_AND_RERANK_API_KEY
if (!key) {
  console.error('[smoke] EMBEDDING_AND_RERANK_API_KEY 未配置，无法验证')
  process.exit(1)
}
console.log('[smoke] API key 已配置（长度 ' + key.length + '）')

// 1. embedTexts 批量（3 条，验证分批 + 返回维度）
console.log('[smoke] 调用 embedTexts...')
const vectors = await embedTexts(['违约金条款', '租房合同', '世界杯赛程'])
console.log('[smoke] embedTexts 返回', vectors.length, '条向量，每条维度', vectors[0].length)
console.log('[smoke] 向量[0] 前 5 维:', Array.from(vectors[0].slice(0, 5)))

// 2. embedQuery 单条
console.log('[smoke] 调用 embedQuery...')
const qvec = await embedQuery('违约金')
console.log('[smoke] embedQuery 维度', qvec.length)

// 3. rerank（3 文档取 top2，验证相关性排序）
console.log('[smoke] 调用 rerank...')
const hits = await rerank('违约金怎么算', ['违约金按月租200%', '世界杯赛程', '租房合同条款'], 2)
console.log('[smoke] rerank top', hits.length, '命中:')
for (const h of hits) {
  console.log('  index=' + h.index + ' score=' + h.score.toFixed(4))
}

console.log('[smoke] done')
process.exit(0)
