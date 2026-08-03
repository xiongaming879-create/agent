# RAG Tool Design

## Problem

当前 Agent 的"记忆"能力由 `memory-recall.ts` 全量注入实现：把该用户所有 `memory_rules` + 未提升的 `user_preference` candidates 拼进 system prompt。随着数据增长，这套机制有几个问题：

1. **全量注入不可扩展**：rules/candidates 超过几十条后 prompt 膨胀，挤占有效上下文，弱模型容易被无关记忆干扰
2. **无相关性筛选**：不管用户问什么，注入的都是同一批规则，没有"按当前查询召回相关内容"的能力
3. **历史对话无法复用**：`messages` 表里大量历史问答完全无法被检索，用户问"我之前问过 X 吗"只能靠人肉翻
4. **无外部文档能力**：用户无法上传文档让 Agent 基于文档回答

本质上，现有记忆系统是 RAG 的雏形（提取->存储->注入），但缺少**向量检索**这一关键召回环节。

## Current Architecture

```
用户输入
  ↓
runRoutedAgent() -> classifyQuery() -> 5 路径分流
  ↓
各路径构造 system prompt:
  buildDateContext()          ← 日期基准
  buildKnowledgeContext()     ← 内置节假日/常识(硬编码,全量)
  buildMemoryContext(userId)  ← 长期记忆(rules + candidates,全量注入)
  ↓
createReactAgent(llm, tools, prompt)
```

**记忆系统现状**（`memory-db.ts` + `memory-extractor.ts` + `memory-recall.ts` + `memory-promoter.ts`）：

| RAG 阶段 | 现有实现 | 缺口 |
|---------|---------|------|
| 索引（提取） | LLM 抽取 candidate/episode | ✅ 已有 |
| 存储 | `memory.db`（episodes/candidates/rules） | 缺 embedding |
| **召回** | `buildMemoryContext` 全量注入 | ❌ 无相关性检索 |
| 注入 | 拼到 system prompt | ✅ 已有 |

本设计在**不替换**记忆系统的基础上，补齐"向量检索 + 混合召回 + rerank"环节，并以**工具**形式暴露给 Agent 按需调用。

## Design

### 整体架构

```
┌─ 数据源 ──────────────────────────┐    ┌─ 索引管道 ──────────────────────────────┐
│ 历史对话 messages                  │    │ 语义切块(分类型 token + overlap 10-15%)  │
│ 记忆 candidates/rules             │ ──> │ 长度校验(超 8K 二次递归拆分)              │
│ 外部文档(P4 上传)                 │    │ chunk hash 去重                           │
└───────────────────────────────────┘    │ embed(text) 调硅基流动 API(分批+并发控制)│
                                          │ 写入 ES(text + dense_vector + 元数据)    │
                                          │ 文档 ID 幂等更新(存在则覆盖)             │
                                          └──────────────────────────────────────────┘

┌─ 检索管道(knowledge_search 工具触发)──────────────────────────────────────┐
│ query                                                                       │
│   1. 元数据前置 filter(user_id + doc_type + tags + 时间...)                 │
│   2. BM25(match,IK 分词,boost 0.35)+ kNN(dense_vector,boost 0.65)         │
│      加权融合 -> topK(默认 20)                                              │
│   3. rerank(硅基流动 bge-reranker-v2-m3 API)-> top3~5                     │
│   4. 拼装带来源标注的上下文返回给 Agent                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 选型决策（已拍板）

| 维度 | 选型 | 说明 |
|------|------|------|
| embedding 服务 | 硅基流动 `BAAI/bge-m3` | 固定 1024 维，OpenAI 兼容 `/v1/embeddings` |
| rerank 服务 | 硅基流动 `BAAI/bge-reranker-v2-m3` | `/v1/rerank`，与 embedding 共用一个 key |
| API key | 环境变量 `EMBEDDING_AND_RERANK_API_KEY` | 与 chat 代理 key 分离，代理只支持 chat stream |
| 向量库 | Elasticsearch 8.x | 原生 BM25 + kNN + 加权融合，一套搞定混合检索 |
| RAG 形态 | 工具化（模式 B） | 封装为 `knowledge_search` 内置工具，Agent 按需调用 |
| 限流档位 | 硅基流动 L0：RPM=2000，TPM=500000 | embedding + rerank 共享，需做并发控制 |

**为什么不用 FAISS**：FAISS 只做向量检索，BM25 和加权融合需自造轮子；`faiss-node` 是 native 模块，Windows 编译有风险（项目已踩过 `better-sqlite3` 的坑）。ES 8.x 原生支持混合检索，纯 JS 客户端 `@elastic/elasticsearch`，与栈契合。

**为什么不本地跑 embedding**：用户明确要求调 API，省去本地模型下载与 ONNX runtime 预热；硅基流动国内访问快、有免费额度、embedding/rerank 共用一个 key。

### ES 部署

新增 `docker-compose.yml`（项目根目录，目前无此文件）：

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.14.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false        # 单机开发模式,禁用认证简化接入
      - ES_JAVA_OPTS=-Xms4g -Xmx4g          # 强制限制 JVM 堆 4G(16G 笔记本防 OOM)
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data
    # 健康检查 + 磁盘水位监控见"边界兜底"节
  # IK 分词器需进容器安装:bin/elasticsearch-plugin install analysis-ik
  # 版本必须与 ES(8.14.0)严格匹配;或构建自带 IK 的自定义镜像

volumes:
  es-data:
```

