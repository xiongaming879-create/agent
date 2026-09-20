# 混合架构设计文档：Reactive 分类路由 + COMPLEX 内部 Plan-and-Execute

> 现状基线：5 类分类路由（query-router）→ 各路径 `createReactAgent`
> 演进目标：COMPLEX 路径内部二级分流，引入 Plan-and-Execute（Planner/Executor/Evaluator/Synthesizer）

---

## 1. 背景与动机

### 现状（2026-09 实际代码）

当前 Agent 采用 **分类路由 + ReAct 单循环** 结构：

```
用户 query
    │
    ▼
┌──────────────┐  classifyQuery(): 规则正则优先 + LLM 兜底 + complexity 覆盖
│ query-router │  输出 QueryCategory: CHITCHAT | KNOWLEDGE | CALCULATION | SEARCH | COMPLEX
└──────┬───────┘
       │
       ▼ 按类别分发（runRoutedAgent）
┌────────┬─────────┬──────────┬────────┬──────────┐
│CHITCHAT│KNOWLEDGE│CALCULATION│ SEARCH │ COMPLEX  │
│ 闲聊   │ 内置知识 │ 计算器    │ 联网搜索│ 强模型+全工具│
│轻模型  │ 轻模型   │ 轻模型    │ 轻模型  │ 强模型    │
│无工具  │ 无工具   │ 1个工具   │ 搜索工具│ 全部工具  │
└────────┴─────────┴──────────┴────────┴──────────┘
        每条路径内部 = createReactAgent (ReAct 循环) + langchainAgentRunner
```

关键事实：
- **路由层**：`server/src/services/query-router.ts` 实现 5 类分发，`classifyByRules`（正则）优先、`classifyByLLM` 兜底、`complexity` 参数（fast/medium/deep）覆盖分类。
- **执行层**：`server/src/services/langchain-adapter.ts` 的 `langchainAgentRunner` 消费 `createReactAgent` 的 stream，负责 SSE 事件发射、卡死检测、搜索停止检测、结果综合。
- **工具层**：内置工具 + MCP 动态注册，按类别白名单过滤（`filterTools`）；高危文件操作有对话内确认机制。
- **RAG**：ElasticSearch（`es-client.ts`，`rag_index` 索引 + `dense_vector` 1024 维 + IK 分词）+ `knowledge_search` 工具，ES 未启动时降级。
- **上下文记忆**：`memory-extractor` / `memory-promoter` / `memory-recall` 三段式。

### 问题：COMPLEX 路径的能力上限

COMPLEX 是深度兜底路径（强模型 + 全工具 + ReAct），但对**真正的多步问题**（多条件对比分析、多阶段方案制定、需要"规划→执行→验证"闭环的任务），纯 ReAct 单循环存在固有弱点：

| 弱点 | 表现 |
|------|------|
| 无全局计划 | 每步临时决策，容易在工具调用中"打转"，忘记最初目标 |
| 上下文膨胀 | 多步推理的历史全部堆积在上下文中，token 消耗高 |
| 不可提前终止 | 无法在"信息已足够"时显式跳过剩余推理 |
| 计划不可调整 | 发现方向错了只能靠 agent 自己"感觉"回头，无显式 replan 机制 |

### 目标

在不改动路由层的前提下，**升级 COMPLEX 路径内部实现**，实现"二级分流"：

| 能力 | 说明 |
|------|------|
| COMPLEX 二级分流 | 轻量判断 → 简单复杂走 ReAct（现状），真正多步走 Plan-and-Execute |
| Plan-and-Execute | Planner 拆解 → Executor 分阶段执行（支持并行/串行）→ Evaluator 质量闸门 → Synthesizer 汇总 |
| 提前终止 | Evaluator 判定 achieved 时跳过剩余阶段，省 token |
| 计划调整 | Evaluator 判定 replan 时回 Planner 重新规划（上限 2 次） |
| 保持兼容 | 路由层、SSE 事件、前端零改动可上线 |

---

## 2. 架构总览（演进后）

