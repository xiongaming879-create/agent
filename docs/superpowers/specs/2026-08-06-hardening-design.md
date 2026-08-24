# 项目硬化修正方案设计 (Hardening)

## Problem

项目作为个人 Agent 作品集,功能完整度高,但存在 10 处工程化短板。这些短板分两类:
1. **"半成品"信号** -- 做了一半的功能(如 validateAnswer 只 warn 不拦截),比没做更糟,面试时是负面信号
2. **生产化缺失** -- 可观测性、并发控制、状态隔离等生产 Agent 必备能力缺失

本方案按"面试影响 × 修正成本"分三个 Phase,优先处理高影响低成本项。

---

## Design

### Phase 1 (P0 - 面试前必做): 消除负面信号

#### 1.1 删除 Legacy 死代码

**现状**: `agent.ts` 中 `runAgentLegacy` + `buildLegacySystemPrompt` + `parseReActOutput` + `containsToolIntent` + `stripMarkdown` 约 200 行,`USE_LANGCHAIN` 默认 `true`,legacy 路径已不走。

**方案**: 直接删除。`USE_LANGCHAIN` 开关一并移除,`runAgent` 永远走 LangGraph 路由。`streamAnthropic` 保留(被 `llm-caller.ts` 复用)。

**理由**: 保留死代码是工程洁癖问题。面试官翻代码看到 200 行未使用路径会质疑判断力。"留着 rollback"不成立 -- git history 就是 rollback。

#### 1.2 validateAnswer 改造为 warning 事件

**现状**: `agent.ts:526-531` 后置校验失败只 `console.warn`,不覆盖、不追加、不阻断。花了一次 LLM 调用但无任何用户可见效果。

**方案**: 校验失败时 yield `warning` 事件,前端在回答下方显示警告条(不覆盖内容,让用户自行判断)。

```
Agent 输出回答 -> validateAnswer(回答, observations)
  -> valid: 正常结束
  -> invalid: yield { type: 'warning', content: result.reason }
              -> 前端 MessageBubble 在气泡底部显示黄色警告条:
                 "⚠️ 此回答可能包含未经验证的信息: {reason}"
```

**设计决策**:
- 不覆盖内容: Agent 会用内置知识回答(节假日/常识),校验器无法区分"内置知识"和"编造",覆盖会误杀
- 不静默: 静默等于没做,浪费 LLM 调用
- warning 事件是新增类型,不影响现有 SSE 事件流

**降级**: validateAnswer 本身 API 失败时,不 yield warning(沿用现有 `{ valid: true }` 放行逻辑)。

#### 1.3 记忆召回:rules 全量注入 + candidates 向量检索

**现状**: `memory-recall.ts` 的 `buildMemoryContext` 全量查 DB(`getAllRules` + `getUnpromotedCandidates`),把所有规则和候选塞 prompt。记忆多了 prompt 膨胀,且不相关记忆干扰回答。

**方案**: 两层记忆架构,rules 全量注入,candidates 走向量检索:
- **rules(已提升的长期记忆)**: 全量从 SQLite 查 `getAllRules(userId)`,直接注入 prompt。不走向量检索 -- 已提升的规则是全局上下文(姓名/居住地/职业/爱好),与任何 query 都可能相关,不应靠语义相似度决定是否注入。
- **candidates(未提升的偏好)**: 复用 RAG 基础设施(embedding + ES),按当前 query 向量检索 top-3。只注入 user_preference 类型(fact/lesson 不注入)。ES 不可用时 fallback 全量(从 SQLite 查,截断 10 条)。

**路径策略**: 5 条路径中 CALCULATION 不查记忆(纯计算不需要用户偏好),其余 4 条(CHITCHAT/KNOWLEDGE/SEARCH/COMPLEX)都查:
- CHITCHAT 查记忆:用户偏好(爱好/习惯)在闲聊中有价值,如"我喜欢喝咖啡" -> 闲聊"今天好困"时能关联推荐
- CALCULATION 不查:"根号5加根号9"与用户偏好无关,注入是噪音

