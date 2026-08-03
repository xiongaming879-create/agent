# RAG P1 基础设施实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 RAG 基础设施层:起 ES 8.x(含 IK 分词)+ 接入硅基流动 embedding/rerank API 客户端(分批 + 并发控制 + 长度校验 + 429 退避)+ ES 客户端初始化与 index mapping 创建。P1 不涉及切块/索引/检索,只交付可独立调用的底层能力。

**Architecture:** docker-compose 起 ES(4G JVM,1 分片 0 副本);`es-client.ts` 封装连接 + `rag_index` 自动建表(字段化元数据);`embedding-client.ts` 用原生 fetch 调硅基流动 `/v1/embeddings` + `/v1/rerank`,内部做分批(16 条)、信号量并发(3)、长度校验(8K)、429 指数退避、rerank 失败降级原序。

**Tech Stack:** TypeScript (ESM), `@elastic/elasticsearch`, 原生 fetch, Vitest, Docker

**对应 spec:** `docs/superpowers/specs/2026-07-30-rag-tool-design.md`

## Design Decisions (已确认)

1. **ES 8.14.0** + IK 分词器(版本严格匹配),docker-compose 单节点,`xpack.security.enabled=false`
2. **JVM 堆 4G**(`-Xms4g -Xmx4g`),防 16G 笔记本 OOM
3. **embedding/rerank 共用一个 key**(`EMBEDDING_AND_RERANK_API_KEY`),共享 L0 限流 RPM=2000/TPM=500000
4. **向量维度 1024**(bge-m3),ES `dense_vector dims=1024` 严格对齐
5. **ES 不可用不阻断主服务**:`initEsClient` 失败只 `console.warn`,RAG 工具运行时降级(降级逻辑 P3 实现,P1 只保证不崩)
6. **纯逻辑可单测**(mapping 构造、分批、长度校验、退避计算),ES 实际交互用集成测试 `describe.skip`(需服务运行,遵循项目约定)

## Global Constraints

- 服务端 ESM,禁止 `any` 用 `unknown`,与项目约定一致
- 环境变量走 `process.env`(与 `ANTHROPIC_AUTH_TOKEN` 同模式),不引入 dotenv 新依赖(除非项目已有)
- embedding/rerank 走**独立配置**,不复用 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`(chat 代理只支持 stream)
- **禁止删库**:ES index 不存在才 `CREATE`,已存在不重建;mapping 只能增字段
- 测试在项目根 `test/` 运行,Vitest environment: node
- IK 分词器版本必须与 ES(8.14.0)严格匹配,否则 ES 启动失败

---

## File Structure

### New files

| 文件 | 职责 |
|------|------|
| `docker-compose.yml` | ES 8.14.0 服务(项目根) |
| `server/docker/elasticsearch.Dockerfile` | 带 IK 插件的自定义 ES 镜像 |
| `server/src/services/es-client.ts` | ES 连接 + `rag_index` 自动建表 + 磁盘水位检查 |
| `server/src/services/embedding-client.ts` | 硅基流动 embed/rerank 客户端(分批+并发+校验+退避) |
| `test/server/services/es-client.test.ts` | mapping 构造 + 建表逻辑测试 |
| `test/server/services/embedding-client.test.ts` | embed/rerank 分批+并发+校验+退避+降级测试 |

### Modified files

| 文件 | 修改内容 |
|------|----------|
| `server/package.json` | 新增 `@elastic/elasticsearch` 依赖 |
| `server/src/index.ts` | `start()` 接入 `initEsClient()` + `warmupEmbedding()`(失败不阻断) |
| `.gitignore` | 忽略 `server/data/es-data` 等本地数据(若 docker volume 落在项目内) |

---

## Task 1: 依赖安装 + 环境变量

**Files:**
- Modify: `server/package.json`
- Modify: `.gitignore`(若需要)

**Steps:**
- [x] 在 `server/` 安装依赖:`npm install @elastic/elasticsearch`(已装 v9.4.3)
- [x] 确认项目环境变量加载方式:无 dotenv,走 `process.env` 直读(与 `ANTHROPIC_AUTH_TOKEN` 同模式),不新增 dotenv
- [x] 整理 P1 用到的环境变量清单(先不入代码,Task 3/4 再读):
  - `EMBEDDING_AND_RERANK_API_KEY`(必需)
  - `EMBEDDING_BASE_URL`(默认 `https://api.siliconflow.cn/v1`)
  - `EMBED_MODEL`(默认 `BAAI/bge-m3`)、`RERANK_MODEL`(默认 `BAAI/bge-reranker-v2-m3`)
  - `ES_URL`(默认 `http://localhost:9200`)、`ES_USER`/`ES_PASSWORD`(可选)
  - `RAG_INDEX`(默认 `rag_index`)
  - `EMBED_BATCH_SIZE`(默认 16)、`EMBED_CONCURRENCY`(默认 3)