```
用户 query
    │
    ▼
┌──────────────┐
│ query-router │  5 类分发（不变）
└──────┬───────┘
       │ COMPLEX
       ▼
┌───────────────────────────────────────────────┐
│ runComplex：二级分流                           │
│                                               │
│  ┌──────────────────┐  简单复杂   ┌─────────┐ │
│  │ 轻量判断(规则/LLM) ├──────────► │ ReAct   │ │  ← 现状路径，改动为零
│  │ query 长度>阈值    │            │ 单循环   │ │
│  │ 含"对比/分析/方案" │            └─────────┘ │
│  │ complexity=deep   │  真正多步               │
│  └────────┬─────────┴──────────┐              │
│           ▼                   ▼              │
│  ┌─────────────────────────────────────────┐ │
│  │ Plan-and-Execute（新增）                 │ │
│  │                                         │ │
│  │  Planner ──► Executor(并行/串行批次)      │ │
│  │    ▲            │                       │ │
│  │    │replan      ▼                       │ │
│  │    └──── Evaluator ──► achieved/stuck    │ │
│  │                     └─► Synthesizer      │ │
│  └─────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

设计原则：
- **路由层不动**。COMPLEX 仍是"强模型 + 全工具"，二级分流是 COMPLEX 的**内部实现策略**，不新增第 6 条路由（避免与 COMPLEX 职责重叠、避免分类边界模糊）。
- **复用现成组件**：`callLLM`/`streamLLM`（llm-caller.ts）、工具注册表（tools/index.ts）、`buildMemoryContext`、`knowledge_search`。
- **渐进式**：PnE 作为独立模块先行，验证后切换默认。

---

## 3. 二级分流设计（COMPLEX 内部）

### 3.1 轻量判断层

在 `runComplex` 入口增加判断，决定走 ReAct 还是 PnE：

| 判据 | 规则 | 说明 |
|------|------|------|
| `complexity` 参数 | `deep` → PnE；`medium`/`fast` → 走其余判据 | 前端可显式指定深度模式 |
| query 长度 | 长度 > 120 字符 → PnE | 长问题倾向多步骤 |
| 规划信号词 | 含「对比/分析/方案/规划/步骤/制定/策划/评估」→ PnE | 与 classifyByRules 的 COMPLEX 词表对齐 |
| LLM 快速分类 | 上述未命中时，用 MODEL_LIGHT 20 token 问一次「该问题是否需要多阶段执行」 | 兜底，避免漏判 |

**安全降级**：PnE 任意环节出错 → 回退 ReAct（现状路径）重试一次，保证体验不劣化。

### 3.2 Plan-and-Execute 模块（新增 `server/src/services/pne/`）

与文档早期"迁移到 StateGraph"的方案不同，PnE 采用**生成器函数编排**（复用现有 SSE 管道），不引入图运行时：

```
server/src/services/pne/
├── planner.ts        # Planner：query → ExecutionPlan JSON
├── executor.ts       # Executor：执行单阶段（工具调用 / 纯推理）+ 拓扑调度（并行/串行）
├── evaluator.ts      # Evaluator：阶段结果 → continue/achieved/replan/stuck
├── synthesizer.ts    # Synthesizer：阶段结果 → 最终答案
└── prompts.ts        # 4 类 prompt 模板
```

**编排逻辑**（`runPneAgent`，AsyncGenerator\<AgentEvent\>）：

```
while replanCount <= MAX_REPLAN:
    plan = await planner(query, stageResults)          # 首次/重规划
    while True:
        ready = findReadyStages(plan.stages, stageResults)  # 拓扑调度
        if not ready: break                            # 全完成 / 依赖死锁
        results = await runBatchParallel(ready)        # 无依赖阶段并发
        stageResults += results
        decision = await evaluator(query, plan, stageResults)
        if decision == 'achieved' or 'stuck': return   # 提前终止
        if decision == 'replan': break                 # 回外层重新规划
    # 全部阶段执行完后做最终评估
return synthesizer(query, stageResults)
```

### 3.3 数据模型

```typescript
interface ExecutionPlan {
  reasoning: string
  stages: Stage[]
}