**🚨 中文分词插件（IK）**：ES 默认 standard analyzer 对中文逐字切分，BM25 召回质量极差。**必须安装 IK 分词器**（`analysis-ik`，版本与 ES 严格匹配）。备选 ES 自带 `smartcn`（效果弱但零安装），mapping 的 analyzer 改为 `smartcn`。

### ES 索引结构规范

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart"
      },
      "content_vector": {
        "type": "dense_vector",
        "dims": 1024,
        "index": true,
        "similarity": "cosine"
      },
      "source_type": { "type": "keyword" },
      "source_id":   { "type": "keyword" },
      "user_id":     { "type": "keyword" },
      "doc_id":      { "type": "keyword" },
      "file_name":   { "type": "keyword" },
      "file_path":   { "type": "keyword" },
      "page_number": { "type": "integer" },
      "doc_type":    { "type": "keyword" },
      "uploaded_at": { "type": "date" },
      "tags":        { "type": "keyword" },
      "chunk_hash":  { "type": "keyword" },
      "chunk_index": { "type": "integer" },
      "created_at":  { "type": "date" }
    }
  }
}
```

规范要点：

- **分片**：本地单节点 `number_of_shards=1`、`number_of_replicas=0`，避免多余开销
- **dense_vector**：`index=true`（即 knn 类型），`dims=1024` 与 bge-m3 严格对齐，`similarity=cosine`
- **元数据全部字段化**（不塞进 `object`），每条向量块强制携带：`doc_id`/`file_name`/`file_path`/`page_number`/`doc_type`/`uploaded_at`/`tags`——后续可在 ES 做条件过滤（只查某份 PDF、只查技术文档、按标签筛）
- `chunk_hash`：用于入库去重；`chunk_index`：chunk 在原文档内的序号
- `source_type`：`'message' | 'candidate' | 'rule' | 'doc_chunk'`；`source_id` 关联 `messages.id`/`candidates.id`
- `user_id`：**用户隔离关键字段**，检索 filter 必带

索引名约定：`rag_index`（单索引，靠 `user_id` + `source_type` + 元数据过滤）。

### 切块策略（不能一刀切）

**按文档类型分档**，以 token 计量（非字符）：

| 文档类型 | chunk 大小 | 说明 |
|---------|-----------|------|
| 纯段落文本 | 500–800 token | 通用 Markdown / 文章 |
| 代码块 / 表格 | 300–500 token | 保留代码/表格完整性 |
| 法律合同 / 条款 | 200–400 token | 防止跨条款断句 |

**强制规则**：

1. **必须重叠切片**：overlap 10%–15%，避免上下文被切断裂意（如 500 token chunk，overlap 50–75 token）
2. **禁止按固定字符硬切**：优先按语义边界分割，优先级从高到低：Markdown 二级标题（`##`）-> 换行段落 -> 分页符 -> 句号；仅在语义边界内超限时才退化为字符切
3. **代码块/表格不可切割**：作为整体 chunk，超限时按行/行组递归拆分，不破坏语法结构
4. **长度校验（见边界兜底）**：切完后单 chunk 超 embedding 模型上下文窗口（8K）必须二次递归拆分

实现：用 langchain `RecursiveCharacterTextSplitter`（已依赖 langchain），按类型传入不同 `chunkSize`/`chunkOverlap`，分隔符优先级 `["\n## ", "\n\n", "\n", "。", " "]`。token 计数用 `tiktoken` 或按 `字符数/1.5` 估算（中文偏保守）。

### Embedding / Rerank API 客户端

新增 `server/src/services/embedding-client.ts`，用原生 `fetch`（与 `llm-caller.ts` 风格一致，不引入 axios）：