- [x] `.gitignore` 确认:`.env` 与 `server/data/` 已忽略,ES 用 docker named volume 不落项目内,无需改

**Test cases:**
- [x] `@elastic/elasticsearch@^9.4.3` 出现在 `server/package.json` dependencies
- [x] `npm ls @elastic/elasticsearch` 无缺失

---

## Task 2: docker-compose ES + IK 镜像

**Files:**
- Create: `docker-compose.yml`(项目根)
- Create: `server/docker/elasticsearch.Dockerfile`

**Steps:**
- [x] 编写 `server/docker/elasticsearch.Dockerfile`:
  ```dockerfile
  FROM docker.elastic.co/elasticsearch/elasticsearch:8.14.0
  RUN bin/elasticsearch-plugin install --batch \
    https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.14.0/elasticsearch-analysis-ik-8.14.0.zip
  ```
- [x] 编写 `docker-compose.yml`(实际含 healthcheck，比计划多了健康检查):
  ```yaml
  services:
    elasticsearch:
      build:
        context: ./server/docker
        dockerfile: elasticsearch.Dockerfile
      environment:
        - discovery.type=single-node
        - xpack.security.enabled=false
        - ES_JAVA_OPTS=-Xms4g -Xmx4g
      ports:
        - "9200:9200"
      volumes:
        - es-data:/usr/share/elasticsearch/data
  volumes:
    es-data:
  ```
- [ ] `docker compose up -d --build` 启动,等待 ES 健康
- [ ] 验证 ES 可用:`curl http://localhost:9200` 返回集群信息
- [ ] 验证 IK 已安装:`curl "http://localhost:9200/_analyze" -H "Content-Type:application/json" -d '{"analyzer":"ik_max_word","text":"违约金条款"}'` 返回中文分词结果

**Test cases(手动验收):**
- [ ] `curl http://localhost:9200` 返回 `"number" : "8.14.0"`
- [ ] IK analyze 接口对"违约金条款"分出"违约金/条款"等词(非逐字)
- [ ] ES 容器内存稳定在 ~4G 堆,不持续上涨

---

## Task 3: ES 客户端 + index mapping 初始化

**Files:**
- Create: `server/src/services/es-client.ts`
- Create: `test/server/services/es-client.test.ts`

**Steps:**
- [x] 实现 `buildRagIndexMapping()` 纯函数，返回 spec 中定义的 mapping(settings 1 分片 0 副本 + 字段化元数据 + dense_vector dims=1024 + IK analyzer)
- [x] 实现 `initEsClient(): Promise<void>`：
  - 读取 `ES_URL`/`ES_USER`/`ES_PASSWORD` 创建 `Client` 实例
  - `client.info()` 连通性检查失败时 `console.warn` 并 return(不抛错，不阻断启动)
  - 调 `ensureRagIndex`：检查 `RAG_INDEX` 是否存在；不存在则 `indices.create` 用 `buildRagIndexMapping()` 创建
  - 已存在则跳过(不重建，遵守"禁止删库")
- [x] 实现 `getEsClient(): Client`(未初始化抛错)
- [x] 实现 `checkDiskWatermark(client): Promise<{ freeGb: number; warn: boolean }>`：查 `cluster.stats()` 取 `nodes.fs.free_in_bytes`，剩余 < `ES_DISK_WARN_GB`(默认 10)时 warn=true
- [x] 抽出 `ensureRagIndex`/`checkDiskWatermark` 接受 `EsClientLike` 鸭子类型参数，纯逻辑可单测

**Test cases:**
- [x] `buildRagIndexMapping()` 返回的 `settings.number_of_shards === 1`、`number_of_replicas === 0`
- [x] mapping 含 `content`(text + ik_max_word)、`content_vector`(dense_vector + dims 1024 + cosine)、`user_id`/`doc_id`/`file_name`/`file_path`/`page_number`/`doc_type`/`uploaded_at`/`tags`/`chunk_hash`/`chunk_index`/`source_type`/`source_id`/`created_at` 全部字段化
- [x] `metadata` 未出现为 `object` 类型(确认元数据是独立字段而非塞进 object)
- [x] `ensureRagIndex` index 不存在时调 create(带 mapping)、已存在不重建、v8 `{body}` 兼容
- [x] `checkDiskWatermark` 阈值上下与缺字段行为
- [~] `initEsClient` 单测改集成 skip：v9 `Client` 构造涉及网络/重试，`vi.mock` 不稳定(实测超时)；核心建表逻辑由 `ensureRagIndex` 覆盖，"ES 不可用不阻断"走集成验证
- [x] 集成测试 `describe.skip`：ES 未启动时 `initEsClient` 不抛错、`getEsClient` 抛错

---