**设计修正记录**:
- 原方案:rules + candidates 都走向量检索
- 修正原因:实测发现"今天天气怎么样"与"用户住在深圳坂田"语义不相似,向量检索匹配不到。已提升的 rules 是全局上下文,与任何 query 都可能相关,不应靠语义相似度决定是否注入
- 修正后:rules 全量注入(查 SQLite,不依赖 ES),只有 candidates 走向量检索

**ES 中的 rule 索引**: `indexRule` 在 candidate 提升时仍会写入 ES(source_type='rule'),但当前不用于检索。保留写入是为了未来 rules 量增大后可切换为向量检索,无需重新补索引。

**排查记录**:
- 曾怀疑 ES 中 content 存储乱码,经排查确认是 `curl + python -m json.tool` 在 Windows 下的编码假象
- ES 客户端直读确认数据完全正确(BM25 搜索"深圳"返回 5 条 rule + 5 条 candidate)
- 问题的根因是语义相似度不足,非数据问题

---

### Phase 2 (P1 - 面试加分): 生产化能力

#### 2.1 结构化日志 (可观测性)

**现状**: 全靠 `console.log` / `console.warn`,无结构化日志,无法追踪"某次对话为什么工具调用失败"。

**方案**: 新增 `logger.ts`,结构化 JSON 日志,关键节点埋点。

```typescript
// 日志格式
{
  timestamp: '2026-08-06T10:30:00.000Z',
  level: 'info',
  event: 'tool_call',
  conversationId: 'xxx',
  userId: 'xxx',
  toolName: 'search',
  inputPreview: '2026中秋日期',
  outputLength: 1200,
  durationMs: 340,
  success: true
}
```

**埋点清单**:

| 事件 | 级别 | 字段 |
|------|------|------|
| query_classified | info | category, ruleMatched, durationMs |
| agent_step | info | step, toolName, inputPreview, durationMs |
| tool_result | info/warn | toolName, outputLength, success, durationMs |
| stuck_detected | warn | reason, observationCount |
| search_limit_hit | warn | toolName, callCount, limit |
| fact_check | info/warn | valid, reason |
| agent_done | info | totalSteps, totalDurationMs, hasContent |
| agent_error | error | message, stack |

**实现**: 轻量自实现,不引入 winston/pino(避免依赖膨胀)。`logger.ts` 暴露 `logQueryClassified()` / `logToolCall()` 等语义化方法,内部输出 JSON 到 stdout。

#### 2.2 前端流式状态隔离

**现状**: `streamingMessage` 是全局单一 ref,切换对话时 ChatArea watch 手动清理,有 race condition。`branchSelections` 在 ChatArea 本地,切换对话丢失。

**方案**:
- `streamingMessage` 改为 `Map<conversationId, Message>`,只渲染当前对话的流式消息
- `branchSelections` 移入 message store,按 conversationId 隔离
- 切换对话时用 `AbortController` 取消进行中的 SSE 请求

```typescript
// message store
const streamingMessages = ref<Map<string, Message>>(new Map())
const branchSelections = ref<Record<string, Record<string, number>>>({}) // convId -> parentId -> index
const abortControllers = new Map<string, AbortController>() // convId -> controller

function sendMessage(convId, content, ...) {
  const controller = new AbortController()
  abortControllers.set(convId, controller)
  // fetch signal: controller.signal
  // 切换对话时: abortControllers.get(oldConvId)?.abort()
}
```

#### 2.3 Prompt 外部化

**现状**: `query-router.ts` 里 5 个路径的 prompt 都是模板字符串硬编码,改 prompt 要改代码重启。

**方案**: 抽到 `server/src/prompts/` 目录,按路径分文件。

```
server/src/prompts/
├── chitchat.txt
├── knowledge.txt
├── calculation.txt
├── search.txt
├── complex.txt
└── shared/
    ├── parallel-rules.txt
    └── rag-constraints.txt
```