```typescript
const SF_BASE_URL = process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1'
const SF_API_KEY = process.env.EMBEDDING_AND_RERANK_API_KEY || ''
const EMBED_MODEL = process.env.EMBED_MODEL || 'BAAI/bge-m3'
const RERANK_MODEL = process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3'
const EMBED_DIMS = 1024                  // bge-m3 固定 1024 维,ES mapping 必须对齐
const EMBED_MAX_TOKENS = 8000            // 单条 chunk 上限,超限拒绝调用
const EMBED_BATCH_SIZE = 16              // 单批最多 16 条,防 429
const EMBED_CONCURRENCY = 3              // 并发批次数,共享 L0: RPM=2000/TPM=500000

// 批量嵌入:内部按 EMBED_BATCH_SIZE 分批 + 并发控制,返回 Float32Array[]
export async function embedTexts(texts: string[]): Promise<Float32Array[]>
export async function embedQuery(text: string): Promise<Float32Array>

// rerank:对 documents 按 query 相关性重排,返回 top_n 的 {index, score}
export interface RerankHit { index: number; score: number }
export async function rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>
```

API 格式（硅基流动，OpenAI 兼容）：

```http
POST /v1/embeddings
{ "model": "BAAI/bge-m3", "input": ["text1","text2"], "encoding_format": "float" }
# resp: { "data": [{ "embedding": [0.01, ...] }, ...] }

POST /v1/rerank
{ "model": "BAAI/bge-reranker-v2-m3", "query": "...", "documents": ["d1","d2"], "top_n": 5, "return_documents": false }
# resp: { "results": [{ "index": 0, "relevance_score": 0.95 }, ...] }
```

**并发与限流控制**：

- embedding + rerank **共用一个 key、共享 L0 档位**（RPM=2000、TPM=500000），客户端用信号量控制并发批次数（`EMBED_CONCURRENCY=3`）
- 批量向量化**分批提交**（`EMBED_BATCH_SIZE=16`），禁止一次塞几百条，极易触发 429
- 遇 429 时指数退避重试（1s -> 2s -> 4s，最多 3 次），仍失败则抛错让上层兜底
- **长度校验**：调 API 前校验单条 token，超 `EMBED_MAX_TOKENS` 拒绝调用并记录，避免接口报错

**容错**：`embedTexts` 失败抛错（索引管道可重试）；`rerank` 失败**降级返回原序前 topN**（不阻塞检索）。

### 索引管道（去重 / 幂等 / 递归拆分）

新增 `server/src/services/rag-indexer.ts`：

```typescript
export interface IndexChunkInput {
  text: string
  userId: string
  sourceType: 'message' | 'candidate' | 'rule' | 'doc_chunk'
  sourceId: string
  meta: {
    docId?: string
    fileName?: string
    filePath?: string
    pageNumber?: number
    docType?: string        // 'markdown' | 'pdf' | 'code' | 'contract' | ...
    uploadedAt?: string
    tags?: string[]
  }
}

// 通用写入入口:切块 -> 去重 -> embed -> 写 ES(幂等)
export async function indexDocument(input: IndexChunkInput): Promise<{ indexed: number; skipped: number }>
```

**去重与幂等**：

1. **chunk hash 去重**：入库前对每条 chunk 文本算 SHA-256，查 ES `chunk_hash` 字段，已存在则跳过（不重复 embed、不重复写）
2. **文档级幂等**：以 `doc_id` 为键，重新索引同一文档时**先按 `doc_id` 删旧 chunk 再写新 chunk**（存在则覆盖，不重复插入向量），避免重复文档堆积
3. **二次递归拆分**：切完后单 chunk 仍超 `EMBED_MAX_TOKENS` 时，用更小 `chunkSize` 递归拆分一次；仍超限则截断并告警

**写入 ES**：`_id` 用 `${docId}#${chunkIndex}` 或 `chunk_hash`，保证幂等；批量 `bulk` API 写入。

### 检索流程（前置过滤 + 加权融合 + Rerank）

新增 `server/src/services/rag-search.ts`：

```typescript
export interface RagHit {
  content: string
  sourceType: string
  sourceId: string
  fileName?: string
  pageNumber?: number
  score: number
}

export interface SearchOptions {
  topK?: number             // 默认 20,加权融合候选数
  topN?: number             // 默认 5,rerank 后返回数(强约束 3-5)
  sourceType?: string
  docType?: string          // 元数据过滤:只查某类文档
  docId?: string            // 元数据过滤:只查某份文档
  tags?: string[]           // 元数据过滤:按标签
  bm25Weight?: number       // 默认 0.35,范围 0.3-0.4
  vectorWeight?: number     // 默认 0.65,范围 0.6-0.7
}

export async function hybridSearch(
  query: string,
  userId: string,
  options?: SearchOptions
): Promise<RagHit[]>
```