interface Stage {
  index: number
  goal: string
  strategy: 'tool' | 'reasoning' | 'hybrid'
  toolHint?: string       // strategy='tool'/'hybrid' 时建议的工具名
  toolArgs?: string       // 工具参数（对象参数用 JSON 字符串）
  dependsOn: number[]     // 依赖的阶段 index 列表；[] = 无依赖（可并行）
}

interface StageResult {
  index: number
  goal: string
  outcome: string
}
```

### 3.4 并行/串行调度（依赖拓扑）

- **无依赖阶段（`dependsOn: []`）→ 同一批并行执行**（`Promise.all` / 线程池，IO 密集型 LLM 调用）。
- **有依赖阶段 → 等待依赖完成后串行**。
- 每轮选取"依赖已全部完成"的 stage 作为 ready 批次，天然保证并行只发生在无依赖之间。
- **死锁防护**：若剩余阶段都存在未满足依赖，立即跳出，交由最终评估兜底。

> ⚠️ **前置条件**：并行前必须消除 `langchain-adapter.ts` 的模块级 `pendingToolCalls` Map（见 §7 风险表）。并行阶段并发写共享 Map 会造成请求间串扰。

---

## 4. 无限循环防护

| 机制 | 阈值 | 说明 |
|------|------|------|
| 最大计划阶段数 | 5 | Planner 最多生成 5 个阶段 |
| 最大 replan 次数 | 2 | 超过强制 stuck → Synthesizer 兜底 |
| 单阶段内工具调用轮次 | 3 | Executor 内部 mini-ReAct 上限 |
| 单阶段超时 | 60s | 复用 llm-caller 的 LLM_TIMEOUT_MS |
| 依赖死锁检测 | — | 无 ready 阶段即跳出 |

---

## 5. SSE 事件扩展

现有 `AgentEvent`（`server/src/types.ts`）必须保留（向后兼容，前端 switch-case 静默忽略未知类型），新增以下变体：

```typescript
export type AgentEvent =
  // ===== 现有（不可修改） =====
  | { type: 'thought'; content: string }
  | { type: 'thought_delta'; content: string }
  | { type: 'action'; tool_name: string; content: string; call_id?: string }
  | { type: 'observation'; tool_name?: string; content: string; call_id?: string; duration_ms?: number; success?: boolean }
  | { type: 'content'; content: string }
  | { type: 'content_delta'; content: string }
  | { type: 'warning'; content: string }
  | { type: 'done' }

  // ===== 新增：PnE 路径 =====
  // plan: 计划快照事件。每次阶段状态变化（start/完成/提前终止 skip）时
  // 重发一次完整快照，前端据此渲染 todo list 的实时完成情况。
  | { type: 'plan'; stages: { index: number; goal: string; strategy: string; status: 'pending' | 'running' | 'done' | 'skipped'; dependsOn: number[] }[] }
  | { type: 'stage_start'; index: number; goal: string; strategy: string }
  | { type: 'stage_result'; index: number; outcome: string }
  | { type: 'evaluation'; decision: string; reason: string }
```

**前端兼容性**：现有 `handleSSEEvent` 使用 switch-case，未匹配的事件类型被静默忽略，新事件可随时上线。`plan` 事件的 todo 可视化设计见 §5.1。

### 5.1 PnE 计划可视化（todo list 完成情况）

**需求**：PnE 路由执行时，在聊天页面的"思考过程"区域实时展示计划 todo list 及每个阶段的完成状态。

**方案（A）**：计划快照作为特殊 `thought_step` 存储与渲染，不改 Message 顶层结构、不做数据库迁移。

**渲染效果示意**（嵌入现有思考过程区，黑白主题）：

```
┌─ 执行计划 ─────────────────────┐
│ ☑ 1. 查天气            ✓ 晴 31°C │
│ ☑ 2. 查汇率            ✓ 0.14    │
│ ⏳ 3. 规划行程   (依赖 1,2)      │
│ ○ 4. 汇总预算   (依赖 3)         │
└────────────────────────────────┘
```

**数据流（三处改动，全部向后兼容）**：

```
后端 runPneAgent
  │ 每次阶段状态变化 → 发 plan 事件（完整快照，status 已更新）
  ▼
server/routes/message.ts  processAgentStream
  │ case 'plan'：透传到前端 + 写入 thoughtSteps（type:'plan'）持久化
  ▼  SSE
