# RAG P2 索引管道实现计划

> 对应 spec: `docs/superpowers/specs/2026-07-30-rag-tool-design.md`
> 前置: P1 基础设施已完成(ES 8.14 + IK + embedding/rerank 客户端 + rag_index 建表)

## Goal

实现文本切块(分类型 + overlap + 语义优先)+ 索引写入(hash 去重 + doc_id 幂等 + 二次递归拆分)+ 历史对话/候选/规则三路接入,使数据能被写入 ES rag_index 供 P3 检索。

## Architecture

```
数据源                    indexDocument(input)                    ES rag_index
─────────                ──────────────────────                ──────────────
历史对话 message    ──→  sourceType=message  (单 chunk,不切块)  ──→  content +
记忆 candidate     ──→  sourceType=candidate(单 chunk,不切块)       content_vector
记忆 rule          ──→  sourceType=rule     (单 chunk,不切块)       + 元数据
外部文档 doc_chunk  ──→  sourceType=doc_chunk(按类型分档切块)         (P4 上传)

indexDocument 内部:
  1. doc_id 幂等: 先按 doc_id+user_id delete_by_query 删旧 chunk
  2. 切块: doc_chunk 走 chunkByType;其他 sourceType 整条作为单 chunk
  3. 超长兜底: 单 chunk 超 8000 token 走 splitOverflow 二次递归拆分
  4. 同批次 hash 去重: SHA-256, 内存去重(不查 ES,避免跨文档误删)
  5. embedTexts(未跳过的) -> bulk 写入,_id = `${userId}#${docId}#${chunkIndex}`
```

## Tech Stack

- TypeScript ESM, tsx 运行时
- `crypto`(Node 内置,SHA-256)- 无新依赖
- `@elastic/elasticsearch` v8(P1 已装)- bulk + delete_by_query
- `embedding-client.ts` embedTexts(P1 已实现)- 分批 + 并发 + 429 退避
- `es-client.ts` getEsClient(P1 已实现)- 复用客户端
- Vitest - vi.mock 模块 + mockClient 注入

## Design Decisions

1. **token 计数用 `estimateTokens`(字符数/1.5 估算)**,不引入 tiktoken(spec 未决事项 P2 定;用户已确认。P4 再考虑精确计数)
2. **自实现递归切块器**,不装 `@langchain/textsplitters`(项目少依赖风格;require.resolve 已确认未装;逻辑简单自实现可控)
3. **chunk hash 去重只在同批次内存内**(不查 ES chunk_hash 字段)。原因:跨文档去重会导致重新索引时丢失被跳过的 chunk(别的文档有相同片段)。chunk_hash 字段保留写入 ES(供未来审计),但不用于去重判断
4. **doc_id 幂等用 delete_by_query**(doc_id + user_id 双 filter),先删旧再写新,保证不堆积
5. **_id = `${userId}#${docId}#${chunkIndex}`**,保证跨用户 + 跨文档唯一,幂等写入覆盖
6. **历史对话/候选/规则不切块**(整条作为单 chunk),与 spec 一致;仅外部文档(doc_chunk)按类型分档切块
7. **三路接入均 fire-and-forget**,失败 console.warn 不阻断主流程(RAG 是增强能力)
8. **embedding 失败抛错让上层 catch**(indexDocument 不吞错,但接入点吞)

## Global Constraints

- 禁止 `any`,用 `unknown`
- `user_id` 贯穿索引全链路(写入 + delete_by_query + _id)
- 禁止删库:ES delete_by_query 只删 doc_id 匹配的 chunk(带 user_id filter),不删 index
- ES 不可用时 indexDocument 抛错,接入点 catch 降级(不阻断 Agent)
- 复用 P1 的 `embedTexts` / `getEsClient` / `estimateTokens`,不重复造轮子
- ESM `import`,无 `require`

## File Structure