ES 混合检索查询体（**前置 filter + 加权融合**）：

```json
{
  "size": 20,
  "_source": ["content", "source_type", "source_id", "file_name", "page_number"],
  "query": {
    "bool": {
      "must": [
        { "match": { "content": { "query": "<query>", "boost": 0.35 } } }
      ],
      "filter": [
        { "term": { "user_id": "<userId>" } },
        { "term": { "doc_type": "pdf" } }
      ]
    }
  },
  "knn": {
    "field": "content_vector",
    "query_vector": [0.01, "..."],
    "k": 20,
    "num_candidates": 100,
    "boost": 0.65,
    "filter": [
      { "term": { "user_id": "<userId>" } },
      { "term": { "doc_type": "pdf" } }
    ]
  }
}
```

流程要点：

1. **前置过滤**：元数据 filter（user_id + doc_type + tags + 时间）**先过滤再做向量召回**，减少无效计算。`knn.filter` 与 `query.bool.filter` 保持一致
2. **加权融合**：BM25 `boost=0.35` + kNN `boost=0.65`，ES 自动组合得分。权重经验值 BM25 0.3–0.4 / 向量 0.6–0.7，**偏问答加大向量权重，偏精准资料查找加大关键词权重**
3. **rerank**：对 topK 的 content 调 rerank API，按 `relevance_score` 降序取 `topN`（3–5）
4. **返回带来源**：每个 hit 携带 `fileName`/`pageNumber`，供 Agent 标注引用

### knowledge_search 工具的按需调用机制

**核心**：工具不是被代码硬编码调用的，而是通过 LangGraph ReAct 循环，由 LLM 在每一步推理中**自主决定**调不调、调几次、用什么参数。代码只负责"把工具交给 Agent"和"透传上下文"，决策权在 LLM。

#### 完整调用链路（时序）

```
用户问题 "根据我上传的合同,违约金条款怎么说"
  ↓
runRoutedAgent -> classifyQuery -> COMPLEX 路径
  ↓
createAgent(MODEL_STRONG, allLcTools[含 knowledge_search], prompt)
  ↓ agent.stream({ messages }, { recursionLimit, configurable: { userId } })  ← P3 改造点
  ↓
┌─ ReAct 循环 ─────────────────────────────────────────────────────────────┐
│ [轮次1 · agent 节点] LLM 看到 system prompt 末尾的:                      │
│   Available tools:                                                       │
│   - knowledge_search - 检索本地知识库(历史对话/记忆/已上传文档)...        │
│   - search - 联网搜索...                                                  │
│   - calculator - ...                                                      │
│   LLM Thought: "用户问合同违约金,这是已上传文档,该先查本地知识库"          │
│   LLM 输出 tool_call: knowledge_search({ query: "违约金 条款", docType: "contract" })│
│        ↓ yield action 事件                                                │
│ [轮次1 · tools 节点] LangGraph 执行 knowledge_search.func({query,docType}, config)│
│   - 从 config.configurable.userId 取 userId                               │
│   - hybridSearch("违约金 条款", userId, {docType:"contract", topN:5})     │
│   - 返回: "[1](来源:租房合同.pdf p3) 乙方逾期...违约金月租200%..."          │
│        ↓ yield observation 事件                                           │
│ [轮次2 · agent 节点] LLM 看到 Observation,Thought: "信息够了,直接回答"    │
│   LLM 输出最终答案(带来源标注): "根据【租房合同.pdf p3】..."              │
│        ↓ yield content_delta 事件(打字机)                                │
│ 不再输出 tool_call -> 循环结束                                            │
└──────────────────────────────────────────────────────────────────────────┘
  ↓
yield done
```

#### 环节 1：工具如何进入 Agent 视野

```typescript
// tools/index.ts
export const lcTools = [calculatorTool, knowledgeSearchTool]  // 注册

// query-router.ts createAgent()
const agent = createReactAgent({ llm, tools: allLcTools, prompt })
```

`createReactAgent` 会把 `tools` 的 `name` + `description` + `schema` 自动拼进 system prompt 的 `Available tools:` 区块（见 `runComplex` 现有 prompt 末尾）。**LLM 只通过这段文本知道工具的存在和能力**——所以 `description` 是"按需"的决策依据，必须写清触发场景（见下方工具定义）。