加载时缓存到内存,启动时读取一次。模板变量用 `{{var}}` 占位,`renderPrompt(template, vars)` 替换。

**设计决策**: 不做热加载(增加复杂度)。启动时读一次,改 prompt 重启服务可接受。

---

### Phase 3 (P2 - 有时间再做): 完善度

#### 3.1 displayMessages 分支裁剪

**现状**: `ChatArea.vue` 的 `displayMessages` 直接返回 `msgStore.messages` 全量,分支逻辑靠 `getSiblingInfo` 每次 render 重算。

**方案**: 基于 leaf 节点 + `getActiveBranch(leafId)` 计算激活路径,只渲染路径上的消息。`branchSelections` 控制 each parent 下选哪个 child 作为路径节点。

```typescript
const displayMessages = computed(() => {
  const leafId = activeLeafId.value || lastMessageId.value
  return msgStore.getActiveBranch(leafId)
})
```

#### 3.2 并发与速率限制

**现状**: 无并发控制,高并发会打爆 LLM API。

**方案**:
- Express 中间件: per-user token bucket(每用户每分钟 N 次请求)
- LLM 调用层: 全局并发上限(同时最多 M 个 LLM 请求),用 `p-limit`

```typescript
// middleware/rate-limit.ts
perUserLimit({ windowMs: 60000, max: 20 }) // 每用户每分钟 20 次

// llm-caller.ts
const limit = pLimit(5) // 全局最多 5 个并发 LLM 请求
async function callLLM(...) { return limit(() => fetch(...)) }
```

#### 3.3 前端测试补全

**现状**: 31 个测试文件,前端仅 6 个,组件交互测试几乎空白。

**方案**: 补关键路径测试,目标前端测试 15+ 个:

| 测试文件 | 覆盖点 |
|----------|--------|
| ChatArea.test.ts | 发送消息、切换对话、流式渲染、System Prompt 编辑 |
| MessageBubble.test.ts | 分支导航、复制按钮、思考过程折叠 |
| ConversationList.test.ts | 删除确认弹窗、置顶、右键菜单 |
| message-store.test.ts | SSE 事件处理、分支切换、流式状态隔离 |
| conversation-store.test.ts | CRUD、活跃切换 |

#### 3.4 sql.js 架构决策文档化

**现状**: sql.js 不适合生产,但 SPEC.md 没说明这是学习项目选型,面试时容易被误解为"不知道生产该用什么"。

**方案**: SPEC.md 设计决策表新增一行,明确"sql.js 为学习项目零配置选型,生产应换 PostgreSQL + 连接池"。README 加架构说明段落。

---

## Acceptance Criteria

### Phase 1
- [ ] `agent.ts` 中无 `runAgentLegacy` / `buildLegacySystemPrompt` / `parseReActOutput` / `containsToolIntent` / `USE_LANGCHAIN` 开关
- [ ] `AgentEvent` 类型新增 `warning` 事件
- [ ] validateAnswer 校验失败时 yield `warning` 事件,前端显示警告条
- [ ] `buildMemoryContext` 接受 `query` 参数,做向量检索 top-3 注入
- [ ] ES 不可用时 `buildMemoryContext` fallback 全量注入
- [ ] rules 提升时写入 ES 索引

### Phase 2
- [x] 新增 `logger.ts`,结构化 JSON 日志输出到 stdout
- [x] 查询分类、工具调用、循环检测、后置校验、Agent 结束 5 类事件埋点（另含 logSearchLimitHit/logAgentError，日志带 conversationId/userId）
- [x] `streamingMessages` 改为 Map,切换对话不互相干扰
- [x] 切换对话时取消进行中的 SSE(AbortController)
- [x] `branchSelections` 移入 message store,按 conversationId 隔离
- [x] prompt 模板抽到 `server/src/prompts/` 目录,代码中无大段模板字符串