```
server/src/services/
├── rag-chunker.ts     ← 新: 分类型切块 + 递归拆分 + 超长兜底
├── rag-indexer.ts     ← 新: indexDocument + 三路接入辅助函数
├── embedding-client.ts ← P1(复用 embedTexts/estimateTokens)
└── es-client.ts       ← P1(复用 getEsClient/EsClientLike)

server/src/routes/message.ts        ← 改: SSE done 后调 indexConversationMessages
server/src/services/memory-extractor.ts ← 改: createCandidate 后调 indexCandidate
server/src/services/memory-promoter.ts  ← 改: createRule 后调 indexRule

test/server/services/
├── rag-chunker.test.ts   ← 新
└── rag-indexer.test.ts   ← 新
```

## Tasks

### Task 1: 切块策略 `rag-chunker.ts`

**Steps**:
1. 实现 `chunkByType(text, docType)`:按 docType 分档选 chunkSize/overlap,调用 `recursiveChunk`
2. 分档参数:
   - `markdown`/`article`(段落): chunkSize=650, overlap=80(约 12%)
   - `code`/`table`(代码表格): chunkSize=400, overlap=50
   - `contract`(合同条款): chunkSize=300, overlap=40
   - 默认: chunkSize=650, overlap=80
3. 实现 `recursiveChunk(text, chunkSize, overlap, separators)`:
   - 分隔符优先级: `["\n## ", "\n### ", "\n\n", "\n", "。", "；", "；", " ", ""]`
   - 按最高优先级分隔符切分,合并相邻小块直到接近 chunkSize,超限时递归用下一级分隔符
   - overlap 保留相邻块尾部重叠部分
4. 实现 `splitOverflow(text, maxTokens=8000)`:单 chunk 超限时用更小 chunkSize(递归减半)拆分;仍超限截断并 warn
5. 导出 `chunkByType` / `recursiveChunk` / `splitOverflow`

**Test cases** (`test/server/services/rag-chunker.test.ts`):
- 短文本(< chunkSize)返回单 chunk
- 长文本按语义边界切分(优先 `##`/段落,不硬切句中)
- overlap 相邻块有重叠内容
- code 类型用更小 chunkSize
- contract 类型用最小 chunkSize
- 超长文本(> 8000 token est)splitOverflow 拆分为多个 < 8000 的 chunk
- 空字符串返回空数组

### Task 2: 索引写入核心 `rag-indexer.ts`

**Steps**:
1. 定义 `IndexChunkInput` 接口(对齐 spec):
   ```typescript
   interface IndexChunkInput {
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
   ```
2. 实现 `indexDocument(input)`:
   - 取 `getEsClient()`,null 则抛 `Error('ES unavailable')`
   - doc_id 幂等: `delete_by_query({ index, query: { bool: { filter: [{term:{doc_id}}, {term:{user_id}}] } } })`
   - 切块: sourceType=doc_chunk 走 `chunkByType`;其他 sourceType 单 chunk(text 本身)
   - 超长兜底: 每个 chunk 调 `splitOverflow`,展开
   - hash 去重: SHA-256,同批次内存 Map 去重
   - embedTexts(去重后的 chunks) -> vectors
   - bulk 写入: `_id = ${userId}#${docId}#${chunkIndex}`,doc 携带 content/content_vector/所有元数据
   - 返回 `{ indexed: number, skipped: number }`
3. 三路接入辅助函数:
   - `indexConversationMessages(convId, userId)`: 从 db 取 messages,每条调 indexDocument(sourceType=message, sourceId=msg.id, docId=`msg:${msg.id}`)
   - `indexCandidate(candidate)`: indexDocument(sourceType=candidate, sourceId=candidate.id, docId=`candidate:${candidate.id}`, text=candidate.statement)
   - `indexRule(rule)`: indexDocument(sourceType=rule, sourceId=rule.id, docId=`rule:${rule.id}`, text=rule.rule)
4. 所有函数 ES 不可用时抛错,接入点 catch