#### 环节 2：LLM 按需决策（ReAct Thought）

LLM 拿到用户问题后，在 Thought 里判断"是否需要检索本地知识库"。决策依据是 `description` 里的触发条件 + 问题性质：

| 用户问题 | LLM 决策 | 原因 |
|---------|---------|------|
| "根据我上传的合同,违约金多少" | ✅ 调 `knowledge_search` | 明确指向已上传文档 |
| "我之前问过西藏行程吗" | ✅ 调 `knowledge_search` | 回顾历史对话 |
| "上次你帮我算的那个结果" | ✅ 调 `knowledge_search` | 回顾历史 |
| "你好" / "根号2" / "今天几号" | ❌ 不调 | 走 CHITCHAT/CALCULATION/KNOWLEDGE 路径，这些路径工具白名单为空，LLM 根本看不到 `knowledge_search` |
| "后天北京天气" | ❌ 不调 `knowledge_search`，改调 `search` | 天气是实时信息，本地知识库没有，description 写明"无命中改用 search 联网" |
| "对比 A 和 B 两个方案" | 🤔 可能调，可能不调 | LLM 判断本地是否有相关资料，有则调，无则直接推理 |

**关键**：`description` 要把"什么时候该调、什么时候不该调、无命中怎么办"写死，LLM 才能稳定"按需"。工具定义（更新版）：

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { hybridSearch } from '../services/rag-search'

export const knowledgeSearchTool = new DynamicStructuredTool({
  name: 'knowledge_search',
  description: `检索本地知识库(历史对话、记忆、已上传文档),返回与查询最相关的 3-5 条文本片段(已 rerank 重排序,每条含来源文档名/页码)。

何时调用:
- 用户明确指向已上传文档("根据我上传的合同/文档...")
- 用户要求回顾历史问答("我之前问过/你之前说过...")
- 问题可能涉及本地积累的资料,且需要准确引用来源

何时不调用:
- 实时信息(天气/新闻/价格)-> 改用 search 联网
- 简单常识/计算 -> 直接回答
- 纯闲聊 -> 直接回答

无命中时:返回空提示,此时不要编造,改用 search 联网或直接告知用户"知识库中未查询到相关内容"。

输入:query(自然语言描述要找的内容),可选 docType/tags 过滤。`,
  schema: z.object({
    query: z.string().describe('检索查询,自然语言描述要找的内容'),
    docType: z.string().optional().describe('文档类型过滤:pdf/markdown/contract/code'),
    tags: z.array(z.string()).optional().describe('标签过滤'),
  }),
  func: async ({ query, docType, tags }, config) => {
    const userId = (config?.configurable?.userId as string) ?? ''
    if (!userId) return 'Error: missing userId, knowledge_search unavailable'
    try {
      const hits = await hybridSearch(query, userId, { topN: 5, docType, tags })
      if (hits.length === 0) return '知识库中未查询到相关内容。'
      return hits.map((h, i) =>
        `[${i + 1}] (来源:${h.fileName ?? h.sourceType}${h.pageNumber ? ` p${h.pageNumber}` : ''}) ${h.content}`
      ).join('\n\n')
    } catch (err) {
      // ES 不可用降级:返回提示而非抛错,让 LLM 改走 search
      return `知识库检索暂时不可用: ${err instanceof Error ? err.message : String(err)}。建议改用 search 联网。`
    }
  },
})
```

#### 环节 3：执行 + 结果回灌 + 多轮

1. **LLM 输出 tool_call** -> LangGraph `tools` 节点执行 `func` -> 返回字符串
2. **结果作为 `ToolMessage` 回灌**给下一轮 agent 节点（即 ReAct 的 Observation）
3. **LLM 再决策**：信息够 -> 输出最终答案；不够 -> 换关键词再调 `knowledge_search`，或转 `search` 联网
4. `langchain-adapter.ts` 把每轮的 `tool_call` yield 成 `action` 事件、结果 yield 成 `observation` 事件（前端思考过程可视化）

#### 环节 4：与路由白名单的配合

`query-router.ts` 的 `TOOL_FILTERS` 决定哪些路径能看到 `knowledge_search`：

```typescript
const TOOL_FILTERS: Record<QueryCategory, string[] | null> = {
  CHITCHAT: [],                         // 无工具,LLM 看不到 knowledge_search
  KNOWLEDGE: [],                        // 无工具
  CALCULATION: ['calculator'],          // 只有计算器
  SEARCH: ['search', 'fetch', 'browser_*', 'knowledge_search'],  // 先查本地,未命中再联网
  COMPLEX: null,                        // 全工具,自动包含
}
```

**只有 `COMPLEX` 和 `SEARCH` 路径的 LLM 能看到 `knowledge_search`**，其他路径工具白名单不含它，LLM 无从调用——这就是路由层对"按需"的第一层过滤。

#### 环节 5：防滥用（纳入搜索类管控）

`langchain-adapter.ts` 现有 `isSearchTypeTool` 正则只匹配 `search/fetch/browser_*`。**必须加上 `knowledge_search`** 才能复用重复输入拦截 + 总次数上限：

```typescript
// langchain-adapter.ts 改造
function isSearchTypeTool(toolName: string): boolean {
  return /^(search|knowledge_search|fetch|browser_navigate|browser_snapshot|browser_click|browser_type|browser_fill|browser_take_screenshot)/i.test(toolName)
}
```

但 `knowledge_search` 是本地检索，不需要 25 次上限。建议**单独设更小上限**：

```typescript
const MAX_SEARCH_CALLS = 25                  // 联网搜索
const MAX_KNOWLEDGE_SEARCH_CALLS = 5         // 本地知识库检索(本地检索不该反复调)

