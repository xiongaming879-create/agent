# 项目硬化修正实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复项目 10 处工程化短板,分 3 个 Phase 推进。Phase 1 消除面试负面信号(删死代码 + 修半成品校验 + 记忆召回),Phase 2 补生产化能力(可观测性 + 流式状态隔离 + prompt 外部化),Phase 3 完善度(分支裁剪 + 并发限制 + 前端测试 + 文档)。

**Architecture:** Phase 1 改动集中在 agent.ts 瘦身 + memory-recall 复用 RAG 检索。Phase 2 新增 logger 横切层 + 前端 store 重构。Phase 3 以前端优化和中间件为主。各 Phase 独立可交付,Phase 间无硬依赖。

**Tech Stack:** TypeScript, Vue 3, Pinia, Express, Vitest, ES + embedding(复用现有 RAG)

## Design Decisions (已确认)

1. **Legacy 代码直接删,不保留开关** -- git history 就是 rollback,`USE_LANGCHAIN` 一并移除
2. **validateAnswer 改为 warning 事件** -- 不覆盖内容(Agent 会用内置知识,校验器无法区分),只追加警告条
3. **记忆召回复用 RAG 基础设施** -- embedding + ES 检索 top-3,ES 不可用 fallback 全量
4. **日志轻量自实现** -- 不引入 winston/pino,JSON 输出到 stdout,语义化方法封装
5. **流式状态改 Map 结构** -- `Map<conversationId, Message>`,切换对话互不干扰
6. **Prompt 外部化不做热加载** -- 启动时读一次,改 prompt 重启可接受

## Global Constraints

- 所有改动不破坏现有功能(每个 Task 附回归测试)
- Phase 1 的 3 个 Task 互相独立,可并行实现
- Phase 2 的 logger 埋点不改变现有控制流,只新增日志输出
- 前端改动需同步更新对应测试
- 数据库操作遵守"禁止删库"约束,只 ADD COLUMN / CREATE TABLE IF NOT EXISTS

---

## File Structure

### New files

| 文件 | Phase | 职责 |
|------|-------|------|
| `server/src/services/logger.ts` | P2 | 结构化 JSON 日志,语义化方法 |
| `server/src/prompts/chitchat.txt` | P2 | CHITCHAT 路径 prompt |
| `server/src/prompts/knowledge.txt` | P2 | KNOWLEDGE 路径 prompt |
| `server/src/prompts/calculation.txt` | P2 | CALCULATION 路径 prompt |
| `server/src/prompts/search.txt` | P2 | SEARCH 路径 prompt |
| `server/src/prompts/complex.txt` | P2 | COMPLEX 路径 prompt |
| `server/src/prompts/shared/parallel-rules.txt` | P2 | 并行工具调用规则 |
| `server/src/prompts/shared/rag-constraints.txt` | P2 | RAG 约束 |
| `server/src/middleware/rate-limit.ts` | P3 | per-user token bucket |
| `test/client/components/ChatArea.test.ts` | P3 | ChatArea 组件测试 |
| `test/client/components/MessageBubble.test.ts` | P3 | MessageBubble 组件测试 |
| `test/client/components/ConversationList.test.ts` | P3 | ConversationList 组件测试 |
| `test/client/stores/message-store.test.ts` | P3 | message store SSE + 分支测试 |
| `test/server/services/logger.test.ts` | P2 | logger 单元测试 |
| `test/server/services/memory-recall.test.ts` | P1 | 记忆召回检索测试(已有,需补充向量检索 case) |

### Modified files

| 文件 | Phase | 修改内容 |
|------|-------|----------|
| `server/src/services/agent.ts` | P1 | 删 legacy ~200 行;validateAnswer yield warning |
| `server/src/types.ts` | P1 | AgentEvent 新增 warning 类型 |
| `server/src/services/memory-recall.ts` | P1 | buildMemoryContext 接受 query,向量检索 top-3 |
| `server/src/services/memory-promoter.ts` | P1 | rule 提升时 indexRule |
| `server/src/services/rag-indexer.ts` | P1 | 新增 indexRule() |
| `server/src/services/query-router.ts` | P1/P2 | P1: CALCULATION 移除记忆 + 其他路径传 query;P2: 埋点 + prompt 读取外部文件 |
| `server/src/services/langchain-adapter.ts` | P2 | 工具调用埋点 |
| `client/src/stores/message.ts` | P2/P3 | streamingMessages Map + AbortController + branchSelections 入 store + displayMessages |
| `client/src/components/ChatArea.vue` | P2/P3 | 适配新流式结构 + displayMessages 改 store |
| `client/src/components/MessageBubble.vue` | P1 | 渲染 warning 警告条 |
| `client/src/types/index.ts` | P1 | AgentEvent 新增 warning |
| `server/src/services/llm-caller.ts` | P3 | p-limit 并发控制 |
| `server/src/index.ts` | P3 | 挂载 rate limit 中间件 |
| `SPEC.md` | P3 | sql.js 选型说明 |