## Task 4: embedding 客户端 - embedTexts / embedQuery

**Files:**
- Create: `server/src/services/embedding-client.ts`
- Create: `test/server/services/embedding-client.test.ts`

**Steps:**
- [ ] 定义常量:`SF_BASE_URL`/`SF_API_KEY`/`EMBED_MODEL`/`RERANK_MODEL`/`EMBED_DIMS=1024`/`EMBED_MAX_TOKENS=8000`/`EMBED_BATCH_SIZE=16`/`EMBED_CONCURRENCY=3`(均从 env 读,带默认)
- [ ] 实现 `estimateTokens(text: string): number`:粗估(token ≈ 字符数/1.5,中文偏保守);精确版 P2 再换 tiktoken
- [ ] 实现 `embedTexts(texts: string[]): Promise<Float32Array[]>`:
  - 调用前逐条 `estimateTokens` 校验,超 `EMBED_MAX_TOKENS` 抛错(带文本前 100 字便于定位)
  - 按 `EMBED_BATCH_SIZE` 切分批次
  - 用信号量(`p-limit` 风格手写 Promise 队列,不引入新依赖)控制并发为 `EMBED_CONCURRENCY`
  - 单批 `POST /v1/embeddings`(body: `{ model, input, encoding_format: 'float' }`,header: `Authorization: Bearer ${SF_API_KEY}`)
  - 429 时指数退避重试(1s -> 2s -> 4s,最多 3 次),仍失败抛错
  - 合并所有批次结果,每条转 `Float32Array`
- [ ] 实现 `embedQuery(text: string): Promise<Float32Array>`(语法糖,调 `embedTexts([text])` 取首条)
- [ ] 测试(mock `globalThis.fetch`)

**Test cases:**
- [ ] `embedTexts(["a","b"])` 调用 `/v1/embeddings`,header 含 `Authorization: Bearer <key>`,body.model 为 `BAAI/bge-m3`、`encoding_format: 'float'`
- [ ] 返回 `Float32Array[]`,每条长度 1024
- [ ] 3 条文本 + batch_size=2 -> fetch 被调 2 次(分批)
- [ ] 单条超 `EMBED_MAX_TOKENS` -> 抛错且不调用 fetch
- [ ] 并发控制:batch_size=1 + 5 条文本 + concurrency=2 -> 任意时刻最多 2 个 in-flight(vi.fn 调用次序验证)
- [ ] 429 首次 + 200 第二次 -> 重试成功,返回结果
- [ ] 429 连续 3 次 -> 抛错
- [ ] fetch 网络异常(reject)-> 抛错
- [ ] `embedQuery("x")` 返回单条 Float32Array(1024)

---

## Task 5: rerank 客户端

**Files:**
- Modify: `server/src/services/embedding-client.ts`(同文件续)
- Modify: `test/server/services/embedding-client.test.ts`

**Steps:**
- [ ] 定义 `RerankHit` 接口:`{ index: number; score: number }`
- [ ] 实现 `rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>`:
  - `POST /v1/rerank`(body: `{ model, query, documents, top_n: topN, return_documents: false }`)
  - 解析 `results` 数组,映射为 `{ index, score }`(relevance_score -> score)
  - 按 score 降序
  - **失败降级**:API 报错/解析失败时,返回原序前 topN:`documents.slice(0, topN).map((_, i) => ({ index: i, score: 0 }))`(不抛错,不阻塞检索)
- [ ] 测试(mock fetch,含降级场景)

**Test cases:**
- [ ] `rerank("q", ["d1","d2"], 2)` 调用 `/v1/rerank`,body 含 `top_n: 2`、`return_documents: false`
- [ ] 正常返回按 score 降序排序的 `RerankHit[]`
- [ ] relevance_score 字段映射为 score
- [ ] fetch 报 500 -> 降级返回原序前 topN(`[{index:0,score:0},{index:1,score:0}]`),不抛错
- [ ] fetch reject(网络错误)-> 降级返回原序前 topN,不抛错
- [ ] 返回 JSON 缺 `results` 字段 -> 降级返回原序前 topN
- [ ] documents 数量 < topN 时降级返回全部(不越界)

---

## Task 6: 启动流程接入 + 预热

**Files:**
- Modify: `server/src/index.ts`

**Steps:**
- [ ] 在 `start()` 的 MCP 初始化后、`app.listen` 前插入:
  ```typescript
  try {
    await initEsClient()
    await warmupEmbedding()
  } catch (err) {
    console.warn('[RAG] init failed, RAG degraded:', err instanceof Error ? err.message : String(err))
  }
  ```
- [ ] 实现 `warmupEmbedding(): Promise<void>`:调一次 `embedQuery('预热')`,失败只 warn(避免首查冷启动;可选,失败不阻断)
- [ ] `SIGINT`/`SIGTERM` 关闭时,若 ES client 有 `close()` 则调用
- [ ] 验证:无 `EMBEDDING_AND_RERANK_API_KEY` 或 ES 未起时,服务仍能正常 `listen`