function checkSearchEffectiveness(toolName, toolInput, _output, state) {
  if (!isSearchTypeTool(toolName)) return { shouldStop: false, reason: null }
  state.searchCallCount++
  // 重复输入拦截(同 query 调 2 次即停)
  const inputKey = `${toolName}:${normalizeToolInput(toolInput)}`
  const inputCount = (state.seenInputs.get(inputKey) || 0) + 1
  state.seenInputs.set(inputKey, inputCount)
  if (inputCount >= 2) return { shouldStop: true, reason: `重复调用 ${toolName}` }
  // 总次数兜底:knowledge_search 用更小上限
  const limit = toolName === 'knowledge_search' ? MAX_KNOWLEDGE_SEARCH_CALLS : MAX_SEARCH_CALLS
  if (state.searchCallCount > limit) return { shouldStop: true, reason: `${toolName} 调用超上限 ${limit}` }
  return { shouldStop: false, reason: null }
}
```

#### 必须改造的代码点（P3）

| 文件 | 现状 | 改造 |
|------|------|------|
| `langchain-adapter.ts:119` | `agent.stream({ messages }, { recursionLimit })` | 加 `configurable: { userId: options.userId }`；`AgentRunOptions` 加 `userId` 字段 |
| `langchain-adapter.ts:36` | `isSearchTypeTool` 不含 `knowledge_search` | 正则加 `knowledge_search` |
| `langchain-adapter.ts:51` | 单一 `MAX_SEARCH_CALLS=25` | 加 `MAX_KNOWLEDGE_SEARCH_CALLS=5`，按工具名区分上限 |
| `query-router.ts` | `runComplex`/`runSearch` 调 `langchainAgentRunner(agent, messages, { maxIterations })` | 传 `userId: options.userId` |

### Prompt 强约束（防幻觉第一手段）

`knowledge_search` 返回的上下文注入 Agent 后，通过 system prompt 强约束回答行为。约束模板要点：

1. **只允许使用检索到的上下文内容回答**，禁止推理、猜测、补充外部知识
2. **上下文无答案时统一回复**：`"知识库中未查询到相关内容，无法解答该问题"`，不得编造
3. **引用答案必须标注来源**：文档名 + 页码（如 `【来源：xxx.pdf p12】`），与工具返回的 `fileName`/`pageNumber` 对齐
4. **上下文长度严格管控**：rerank 后只留 3–5 条 chunk（`topN` 上限 5），防止超长上下文导致模型性能下降、回答混乱、token 浪费

约束注入位置：COMPLEX 路径 prompt 的"回答要求"区块追加 RAG 专用条款（仅当 `knowledge_search` 被调用时生效，可由工具返回值带标识触发）。

### 数据源与索引时机

| 数据源 | 索引时机 | source_type | 切块方式 |
|--------|---------|-------------|---------|
| 历史对话 | 对话结束 `extractSessionMemories` hook 里顺带索引本轮 user+assistant 消息 | `message` | 按 message 天然边界，不切分 |
| 记忆 candidate | `createCandidate` 后同步建 embedding | `candidate` | statement 整条，不切分 |
| 记忆 rule | `createRule` 后同步建 embedding | `rule` | rule 整条，不切分 |
| 外部文档（P4） | 上传时分块 + 批量索引 | `doc_chunk` | 按类型分档切块（见"切块策略"） |

历史对话索引触发点：`message.ts` 路由在 SSE `done` 后已调用 `extractSessionMemories`，在此追加 `indexConversationMessages(convId, userId)`（fire-and-forget，失败不影响主流程）。

### 启动流程接入

`index.ts` 的 `start()` 在 MCP 初始化后、`listen` 前插入 ES 客户端初始化：

```typescript
await initEsClient()      // 连接 + 确保 rag_index 存在(不存在则按 mapping 创建)
await warmupEmbedding()   // 首次调一次 embed 预热连接(可选,避免首查冷启动延迟)
```

**ES 不可用不阻断启动**：`initEsClient` 失败只 `console.warn`，`knowledge_search` 运行时降级（见边界兜底）。RAG 是增强能力，不能让 ES 故障拖垮整个 Agent。

## 边界行为兜底

### 边界 1：chunk 超长，超出 embedding 8K 上下文

- **校验**：`embedTexts` 调用前校验单条 token，超 `EMBED_MAX_TOKENS`（8000）拒绝调用，避免接口报错
- **兜底**：`indexDocument` 切块后对超长 chunk 用更小 `chunkSize` **二次递归拆分**；仍超限则截断并告警记录

### 边界 2：重复文档 / 重复片段入库

- **chunk 级去重**：入库前算 SHA-256，查 ES `chunk_hash` 已存在则跳过
- **文档级幂等**：以 `doc_id` 为键，重新索引时先删旧 chunk 再写新 chunk（存在则覆盖，不重复插入向量）

### 边界 3：ES 容器崩溃 / 磁盘满 / 内存 OOM（16G 笔记本高发）

- **JVM 堆强制限制**：`-Xms4g -Xmx4g`，防 ES 抢占宿主内存导致 OOM
- **磁盘水位监控**：启动时 + 定时检查 ES 数据盘剩余空间，**低于 10GB 告警**（ES 默认 flood-stage 95% 水位会变只读，提前预警）
- **ES 连接失败降级**：`knowledge_search` 检测 ES 不可用时，**临时切为纯关键词检索**（降级查 `agent.db` 的 `messages` 表 LIKE，或返回空提示），保证问答可用——效果降级但服务不挂

## Phases

| 阶段 | 工作 | 验收 |
|------|------|------|
| **P1** 基础设施 | docker-compose 起 ES + 装 IK；装 `@elastic/elasticsearch`；`embedding-client.ts`（embed/rerank + 分批 + 并发控制 + 长度校验）；ES 客户端初始化 + index mapping 创建（1 分片 0 副本） | 能手动调 `embedTexts`/`rerank`；ES 中能看到 `rag_index` 与字段化元数据 |
| **P2** 索引管道 | 分类型切块策略（段落/代码表格/合同三档 + overlap 10-15% + 语义优先）；`indexDocument`（hash 去重 + doc_id 幂等 + 二次递归拆分）；历史对话/候选/规则三路接入 | 写入后 ES 能查到文档，向量与元数据字段非空，重复写入不产生重复 chunk |
| **P3** 检索 + 工具化 | `rag-search.ts`（前置 filter + BM25/kNN 加权融合 + rerank）；`knowledge_search` 工具；`langchain-adapter` 透传 `userId` + `isSearchTypeTool` 纳入；路由白名单；Prompt 强约束注入 | COMPLEX 路径能调用工具，返回带来源的 top3-5；跨用户隔离验证通过 |
| **P4** 文档上传 + 优化 | 文档上传 API（复用 multer）+ 前端管理 UI；embedding 缓存；磁盘水位监控；召回质量监控 | 用户能上传 PDF/MD 并基于其内容问答，来源标注正确 |

## 环境变量（新增）

| 变量 | 默认值 | 必需 | 说明 |
|------|--------|------|------|
| `EMBEDDING_AND_RERANK_API_KEY` | (空) | ✅ | 硅基流动 API key，embedding + rerank 共用 |
| `EMBEDDING_BASE_URL` | `https://api.siliconflow.cn/v1` | ❌ | 硅基流动 base_url |
| `EMBED_MODEL` | `BAAI/bge-m3` | ❌ | embedding 模型（1024 维） |
| `RERANK_MODEL` | `BAAI/bge-reranker-v2-m3` | ❌ | rerank 模型 |
| `ES_URL` | `http://localhost:9200` | ❌ | ES 地址 |
| `ES_USER` / `ES_PASSWORD` | (空) | ❌ | ES 认证（开启 xpack 时） |
| `RAG_INDEX` | `rag_index` | ❌ | ES 索引名 |
| `RAG_TOP_K` | `20` | ❌ | 加权融合候选数 |
| `RAG_TOP_N` | `5` | ❌ | rerank 后返回数（强约束 3-5） |
| `RAG_BM25_WEIGHT` | `0.35` | ❌ | BM25 权重（0.3-0.4） |
| `RAG_VECTOR_WEIGHT` | `0.65` | ❌ | 向量权重（0.6-0.7） |
| `EMBED_BATCH_SIZE` | `16` | ❌ | 单批 embedding 数，防 429 |
| `EMBED_CONCURRENCY` | `3` | ❌ | 并发批次数 |
| `ES_DISK_WARN_GB` | `10` | ❌ | 磁盘水位告警阈值（GB） |

