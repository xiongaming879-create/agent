# RAG P3 检索 + 工具化实现计划

> 对应 spec: `docs/superpowers/specs/2026-07-30-rag-tool-design.md`
> 前置: P1(ES+embedding client) + P2(索引管道)已完成

## Goal

实现混合检索(BM25+kNN 加权融合 + rerank)+ 封装为 `knowledge_search` 工具 + 适配器透传 userId + 路由白名单 + Prompt 防幻觉约束,使 COMPLEX/SEARCH 路径能按需调用工具返回带来源的 top3-5。

## Architecture

```
用户问题(COMPLEX/SEARCH 路径)
  ↓
createReactAgent({ tools: [..., knowledgeSearchTool] })
  ↓ agent.stream({ messages }, { configurable: { userId } })  ← P3 改造点
  ↓
LLM 按需调用 knowledge_search({ query, docType, tags })
  ↓
hybridSearch(query, userId, options)
  1. embedQuery(query) -> 1024 维向量
  2. ES 混合检索: BM25(boost 0.35) + kNN(boost 0.65),filter(user_id + docType + tags)
  3. rerank(query, topK contents, topN) -> top3-5
  4. 返回带来源的 RagHit[]
  ↓
工具返回字符串: "[1](来源:xxx.pdf p3) 内容..."
  ↓
LLM 基于 Observation + Prompt 约束生成最终答案(标注来源)
```

## Tech Stack

- `@elastic/elasticsearch` v8 - search(BM25 match + kNN dense_vector)
- `embedding-client.ts` embedQuery + rerank(P1 已实现)
- `es-client.ts` getEsClient(P1 已实现)
- `@langchain/core/tools` DynamicStructuredTool
- `zod` - 工具 schema
- Vitest - vi.mock 模块注入

## Design Decisions

1. **ES 混合检索用 `query` + `knn` 并列**:ES 8.x 自动组合 BM25 + kNN 得分,`boost` 控制权重
2. **kNN `num_candidates=100`**:topK=20 的 5 倍,保证召回质量
3. **filter 同时应用于 query.bool.filter 和 knn.filter**:保证两路都做前置过滤
4. **rerank 失败降级原序前 topN**(P1 已实现):不阻塞检索
5. **knowledge_search 工具从 `config.configurable.userId` 取 userId**:LangGraph 透传机制
6. **`isSearchTypeTool` 加 `knowledge_search`**:复用重复输入拦截,但单独上限 5 次(本地检索不该反复调)
7. **Prompt 约束**:只用检索上下文,无答案统一话术,必标来源,rerank 后只留 3-5 条

## File Structure

```
server/src/services/
├── rag-search.ts          ← 新: hybridSearch
├── langchain-adapter.ts   ← 改: AgentRunOptions+userId, agent.stream configurable, isSearchTypeTool, MAX_KNOWLEDGE_SEARCH_CALLS
├── query-router.ts        ← 改: TOOL_FILTERS SEARCH+knowledge_search, runSearch/runComplex 传 userId, Prompt RAG 约束
├── embedding-client.ts    ← P1(复用)
└── es-client.ts           ← P1(复用)

server/src/tools/
├── knowledge-search.ts    ← 新: DynamicStructuredTool
└── index.ts               ← 改: lcTools 加 knowledgeSearchTool

test/server/services/
├── rag-search.test.ts     ← 新
└── langchain-adapter.test.ts ← 改/新增 knowledge_search 测试

server/scripts/
└── rag-p3-smoke.ts        ← 新: 端到端检索验证
```

## Tasks

### Task 1: 检索管道 `rag-search.ts`

**Steps**:
1. 定义 `RagHit` / `SearchOptions` 接口(对齐 spec)
2. 实现 `hybridSearch(query, userId, options?)`:
   - `embedQuery(query)` -> 1024 维向量
   - 构建 filter: `user_id`(必带) + `source_type`/`doc_type`/`doc_id`/`tags`(可选)
   - ES search: `query.bool.must`(match boost bm25Weight) + `query.bool.filter` + `knn`(boost vectorWeight, filter)
   - rerank(query, contents, topN) -> top3-5
   - 拼装 RagHit[](content + sourceType + sourceId + fileName + pageNumber + score)
3. ES 不可用抛错,工具层 catch 降级

**Test cases**:
- 正常检索: ES 返回 hits -> rerank -> 返回 topN RagHit
- 空结果: ES 返回 0 hits -> 返回 []
- filter 构建: user_id 必带 + docType/tags 可选
- rerank 失败降级: rerank 返回原序前 topN
- ES 不可用(getEsClient 抛错) -> hybridSearch 抛错
- knn 参数: query_vector / k / num_candidates / boost 正确

### Task 2: knowledge_search 工具 + 注册