---

## Phase 1 (P0 - 面试前必做)

### Task 1: 删除 Legacy 死代码

**Files:**
- Modify: `server/src/services/agent.ts`

**Steps:**
- [x] 删除 `runAgentLegacy` 函数(~100 行)
- [x] 删除 `buildLegacySystemPrompt` 函数(~60 行)
- [x] 删除 `parseReActOutput` 函数
- [x] 删除 `containsToolIntent` 函数
- [x] 删除 `stripMarkdown` 函数(确认仅被 legacy 用)
- [x] 删除 `USE_LANGCHAIN` 常量及其在 `runAgent` 中的分支判断
- [x] `runAgent` 直接调用 `runRoutedAgent`,移除 legacy 分支
- [x] `streamAnthropic` 也删除(`llm-caller.ts` 有独立的 `streamLLM`,不复用);保留 `validateAnswer`、`runAgent` 公共入口
- [x] 确认 `import { getToolByName } from '../tools'` 不再需要(legacy 用,已删)
- [x] 清理 agent.test.ts 中测试已删 legacy 逻辑的过时用例(parseReActOutput/中间轮次/MAX_ITERATIONS/USE_LANGCHAIN/Legacy 模式)
- [x] 运行全量测试确认无回归

**Test cases:**
- [x] `npx vitest run` 全量通过(31 文件,413 passed / 18 skipped)
- [x] `runAgent` 仍正常调用 `runRoutedAgent`
- [x] agent.ts 行数从 ~535 行降到 111 行(超出预期,因 `streamAnthropic` + `createLangchainAgent` + `runAgentLangchain` 也确认为死代码一并删除)

---