**Test cases** (`test/server/services/rag-indexer.test.ts`):
- indexDocument 正常流程: 切块 -> embed -> bulk 写入,返回 indexed 数
- doc_id 幂等: 先 delete_by_query 再 bulk
- sourceType=message 不切块(单 chunk)
- sourceType=doc_chunk 走 chunkByType(多 chunk)
- hash 去重: 同批次相同 chunk 只 embed 一次
- ES 不可用(getEsClient 返回 null)抛错
- embedTexts 失败抛错(不吞错)
- indexConversationMessages: 取 messages 逐条索引
- indexCandidate: 整条索引
- indexRule: 整条索引
- (mock embedding-client + es-client 模块)

### Task 3: 三路接入点改造

**Steps**:
1. `message.ts`: POST `/:conversationId/messages` 和 regenerate 路由,在 `extractSessionMemories(...)` 后追加:
   ```typescript
   indexConversationMessages(req.params.conversationId, req.user!.userId)
     .catch(err => console.warn('[RAG] indexConversationMessages failed:', err))
   ```
   两处都改(POST + regenerate)
2. `memory-extractor.ts`: `createCandidate` 循环内,创建后追加:
   ```typescript
   indexCandidate({ id, conversation_id, type, statement, user_id })
     .catch(err => console.warn('[RAG] indexCandidate failed:', err))
   ```
3. `memory-promoter.ts`: 三处 `createRule` 后,追加:
   ```typescript
   indexRule({ id, kind, rule, user_id })
     .catch(err => console.warn('[RAG] indexRule failed:', err))
   ```

**Test cases**:
- 接入点验证(单元测试 mock indexConversationMessages/indexCandidate/indexRule,确认被调用)
- 已有测试不回归(server 全量测试绿)

### Task 4: 集成验收

**Steps**:
1. 新增 `server/scripts/rag-p2-smoke.ts`:
   - 调 indexDocument 写入一段合同文本(docType=contract, userId=test)
   - ES 查询验证: content + content_vector + 元数据字段非空
   - 重复写入同一 doc_id: ES chunk 数不变(幂等)
   - 写入 message/candidate/rule 各一条,验证 sourceType 字段
2. 启动 ES(docker compose up -d)+ 运行 smoke 脚本
3. 确认 rag_index 中数据正确

**DoD**:
- [x] rag-chunker.ts 实现 + 测试全绿(16 passed)
- [x] rag-indexer.ts 实现 + 测试全绿(11 passed)
- [x] 三路接入改造 + server 全量测试不回归(377 passed + 18 skipped)
- [x] smoke 脚本验证: 写入 -> ES 查到 -> 重复写入不重复 -> 元数据完整
- [x] 无 `any`,无新依赖,ESM

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| RecursiveCharacterTextSplitter 自实现切分质量不稳 | 用中文语义边界(##/段落/句号)优先;超长有 splitOverflow 兜底;测试覆盖各场景 |
| delete_by_query 删错数据(跨文档) | filter 双条件: doc_id + user_id,绝不只按单字段删 |
| embedding 批量失败导致整批丢失 | embedTexts 已有 429 退避;indexDocument 抛错让接入点 catch,不影响主流程 |
| bulk 写入部分失败 | 检查 bulk response.errors,有错则 warn(不抛,已写入的成功部分保留) |
| 历史对话 message 过长(assistant 长回答) | splitOverflow 兜底,超 8000 token 递归拆分 |
| 三路接入 fire-and-forget 异常未捕获 | 每个 .catch 显式 console.warn,绝不冒泡到主流程 |

## 进度

| Task | 状态 | 备注 |
|------|------|------|
| Task 1 切块策略 | ✅ | 16 测试全绿 |
| Task 2 索引写入核心 | ✅ | 11 测试全绿 |
| Task 3 三路接入 | ✅ | 全量 377+18skip 不回归 |
| Task 4 集成验收 | ✅ | smoke 通过:3 chunk 切块+1024维向量+幂等+跨用户隔离 |