client/stores/message.ts  handleSSEEvent
  │ case 'plan'：写入 thoughtSteps（type:'plan'）
  ▼
client/utils/thoughtGroup.ts  groupThoughtSteps
  │ type==='plan' → ThoughtItem { kind: 'plan', stages }
  ▼
client/components/ThoughtStep.vue
  │ 新增 v-if="item.kind === 'plan'" 分支 → 渲染 todo list
```

**各文件改动点**：

| 文件 | 改动 |
|------|------|
| `server/src/types.ts` | `AgentEvent` 增加 `plan` 变体；`ThoughtStep.type` 联合类型增加 `'plan'` |
| `server/src/routes/message.ts` | `processAgentStream` 增加 `case 'plan'`：透传 SSE + 写入服务端 `thoughtSteps`（随 `createMessage` 持久化） |
| `client/src/types/index.ts` | 同步 `AgentEvent` 与 `ThoughtStep` 类型 |
| `client/src/stores/message.ts` | `handleSSEEvent` 增加 `case 'plan'`：写入 `thoughtSteps` |
| `client/src/utils/thoughtGroup.ts` | `groupThoughtSteps` 识别 `type==='plan'`，产出 `kind:'plan'` 条目（携带 stages 快照） |
| `client/src/components/ThoughtStep.vue` | 新增 `kind==='plan'` 模板分支：todo list（阶段名 + 状态图标 + 依赖标注） |

**选择方案 A 的理由**：

| 对比 | 方案 A：存 thought_steps（✅ 选定） | 方案 B：Message 顶层加 plan_steps |
|------|----------------------------------|---------------------------------|
| 改动面 | 前后端各加一个 case，无接口变更 | 动 Message 接口 + 数据库迁移 + 序列化 |
| 历史回放 | `thought_steps` 已持久化，刷新后可回放 todo 完成过程 | 需新增持久化字段 |
| 语义 | plan 作为"思考过程的一种"，与 note/round 平级 | 更"正经"但成本高 |

**关键设计点**：
- `plan` 事件发**完整快照**而非增量（每次重发全部 stages + 最新 status），前端覆盖渲染即可，天然容错丢包。
- `status` 四态：`pending`（未开始）/ `running`（执行中）/ `done`（完成）/ `skipped`（提前终止被跳过）。
- 老数据/非 PnE 路由无 `plan` 步骤，`groupThoughtSteps` 和模板分支均不影响现有 note/round 渲染。

---

## 6. RAG（现状说明）

> 早期设计文档规划使用 ChromaDB + BGE-m3，**实际已落地方案为 ElasticSearch**，本文档以代码为准。

### 检索流水线（已实现）

```
用户 query
    │
    ▼
┌─────────────────────────────┐
│  rag-search：混合检索         │
│  ├─ IK 分词关键词检索         │
│  └─ dense_vector 向量检索     │
│  → 合并去重 → Top-K          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  knowledge_search 工具        │
│  检索结果注入 LLM 上下文        │
└─────────────┬───────────────┘
              │
              ▼
         LLM 生成回答