**Test cases:**
- [ ] 集成测试 `describe.skip`:`initEsClient` 失败时 `app.listen` 仍被调用(服务不挂)
- [ ] 集成测试 `describe.skip`:正常初始化后 `rag_index` 存在且 `warmupEmbedding` 调通

---

## Task 7: P1 集成验收

**Files:**
- Create or modify: `test/server/services/embedding-client.test.ts`(集成部分)
- Create or modify: `test/server/services/es-client.test.ts`(集成部分)

**Steps:**
- [ ] 新增 `describe.skip` 集成测试块(需 ES + 真实 API key 运行,手动执行):
  - `embedTexts(["违约金条款","租房合同"])` 返回 2 条 1024 维向量
  - `rerank("违约金", ["条款一","条款二","条款三"], 2)` 返回 2 条 RerankHit
  - `initEsClient()` 后 `GET /rag_index/_mapping` 含 dense_vector dims=1024 + IK analyzer + 全部元数据字段
- [ ] 手动验收脚本(可放 `server/scripts/rag-p1-smoke.ts`,用 tsx 跑):串联 embed -> 写一条测试文档到 ES -> kNN 查询回查,验证端到端通(P1 不要求,作为冒烟)

**Test cases(手动/集成 skip):**
- [ ] `embedTexts` 真实调用返回 1024 维向量
- [ ] `rerank` 真实调用返回 relevance_score 降序
- [ ] ES `rag_index` 建表字段与 spec mapping 一致
- [ ] IK analyze 对"违约金条款"正确分词

---

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| IK 插件版本与 ES 不匹配导致启动失败 | Dockerfile 锁定 `v8.14.0` zip;构建失败立即修版本号 |
| 16G 笔记本 ES OOM | JVM 堆强制 4G;磁盘水位 < 10G 告警(Task 3 `checkDiskWatermark`) |
| 硅基流动 429 限流 | 分批 16 + 并发 3 + 指数退避 3 次;批量入库场景后续 P2 再压测 |
| 无 API key 时服务启动崩 | `initEsClient`/`warmupEmbedding` try-catch 包裹,失败只 warn(Task 6) |
| ES 客户端单测难(依赖服务) | 纯函数 `buildRagIndexMapping` 单测;ES 交互走 `describe.skip` 集成测试 |
| embedding 维度与 mapping 不一致 | Task 3 mapping dims=1024 + Task 4 EMBED_DIMS=1024 双重锁定,换模型需同步改 |
| `@elastic/elasticsearch` 版本与 ES 8.14 不兼容 | 安装时确认客户端 v8.x;用 `ping()` 验证连通(Task 3 集成测试) |

---

## 当前进度（截至 2026-07-30）

| Task | 状态 | 说明 |
|------|------|------|
| 1 依赖+环境变量 | ✅ | `@elastic/elasticsearch@^8`（v9 与 ES8 不兼容，已降级）；无 dotenv，走 process.env |
| 2 docker ES+IK | ✅ | ES 8.14 已起，IK 已装；rag_index 建表验证通过 |
| 3 es-client | ✅ | 12 单测 + 1 集成 skip；smoke 脚本验证 v8 客户端真实建表成功 |
| 4 embedTexts/embedQuery | ✅ | 含分批/并发/8K 校验/429 退避；getConfig 动态读 env 便于测试 |
| 5 rerank | ✅ | 含 500/reject/缺 results/documents<topN 降级 |
| 6 启动接入 | ✅ | index.ts 接入 initEsClient + warmupEmbedding（失败不阻断） |
| 7 集成验收 | ✅ | rag_index 建表 + IK 中文分词 + embedTexts(1024维) + rerank(score 排序) 全验证 |

embedding-client 合并测试：18 passed（Task 4+5 共用一个测试文件）。

## P1 完成标准(Definition of Done)

- [x] `docker compose up` 能起 ES 8.14 + IK,`_analyze` 中文分词正常（"违约金条款"->违约金/违约/金条/条款）
- [x] `npm run test` 中 `es-client.test.ts` + `embedding-client.test.ts` 纯逻辑测试全绿（12+1skip / 18）
- [x] `initEsClient` 失败时主服务不挂,`app.listen` 正常（try-catch 包裹）
- [x] 集成 smoke 跑通:rag_index 建表 + embedTexts(1024维) + rerank(score 排序) 真实 API 调用
- [x] 未配置 `EMBEDDING_AND_RERANK_API_KEY` 时服务正常启动（warmupEmbedding 跳过 warn）

P1 完成后进入 P2(索引管道:切块 + 去重 + 幂等),届时另写 plan。