### Task 2: validateAnswer 改造为 warning 事件

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/services/agent.ts`
- Modify: `client/src/types/index.ts`
- Modify: `client/src/stores/message.ts`
- Modify: `client/src/components/MessageBubble.vue`

**Steps:**
- [x] `server/src/types.ts`: `AgentEvent` 类型新增 `{ type: 'warning'; content: string }`
- [x] `client/src/types/index.ts`: 同步新增 warning 类型 + `Message` 新增 `warning?: string` 字段
- [x] `agent.ts` 的 `runAgent`: 校验失败时 `yield { type: 'warning', content: result.reason || '回答可能包含未经验证的信息' }`
- [x] `message.ts` 的 `handleSSEEvent`: warning 事件存入 `msg.value.warning`
- [x] `MessageBubble.vue`: 当 `message.warning` 存在时,在气泡底部渲染黄色警告条
- [x] warning 事件在 `done` 之前 yield(前端 done 时 stopTypewriter,warning 已存入 message)
- [x] 测试:新增 `test/server/services/agent-warning.test.ts`(5 个用例)

**Test cases:**
- [x] validateAnswer 返回 `{ valid: false, reason: 'xxx' }` -> yield warning 事件,content 为 reason
- [x] validateAnswer 返回 `{ valid: true }` -> 不 yield warning
- [x] validateAnswer API 失败(返回 valid: true) -> 不 yield warning
- [x] warning 事件在 done 之前 yield
- [x] 无 observation 时不触发校验,不 yield warning
- [ ] 前端 MessageBubble 渲染 warning 警告条(DOM 断言) -- 延后至 Task 9 前端测试补全

---

### Task 3: 记忆召回改为向量检索

**Files:**
- Modify: `server/src/services/memory-recall.ts`
- Modify: `server/src/services/memory-promoter.ts`
- Modify: `server/src/services/rag-indexer.ts`
- Modify: `server/src/services/query-router.ts` (调用处传 query + CALCULATION 移除记忆)
- Modify: `test/server/services/memory-recall.test.ts`

**Steps:**
- [x] `rag-indexer.ts` 的 `indexRule` -- **已存在**(之前已实现),复用 `indexDocument` 写入 ES,`source_type: 'rule'`
- [x] `memory-promoter.ts` 调用 `indexRule` -- **已存在**(之前已实现),candidate 提升时 fire-and-forget 写入 ES
- [x] `memory-db.ts` 新增 `getRulesByIds` + `getCandidatesByIds` -- 向量检索后按 sourceId 回查 DB 获取 type
- [x] `memory-recall.ts` 重构 `buildMemoryContext` 为 `async (userId?, query?) => Promise<string>`:
  - **rules 全量注入**(已提升的长期记忆是全局上下文,与任何 query 都可能相关,如"用户住在深圳"对天气查询有用)
  - **candidates 走向量检索** top-3(未提升的偏好按 query 相关性检索,只注入 user_preference 类型)
  - ES/embedding 不可用: candidates fallback 全量(现有逻辑)
  - 无 query 或无 userId: candidates fallback 全量(向后兼容)
- [x] `query-router.ts` 路径调整:
  - 新增 `getLastUserQuery(messages)` helper
  - CHITCHAT/KNOWLEDGE/SEARCH/COMPLEX: `await buildMemoryContext(options.userId, query)` + prompt 用 `${memoryContext}`
  - CALCULATION: **移除** `buildMemoryContext` 调用
- [ ] 一次性补索引脚本: 遍历现有 rules 调用 `indexRule` 写入 ES -- 延后(rules 已全量注入,不依赖 ES 索引)
- [x] 测试:适配现有测试为 async + 新增 `memory-recall-vector.test.ts`(8 个用例)

**设计修正记录:**
- 原方案:rules + candidates 都走向量检索
- 修正原因:实测发现"今天天气怎么样"与"用户住在深圳坂田"语义不相似,向量检索匹配不到。已提升的 rules 是全局上下文(姓名/居住地/职业/爱好),与任何 query 都可能相关,不应靠语义相似度决定是否注入
- 修正后:rules 全量注入(查 SQLite,不依赖 ES),只有 candidates 走向量检索
- 排查过程:确认 ES 数据正确(之前 curl + Python 管道在 Windows 下的编码假象),BM25/kNN 均正常工作,问题是语义相似度不足

**Test cases:**
- [x] rules 全量注入,不走向量检索(即使有 query + userId)
- [x] candidates 走向量检索,只注入 user_preference 类型(fact/lesson 被 DB 过滤)
- [x] candidates 按 ES score 排序
- [x] ES 不可用 -> candidates fallback 全量注入,不报错
- [x] 无 query / 无 userId -> candidates fallback 全量,不调 hybridSearch
- [x] 向量检索无 candidate 命中 -> rules 仍全量注入
- [x] rules + candidates 同时注入时保持两节结构
- [x] `indexRule` 写入 ES -- 已有测试 `rag-indexer.test.ts` 覆盖
- [x] candidate 提升触发 `indexRule` -- 已有测试 `memory-promoter.test.ts` 覆盖
- [ ] CALCULATION 路径 prompt 不含记忆 / CHITCHAT 路径含记忆 -- 集成测试延后至 Task 9

---

## Phase 2 (P1 - 面试加分)

### Task 4: 结构化日志模块

**Files:**
- Create: `server/src/services/logger.ts`
- Create: `test/server/services/logger.test.ts`
- Modify: `server/src/services/query-router.ts` (埋点)
- Modify: `server/src/services/langchain-adapter.ts` (埋点)
- Modify: `server/src/services/agent.ts` (埋点)

**Steps:**
- [x] 新建 `logger.ts`:
  ```typescript
  interface LogEntry {
    timestamp: string
    level: 'info' | 'warn' | 'error'
    event: string
    conversationId?: string
    userId?: string
    [key: string]: unknown
  }
  function emit(entry: LogEntry): void {
    console.log(JSON.stringify(entry))
  }
  // 语义化方法
  export function logQueryClassified(params: { conversationId, userId, category, ruleMatched, durationMs })
  export function logToolCall(params: { conversationId, userId, step, toolName, inputPreview, outputLength, durationMs, success })
  export function logStuckDetected(params: { conversationId, reason, observationCount })
  export function logSearchLimitHit(params: { conversationId, toolName, callCount, limit })
  export function logFactCheck(params: { conversationId, valid, reason? })
  export function logAgentDone(params: { conversationId, totalSteps, totalDurationMs, hasContent })
  export function logAgentError(params: { conversationId, message, stack? })
  ```
- [x] `query-router.ts` `runRoutedAgent`: 分类后调 `logQueryClassified`(medium 路径重构为先算 `classifyByRules` 拿 `ruleMatched` 再 LLM 兜底,行为不变)
- [x] `langchain-adapter.ts`:
  - 工具执行后调 `logToolCall`(toolName, inputPreview, outputLength, durationMs, success)
  - `detectStuckPattern` 触发时调 `logStuckDetected`
  - `checkSearchEffectiveness` 触发时调 `logSearchLimitHit`
  - 循环结束调 `logAgentDone`
  - catch 块调 `logAgentError`(替换原 console.error)
- [x] `agent.ts` `validateAnswer` 后调 `logFactCheck`(替换原 console.warn)
- [x] `AgentOptions`/`AgentRunOptions` 新增 `conversationId?`,由 `routes/message.ts` 传入,日志可关联到对话
- [x] 测试

**Test cases:**
- [x] `logQueryClassified` 输出 JSON 含 event='query_classified', category 字段
- [x] `logToolCall` 输出含 toolName, durationMs, success
- [x] `logAgentError` level='error'
- [x] 各埋点不改变现有控制流(只新增日志输出;全量 34 文件 436 passed / 18 skipped;基线 tsc 26 个既有报错无新增)
- [x] logger.test.ts 共 10 个用例(含 level 映射、可选字段不写入、单行 JSON 可解析)

---

### Task 5: 前端流式状态隔离

**Files:**
- Modify: `client/src/stores/message.ts`
- Modify: `client/src/components/ChatArea.vue`
- Modify: `client/src/types/index.ts` (如有需要)

**Steps:**
- [x] `message.ts`:
  - `streamingMessage: ref<Message | null>` 改为 `streamingMessages: ref<Map<string, Message>>(new Map())`
  - 新增 `getStreamingMessage(convId): Message | null` getter
  - `sendMessage` / `regenerateMessage` 中用 `streamingMessages.value.set(convId, msg)` 替换赋值
  - SSE 事件处理改为操作 `streamingMessages.value.get(convId)`
  - 新增 `abortControllers: Map<string, AbortController>`
  - `sendMessage` 创建 AbortController,传入 `authFetch` 的 signal
  - 新增 `abortStreaming(convId)`: abort + 清理 streamingMessages
  - `branchSelections` 从 ChatArea 移入 store:`ref<Record<string, Record<string, number>>>({})`(convId -> parentKey -> index)
  - 新增 `clearBranchSelections(convId)`: 切换对话时清理(可选,看是否需要跨对话保留)
  - 补充实现:typewriter 缓冲/定时器也按 conversationId 隔离(原全局单 buffer);`isStreaming` 改为 computed(任一对话流式);新增 `isConversationStreaming(convId)` 供输入框禁用;abort 时跳过 fetchMessages(切回时由 watch 拉取)
- [x] `ChatArea.vue`:
  - `streamingMessage` 改为 `computed(() => msgStore.getStreamingMessage(convStore.activeId))`
  - `branchSelections` 改为读 store
  - watch `convStore.activeId` 变化时调 `msgStore.abortStreaming(oldId)`(需要拿到 oldId)
  - `handleSwitchBranch` 调用 store 方法
- [x] 测试(新建 `test/client/stores/message-store.test.ts`,真实 Pinia store + mock authFetch + 可控 ReadableStream;根 package.json 需补 devDeps: pinia + vue,vitest.config.ts 加 `resolve.dedupe` 避免双实例)

**Test cases:**
- [x] 两个对话同时流式输出,切换对话互不干扰
- [x] 切换对话时旧对话 SSE 被 abort(不再追加内容;abort 不计为错误)
- [x] branchSelections 切换对话后保留(或按设计清理) -- 按对话隔离后保留,另有 clearBranchSelections 可选清理
- [x] sendMessage 期间切换对话 -> 旧请求 abort,新对话正常

---

### Task 6: Prompt 外部化

**Files:**
- Create: `server/src/prompts/*.txt` (7 个文件)
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [x] 将 `query-router.ts` 中 5 个路径的 prompt 模板抽到 txt 文件
- [x] 共享部分(parallel-rules / rag-constraints)抽到 `shared/` 子目录
- [x] 新建 `server/src/services/prompt-loader.ts`:
  ```typescript
  const cache = new Map<string, string>()
  export function loadPrompt(name: string): string {
    if (!cache.has(name)) {
      const path = new URL(`../prompts/${name}.txt`, import.meta.url)
      cache.set(name, readFileSync(fileURLToPath(path), 'utf-8'))
    }
    return cache.get(name)!
  }
  export function renderPrompt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
  }
  ```
- [x] `query-router.ts` 各路径函数改为:
  ```typescript
  const template = loadPrompt('search')
  const prompt = renderPrompt(template, {
    dateContext: buildDateContext(),
    knowledgeContext: buildKnowledgeContext(),
    toolList: buildToolListFromLcTools(filteredTools),
    systemPrompt: options.systemPrompt || '',
    memoryContext: await buildMemoryContext(options.userId, query),
    parallelRules: loadPrompt('shared/parallel-rules'),
    ragConstraints: loadPrompt('shared/rag-constraints'),
  })
  ```
  > systemPrompt 渲染为 `\n${options.systemPrompt}` 或 '' 以保持与原模板字符串完全一致的输出
- [x] 测试

**Test cases:**
- [x] prompt 文件存在且非空
- [x] `renderPrompt('{{name}}', { name: 'test' })` 返回 'test'
- [x] 缺失变量替换为空字符串
- [x] 各路径渲染后的 prompt 包含工具列表和日期上下文
- [x] 启动时 prompt 加载成功(文件路径正确)

> 完成：`test/server/services/prompt-loader.test.ts` 14 个用例全部通过（含占位符存在性、缓存、路径渲染断言）；全套 36 files / 458 passed / 18 skipped；server tsc 维持 26 个基线错误未新增。PARALLEL_TOOL_RULES 导出与 RAG_PROMPT_CONSTRAINTS 常量已删除，仅保留 FALLBACK_SIGNAL（用于运行时输出检测）

---

## Phase 3 (P2 - 有时间再做)

### Task 7: displayMessages 分支裁剪

**Files:**
- Modify: `client/src/stores/message.ts`
- Modify: `client/src/components/ChatArea.vue`

**Steps:**
- [ ] `message.ts` 新增 `activeLeafId: ref<string | null>(null)`
- [ ] `message.ts` 新增 `displayMessages: computed`:
  - 基于 `activeLeafId` 或最后一条消息
  - 调用 `getActiveBranch(leafId)` 返回路径上的消息
  - branchSelections 决定 each parent 下选哪个 child
- [ ] `ChatArea.vue` 的 `displayMessages` 改为读 store
- [ ] `getSiblingInfo` 逻辑移入 store 或保留在组件但基于 displayMessages 计算
- [ ] 测试

**Test cases:**
- [ ] 有分支时只渲染激活路径上的消息
- [ ] 切换分支 -> displayMessages 更新
- [ ] 无分支时渲染全部消息(兼容)

---

### Task 8: 并发与速率限制

**Files:**
- Create: `server/src/middleware/rate-limit.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/services/llm-caller.ts`

**Steps:**
- [ ] `rate-limit.ts` 实现 per-user token bucket:
  ```typescript
  export function perUserRateLimit(options: { windowMs: number; max: number }) {
    const buckets = new Map<string, { count: number; resetAt: number }>()
    return (req, res, next) => {
      const userId = req.user?.id || 'anonymous'
      // ... token bucket 逻辑
      // 超限返回 429
    }
  }
  ```
- [ ] `index.ts` 在 API 路由前挂载 `perUserRateLimit({ windowMs: 60000, max: 20 })`
- [ ] `llm-caller.ts` 引入 `p-limit`:
  ```typescript
  import pLimit from 'p-limit'
  const llmLimit = pLimit(5) // 全局最多 5 个并发 LLM 请求
  export async function callLLM(...) { return llmLimit(() => /* existing */) }
  ```
- [ ] 测试

**Test cases:**
- [ ] 同一用户 1 分钟内第 21 次请求返回 429
- [ ] 不同用户互不影响
- [ ] LLM 并发超过 5 时第 6 个请求排队等待
- [ ] 窗口重置后计数清零

---

### Task 9: 前端测试补全

**Files:**
- Create: `test/client/components/ChatArea.test.ts`
- Create: `test/client/components/MessageBubble.test.ts`
- Create: `test/client/components/ConversationList.test.ts`
- Create: `test/client/stores/message-store.test.ts`

**Steps:**
- [ ] `ChatArea.test.ts`:
  - 渲染默认空状态(无活跃对话)
  - 有活跃对话时渲染消息列表
  - handleSend 调用 msgStore.sendMessage
  - 切换对话触发 fetchMessages
  - System Prompt 弹窗打开/保存
- [ ] `MessageBubble.test.ts`:
  - user/assistant 气泡样式不同
  - 思考过程默认折叠,点击展开
  - 复制按钮点击后文案变化
  - warning 警告条渲染(Task 2 新增)
  - 分支导航器显示兄弟节点数
- [ ] `ConversationList.test.ts`:
  - 渲染对话列表
  - 点击对话切换 activeId
  - 删除按钮触发确认弹窗
  - 确认删除调用 store.delete
  - 右键菜单显示导出选项
- [ ] `message-store.test.ts`:
  - handleSSEEvent 处理各事件类型(thought/action/observation/content_delta/warning/done)
  - sendMessage 流程(mock fetch + ReadableStream)
  - getActiveBranch 正确返回路径
  - getSiblings 正确返回兄弟节点
  - 流式状态隔离(Task 5 新增)

**Test cases:**
- [ ] 各测试文件能独立运行
- [ ] 覆盖核心交互路径
- [ ] 前端测试文件总数 >= 12

---

### Task 10: sql.js 架构决策文档化

**Files:**
- Modify: `SPEC.md`

**Steps:**
- [ ] SPEC.md 设计决策表新增一行:
  ```
  | 16 | 数据库引擎选型 | sql.js (WASM SQLite) | 学习项目零配置选型;生产环境应换 PostgreSQL + 连接池(如 pg + pg-pool),支持多实例并发 |
  ```
- [ ] SPEC.md 数据库段落补充说明:
  - sql.js 为单进程内存数据库,适合开发/学习
  - 生产环境限制:无法多实例、无连接池、性能受限于单进程
  - 迁移路径:schema 兼容 PostgreSQL,CRUD 层抽象后可平替
- [ ] README.md(如有)加架构说明段落

**Test cases:**
- [ ] SPEC.md 包含 sql.js 生产替代方案说明
- [ ] 面试时能清晰讲述"为什么用 sql.js + 生产怎么换"

---

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| 删 legacy 代码后遗漏引用导致编译失败 | 删后跑 `rtk tsc` + 全量测试;git history 可恢复 |
| validateAnswer 增加延迟(多一次 LLM 调用) | 已有延迟(现有代码就调了),只新增 yield warning,无额外 LLM 调用 |
| 记忆向量检索 ES 不可用时全量 fallback 导致 prompt 膨胀 | top-3 限制 + fallback 时截断(最多 10 条);日志告警 |
| 前端 store 重构引入新 bug | Task 5 配套测试;渐进式迁移(先加 Map 结构,旧 ref 保留兼容) |
| prompt 外部化后模板变量缺失 | renderPrompt 缺失变量替换为空 + 启动时校验关键变量存在 |
| rate limit 误杀正常用户 | 窗口 60s / 20 次对聊天场景宽松;429 响应带 Retry-After |
| 记忆补索引脚本需要手动执行 | 文档说明;脚本幂等(重复执行不报错) |

---

## 执行建议

**面试前最小集(1-2 天)**: Task 1 + Task 2 + Task 3
- 这三个消除最明显的负面信号,且改动独立、风险低

**面试加分集(3-5 天)**: + Task 4 + Task 5 + Task 6
- 可观测性和状态隔离是面试高频追问点

**时间充裕(3-5 天)**: + Task 7 ~ Task 10
- 完善度,不紧急但提升整体质量