> Phase 2 完成（2026-08-17）：Task 4/5/6 全部实现并验收。测试 36 files / 458 passed / 18 skipped；新增 `test/server/services/logger.test.ts`(10)、`test/client/stores/message-store.test.ts`(8)、`test/server/services/prompt-loader.test.ts`(14)

### Phase 3
- [ ] `displayMessages` 只渲染激活分支路径,非路径消息不渲染
- [ ] per-user rate limit 中间件生效
- [ ] LLM 调用全局并发上限生效
- [ ] 前端测试文件数 >= 12,覆盖 ChatArea/MessageBubble/ConversationList/message store
- [ ] SPEC.md 记录 sql.js 选型理由和生产替代方案

---

## Changes by File

### Phase 1

| 文件 | 改动 |
|------|------|
| `server/src/services/agent.ts` | 删除 legacy 代码(~200 行);validateAnswer 失败时 yield warning |
| `server/src/types.ts` | `AgentEvent` 新增 `warning` 类型 |
| `server/src/services/memory-recall.ts` | `buildMemoryContext` 接受 query 参数,向量检索 top-3 |
| `server/src/services/memory-promoter.ts` | rule 提升时调用 `indexRule` 写入 ES |
| `server/src/services/rag-indexer.ts` | 新增 `indexRule(rule)` 方法 |
| `server/src/services/query-router.ts` | CALCULATION 路径移除 `buildMemoryContext` 调用;其他 4 路径传 query 参数 |
| `client/src/components/MessageBubble.vue` | 渲染 warning 事件为黄色警告条 |
| `client/src/stores/message.ts` | handleSSEEvent 处理 warning 事件 |
| `client/src/types/index.ts` | AgentEvent 新增 warning |

### Phase 2

| 文件 | 改动 |
|------|------|
| `server/src/services/logger.ts` | 新增:结构化日志模块 |
| `server/src/services/prompt-loader.ts` | 新增:prompt 模板加载器(loadPrompt 缓存 + renderPrompt 变量替换) |
| `server/src/services/query-router.ts` | 各路径埋点 + prompt 改为读取外部文件 |
| `server/src/services/langchain-adapter.ts` | 工具调用埋点 |
| `server/src/services/agent.ts` | 后置校验埋点 + AgentOptions 新增 conversationId |
| `server/src/routes/message.ts` | agentOptions 透传 conversationId 供日志关联 |
| `server/src/prompts/*.txt` | 新增:外部化 prompt 模板(5 路径 + shared/parallel-rules + shared/rag-constraints) |
| `client/src/stores/message.ts` | streamingMessages 改 Map + AbortController + branchSelections 入 store + per-conv 打字机 |
| `client/src/components/ChatArea.vue` | 适配新的流式状态结构 |
| `vitest.config.ts` | resolve.dedupe ['pinia','vue'] 修复双实例问题(根/client 各自 node_modules) |

### Phase 3

| 文件 | 改动 |
|------|------|
| `client/src/stores/message.ts` | 新增 activeLeafId + displayMessages 计算激活路径 |
| `client/src/components/ChatArea.vue` | displayMessages 改用 store 计算属性 |
| `server/src/middleware/rate-limit.ts` | 新增:per-user token bucket |
| `server/src/index.ts` | 挂载 rate limit 中间件 |
| `server/src/services/llm-caller.ts` | p-limit 并发控制 |
| `test/client/**` | 新增前端测试文件 |
| `SPEC.md` | sql.js 选型说明 |

---

## What This Enables

- **消除面试负面信号**: 删死代码 + 修半成品校验,代码库第一印象干净
- **记忆系统闭环**: 提取 -> 存储 -> **检索召回** -> 注入,补全 RAG 全链路
- **生产可观测**: 结构化日志支撑线上问题排查
- **前端健壮性**: 流式状态隔离消除 race condition
- **Prompt 可维护**: 非代码改动即可调优 prompt

## What This Drops

- Legacy ReAct prompt-driven 实现(已被 LangGraph 替代,git history 可回溯)
- `USE_LANGCHAIN` 环境变量开关(永远为 true,无保留价值)