## 文件结构（新增）

```
server/src/
├── services/
│   ├── embedding-client.ts   ← 硅基流动 embed/rerank 客户端(分批+并发+长度校验)
│   ├── es-client.ts          ← ES 连接 + index 初始化 + 磁盘水位监控
│   ├── rag-search.ts         ← 前置过滤 + 加权融合 + rerank
│   ├── rag-indexer.ts        ← 切块 + hash 去重 + doc_id 幂等 + 递归拆分
│   └── rag-chunker.ts        ← 分类型切块策略
├── tools/
│   └── knowledge-search.ts   ← DynamicStructuredTool
├── tools/index.ts            ← 注册 knowledgeSearchTool(改)
├── services/query-router.ts  ← 工具白名单 + Prompt 强约束(改)
├── services/langchain-adapter.ts ← 透传 userId + isSearchTypeTool 纳入(改)
└── index.ts                  ← 启动初始化 ES(改)

docker-compose.yml             ← ES 服务(JVM 4G)(新增,项目根)
test/server/services/
├── embedding-client.test.ts
├── rag-chunker.test.ts
├── rag-search.test.ts
└── rag-indexer.test.ts
```

## 约束与陷阱

1. **🚨 用户隔离**：`user_id` 必须贯穿索引（写入）+ 检索（filter）+ 工具调用（config 透传）全链路，绝不跨用户召回
2. **🚨 禁止删库**：ES index 不存在时 `CREATE`，已存在时**不重建**；mapping 变更只能新增字段，禁止删 index / 改已有字段类型（与 sql.js 迁移铁律一致）
3. **ES 不可用不阻断主服务**：初始化失败只 `console.warn`，运行时降级为纯关键词检索或返回空提示；RAG 是增强能力，不能拖垮 Agent
4. **中文分词必须装 IK**：否则 BM25 退化为单字匹配；IK 版本必须与 ES 严格匹配
5. **embedding/rerank 走独立配置**：不能复用 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`（chat 代理只支持 stream）
6. **并发与限流**：embedding + rerank 共享 L0（RPM=2000/TPM=500000），必须分批 + 信号量并发控制，遇 429 指数退避；rerank 失败降级原序
7. **bge-m3 固定 1024 维**：ES `dims` 必须严格对齐，换模型需重建 index
8. **chunk 长度校验**：超 8K 拒绝调 API，二次递归拆分，避免接口报错
9. **去重与幂等**：chunk_hash 去重 + doc_id 幂等更新，防重复入库
10. **ESM + 无 any**：服务端 ESM，禁止 `any` 用 `unknown`，与项目约定一致
11. **Prompt 防幻觉**：只用检索上下文回答，无答案统一话术，必标来源，rerank 后只留 3-5 条
12. **JVM 堆 4G + 磁盘水位**：16G 笔记本防 OOM，磁盘 < 10GB 告警
13. **knowledge_search 防滥用**：必须纳入 `isSearchTypeTool` 管控，重复输入拦截 + 单独上限 5 次，防 LLM 反复检索死循环
14. **userId 透传改造**：`langchain-adapter.ts` 现状未传 `configurable`，P3 必须改造，否则工具拿不到 userId 无法隔离检索

## 未决事项

- **token 计数方式**：`tiktoken`（精确，需装依赖）vs 字符数估算（零依赖但偏差）—— P2 定
- **rerank topN 取值**：默认 5，需结合召回质量调参（top3 更精准，top5 更全）
- **embedding 缓存方案**：内存 LRU / ES 内查重 / 持久化缓存—— P4 定
- **历史对话是否全量回填**：存量 messages 一次性建索引 vs 只索引增量—— P4 定
- **降级关键词检索的落地范围**：`agent.db` LIKE 查全部 messages 还是仅近期—— P3 定