```

### 技术选型（已落地）

| 组件 | 选型 | 说明 |
|------|------|------|
| 检索引擎 | ElasticSearch（`es-client.ts`） | `rag_index` 索引：1 分片 0 副本，`dense_vector` 1024 维 cosine，IK 分词 |
| Embedding | `embedding-client.ts` | 1024 维向量，warmup 启动预热 |
| 分块 | `rag-chunker.ts` | 文档摄入分块 |
| 摄入 | `rag-indexer.ts` + `document-extractor.ts` | 上传 → 解析 → 分块 → 向量化 → 入库 |
| 元数据 | 索引内字段化 | file_name / user_id / doc_id / chunk_index / uploaded_at 等 |
| 降级 | ES 未启动 | knowledge_search 降级，其余功能正常 |

---

## 7. 文件变更清单

### 新增文件（PnE 模块）

```
server/src/services/pne/
├── planner.ts
├── executor.ts
├── evaluator.ts
├── synthesizer.ts
└── prompts.ts
```

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/src/services/query-router.ts` | `runComplex` 入口加二级分流判断；新增 `runPneAgent` 分发 |
| `server/src/services/agent.ts` | 无需改动（入口已透传） |
| `server/src/types.ts` | 新增 plan/stage_start/stage_result/evaluation 事件变体（plan 含 status 字段） |
| `server/src/routes/message.ts` | `processAgentStream` 增加 `case 'plan'`：透传 SSE + 写入 thoughtSteps 持久化（todo 可视化，见 §5.1） |
| `server/src/services/langchain-adapter.ts` | **消除模块级 `pendingToolCalls` Map**（改为调用上下文传入 / 局部收集），PnE 并行前置条件 |
| `client/src/types/index.ts` | 同步新增 AgentEvent 变体（含 plan 的 status 字段） |
| `client/src/stores/message.ts` | `handleSSEEvent` 增加 `case 'plan'`：写入 thoughtSteps（todo 可视化，见 §5.1） |
| `client/src/utils/thoughtGroup.ts` | `groupThoughtSteps` 识别 `type==='plan'` → `kind:'plan'` 条目（todo 可视化，见 §5.1） |
| `client/src/components/ThoughtStep.vue` | 新增 `kind==='plan'` 模板分支：渲染计划 todo list（todo 可视化，见 §5.1） |

### 已知遗留（本期不处理）

| 文件 | 说明 |
|------|------|
| `server/src/services/tool-adapter.ts` | 仍作为内置工具 → `DynamicStructuredTool[]` 的包装层存在，保留 |
| `server/src/types.ts` 的 `Tool` interface | 历史兼容接口，仍被 tools/index.ts 使用，保留 |

---

## 8. 分阶段实施计划

### Phase 1：PnE 独立模块（不改路由）

**目标**：PnE 可作为独立能力调用，行为与 demo 验证一致。

**产出**：
- `pne/` 目录 5 个文件
- 拓扑调度（并行/串行）+ 4 层防护
- SSE 新事件定义

**验证**：单元测试 + 手动调用 `runPneAgent("对比 A 和 B...")`，观察 plan/stage_start/stage_result/evaluation 事件序列。

### Phase 2：COMPLEX 二级分流接入

**目标**：COMPLEX 内部按判据分流，PnE 出错回退 ReAct。

**产出**：
- `runComplex` 轻量判断层
- 回退逻辑（PnE 异常 → ReAct 重试一次）

**验证**：分别用简单/复杂 query 验证走对路径；PnE 路径人为注入错误验证回退。

### Phase 3：消除 pendingToolCalls 串扰 + 并行加固

**目标**：PnE 并行阶段无共享状态污染。

**产出**：
- `pendingToolCalls` 从模块级 Map 改为调用级局部收集
- 并发请求压力测试

**验证**：并发 5 请求，工具调用结果互不串扰。

### Phase 4：前端计划可视化（设计已完成，见 §5.1）

**目标**：plan/stage 事件渲染为 todo list（思考过程区内嵌）。

**产出**：
- `handleSSEEvent` / `groupThoughtSteps` / `ThoughtStep.vue` 三处改动（§5.1 文件表）

**验证**：PnE 路由发起多阶段问题，页面上实时看到计划 todo list 与各阶段完成状态；刷新后历史回放正常。

---

## 9. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 二级分流误判：简单问题被丢进 PnE | 规则优先 + LLM 兜底；PnE 出错回退 ReAct |
| PnE 循环不终止 | 4 层防护：5 阶段上限、2 次 replan 上限、单阶段 3 轮工具上限、依赖死锁检测 |
| PnE 每批 Evaluator 增加 LLM 调用成本 | 仅 `deep`/多步问题走 PnE；Evaluator 用 MODEL_LIGHT + 300 token |
| 并行阶段共享状态串扰 | Phase 3 消除模块级 `pendingToolCalls` Map |
| 前端 SSE 不兼容 | 新事件类型向后兼容，前端静默忽略未知类型 |
| RAG 检索质量差 / ES 未启动 | knowledge_search 降级为 reasoning，其余功能正常 |
| 双执行范式维护成本 | PnE 与 ReAct 共用工具层、SSE 管道、防护组件，差异仅在编排层 |