**Steps**:
1. 创建 `knowledge-search.ts`:
   - `DynamicStructuredTool`,name='knowledge_search'
   - schema: `{ query: string, docType?: string, tags?: string[] }`
   - func: 从 `config?.configurable?.userId` 取 userId,调 `hybridSearch`
   - 无 userId 返回错误提示;无命中返回"知识库中未查询到相关内容"
   - ES 不可用 catch 返回降级提示(不抛错,让 LLM 改走 search)
   - 返回格式: `[1](来源:xxx p3) 内容...`
2. `tools/index.ts`: `lcTools` 加 `knowledgeSearchTool`

**Test cases**:
- 有 userId: 调 hybridSearch,返回格式化字符串
- 无 userId: 返回错误提示
- 无命中: 返回"知识库中未查询到相关内容"
- ES 不可用: 返回降级提示(不抛错)

### Task 3: langchain-adapter 改造

**Steps**:
1. `AgentRunOptions` 加 `userId?: string`
2. `agent.stream({ messages }, { recursionLimit, configurable: { userId: options.userId } })`
3. `isSearchTypeTool` 正则加 `knowledge_search`
4. 加 `MAX_KNOWLEDGE_SEARCH_CALLS = 5`
5. `checkSearchEffectiveness`: `knowledge_search` 用 `MAX_KNOWLEDGE_SEARCH_CALLS`,其他用 `MAX_SEARCH_CALLS`

**Test cases**:
- isSearchTypeTool 匹配 knowledge_search
- checkSearchEffectiveness: knowledge_search 超过 5 次停止
- checkSearchEffectiveness: knowledge_search 重复输入停止

### Task 4: query-router 改造

**Steps**:
1. `TOOL_FILTERS.SEARCH` 加 `'knowledge_search'`
2. `runSearch`: 工具过滤加 `knowledge_search` + prompt 加 RAG 约束 + 传 `userId: options.userId`
3. `runComplex`: prompt 加 RAG 约束 + 传 `userId: options.userId`
4. Prompt RAG 约束(追加到回答要求):
   ```
   ## 知识库检索约束(knowledge_search 被调用时生效)
   - 只允许使用检索到的上下文内容回答,禁止推理、猜测、补充外部知识
   - 上下文无答案时统一回复:"知识库中未查询到相关内容,无法解答该问题"
   - 引用答案必须标注来源:文档名 + 页码(如【来源:xxx.pdf p12】)
   - 检索结果不超过 5 条,不要堆砌无关内容
   ```

**Test cases**:
- TOOL_FILTERS.SEARCH 包含 knowledge_search
- filterTools 对 SEARCH 过滤后包含 knowledge_search
- 已有测试不回归

### Task 5: 集成验收

**Steps**:
1. `server/scripts/rag-p3-smoke.ts`:
   - 写入合同文本(P2 的 indexDocument)
   - 调 hybridSearch("违约金 条款", userId, {docType: contract})
   - 验证返回 top3-5,每个 hit 有 content + sourceType + fileName + score
   - 跨用户隔离: other-user 查不到
2. 启动 ES + 运行 smoke

**DoD**:
- [x] rag-search.ts 实现 + 测试全绿(8 passed)
- [x] knowledge-search.ts 工具 + 注册 + 测试全绿(7 passed)
- [x] langchain-adapter 改造 + 测试全绿(11 passed)
- [x] query-router 改造 + 全量测试不回归(403 passed + 18 skipped)
- [x] smoke: 检索返回带来源 top3-5 + 跨用户隔离(rerank 降序验证)
- [x] 无 `any`,无新依赖,ESM

**观察**: "量子力学"无命中场景仍返回 2 条低分结果(BM25+kNN 固有召回行为,rerank 给低分但 topN 仍返回)。非 bug,Prompt 约束让 LLM 判断相关性;P4 可加 score 阈值过滤。

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| ES knn + query 并列语法 v8 兼容 | 测试覆盖;smoke 真实验证 |
| configurable.userId 未透传到工具 | Task 3 agent.stream 加 configurable;Task 2 工具取 config.configurable.userId |
| LLM 不调 knowledge_search | description 写清触发场景;COMPLEX/SEARCH 白名单可见 |
| LLM 调用 knowledge_search 死循环 | isSearchTypeTool 纳入 + MAX_KNOWLEDGE_SEARCH_CALLS=5 + 重复输入拦截 |
| rerank API 延迟 | rerank P1 已实现降级;topK=20 限制 rerank 输入量 |

## 进度

| Task | 状态 | 备注 |
|------|------|------|
| Task 1 检索管道 | ✅ | 8 测试全绿 |
| Task 2 工具+注册 | ✅ | 7 测试全绿(func 签名 v1.x 是 input/runManager/config) |
| Task 3 adapter 改造 | ✅ | 11 测试全绿(userId 透传+独立计数+isSearchTypeTool) |
| Task 4 router 改造 | ✅ | 全量 403+18skip 不回归 |
| Task 5 集成验收 | ✅ | smoke:2 hits 降序+字段完整+跨用户隔离 |
