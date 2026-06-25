# 混合架构设计文档：Reactive + Deliberative + Agentic RAG

> 迁移方案：LangGraph prebuilt `createReactAgent` → 自定义 `StateGraph`

## 1. 背景与动机

### 现状

当前 Agent 使用 `@langchain/langgraph/prebuilt` 的 `createReactAgent`，本质是一个固定的单循环结构：

```
LLM → (有tool_calls?) → 执行工具 → LLM → ... → END
```

这无法支持：
- **智能路由**：简单问题走快路径，复杂问题走深度推理
- **多阶段计划**：将复杂问题拆解为有序阶段，逐步执行
- **提前终止**：某阶段结果已满足目标时跳过剩余阶段
- **计划调整**：中间结果不理想时重新规划
- **Agentic RAG**：混合检索 + Rerank + 上下文注入

### 目标

构建自定义 LangGraph StateGraph，实现：

| 能力 | 说明 |
|------|------|
| Reactive 路径 | 快速回答 + 简单工具调用，保持现有体验 |
| Deliberative 路径 | 多阶段深度推理，支持计划/执行/评估/汇总 |
| 智能路由 | LLM 自动判断走哪条路径 |
| Agentic RAG | BGE 混合检索 → Rerank 精筛 → 上下文注入 |
| 安全并发 | 消除模块级可变状态 |

---

## 2. 架构总览

```
                        ┌──────────┐
                        │  Router  │  LLM 判断 query 复杂度
                        └────┬─────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
          ┌─────────────┐        ┌──────────────┐
          │  Reactive   │        │ Deliberative │
          │  快速路径    │        │  深度路径     │
          └──────┬──────┘        └──────┬───────┘
                 │                      │
                 │               ┌──────▼───────┐
                 │               │   Planner    │ 拆解为多阶段计划
                 │               └──────┬───────┘
                 │                      │
                 │               ┌──────▼───────┐
                 │               │   Executor   │ 执行单阶段(推理/RAG/工具/混合)
                 │               └──────┬───────┘
                 │                      │
                 │               ┌──────▼───────┐
                 │               │  Evaluator   │ 评估结果，决定下一步
                 │               └──────┬───────┘
                 │                      │
                 │          ┌───────────┼───────────┐
                 │          ▼           ▼           ▼
                 │    continue      replan      achieved/stuck
                 │          │           │           │
                 │          ▼           ▼           ▼
                 │     Executor    Planner    ┌──────────────┐
                 │     (下一阶段)  (重新规划)  │ Synthesizer  │
                 │                          │ 汇总输出报告  │
                 │                          └──────┬───────┘
                 │                                 │
                 ▼                                 ▼
              END                                END
```

---

## 3. Graph State 设计

所有节点共享以下状态（替代模块级变量和局部变量）：

```typescript
const AgentStateAnnotation = Annotation.Root({
  // ===== 核心对话 =====
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  query: Annotation<string>,

  // ===== 路由 =====
  route: Annotation<'reactive' | 'deliberative'>,

  // ===== Deliberative 路径 =====
  plan: Annotation<ExecutionPlan | null>,
  currentStage: Annotation<number>,
  stageResults: Annotation<StageResult[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),
  evaluationDecision: Annotation<'continue' | 'replan' | 'achieved' | 'stuck'>,
  replanCount: Annotation<number>,

  // ===== 工具追踪（替代模块级 pendingToolCalls Map） =====
  pendingToolCalls: Annotation<ToolCallInfo[]>({
    reducer: (_, update) => update,   // 覆盖而非追加
    default: () => [],
  }),

  // ===== RAG =====
  retrievedDocs: Annotation<RetrievedDoc[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  rerankedDocs: Annotation<RetrievedDoc[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // ===== 卡死检测 =====
  observations: Annotation<string[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),

  // ===== 最终输出 =====
  finalContent: Annotation<string>,
})
```

### 辅助类型

```typescript
interface ToolCallInfo {
  id: string
  name: string
  args: string
}

interface ExecutionPlan {
  stages: Stage[]
  reasoning: string
}

interface Stage {
  index: number
  goal: string
  strategy: 'tool' | 'rag' | 'reasoning' | 'hybrid'
  toolHint?: string       // strategy='tool' 时建议的工具名
  ragQuery?: string       // strategy='rag'/'hybrid' 时的检索 query
}

interface StageResult {
  stageIndex: number
  goal: string
  outcome: string
  confidence: number      // 0-1
}

interface RetrievedDoc {
  content: string
  source: string
  score: number
  metadata: Record<string, unknown>
}
```

---

## 4. 节点详细设计

### 4.1 Router

| 属性 | 值 |
|------|-----|
| 输入 | `state.query`, `state.messages` |
| 输出 | `{ route, query }` |
| 调用 LLM | 是（非流式，maxTokens: 100） |
| SSE 事件 | `route` |

**分类逻辑**：

| 走 Reactive | 走 Deliberative |
|------------|----------------|
| 闲聊、问候 | 多步分析、对比研究 |
| 简单事实问答 | 需要文档检索的深度问题 |
| 单工具任务 | 需要多阶段综合推理 |
| 翻译、总结单篇 | 需要规划→执行→验证的闭环 |

**安全降级**：LLM 返回无法解析时默认 `reactive`。

**Prompt 要点**：
- 返回 JSON `{ "route": "reactive" | "deliberative", "reason": "..." }`
- 包含 few-shot 分类示例

---

### 4.2 Reactive Agent

| 属性 | 值 |
|------|-----|
| 输入 | `state.messages`, `state.observations` |
| 输出 | `{ pendingToolCalls, finalContent?, messages }` |
| 调用 LLM | 是（流式） |
| SSE 事件 | `thought_delta`, `thought`, `content_delta` |

**行为**：单步 LLM 调用，流式输出思考过程和内容。

- 有 `tool_calls` → 更新 `pendingToolCalls`，思考内容作为 `thought` 输出
- 无 `tool_calls` 且有文本 → 更新 `finalContent`，文本作为 `content_delta` 输出
- 卡死检测：`observations` 满足 stuck 模式时强制终止

---

### 4.3 Reactive Tool Executor

| 属性 | 值 |
|------|-----|
| 输入 | `state.pendingToolCalls` |
| 输出 | `{ messages: [ToolMessage...], observations, pendingToolCalls: [] }` |
| 调用 LLM | 否 |
| SSE 事件 | `action`, `observation` |

**行为**：遍历 `pendingToolCalls`，逐个执行工具，发射 action + observation 事件，清空 `pendingToolCalls`。

---

### 4.4 Response Finalizer

| 属性 | 值 |
|------|-----|
| 输入 | `state.finalContent` |
| 输出 | `{}` (无需修改 state) |
| 调用 LLM | 否 |
| SSE 事件 | `content_delta`（兜底，处理边缘情况） |

**行为**：确保最终内容已通过流式输出。处理模型只思考未输出内容的边缘情况。

---

### 4.5 Planner

| 属性 | 值 |
|------|-----|
| 输入 | `state.query`, `state.messages`, `state.stageResults`(replan 时), `state.replanCount` |
| 输出 | `{ plan, currentStage: 0, stageResults: [] }` |
| 调用 LLM | 是（非流式，结构化输出） |
| SSE 事件 | `thought`（计划摘要）, `plan` |

**行为**：

1. 首次规划：分析 query，拆解为 2-5 个阶段
2. 重新规划：带上前序 stageResults 上下文，调整计划
3. 返回 `ExecutionPlan` JSON

**Prompt 要点**：
- 返回 JSON，schema 为 `ExecutionPlan`
- 每个阶段指定 `goal` + `strategy`(tool/rag/reasoning/hybrid)
- `tool` strategy 需附带 `toolHint`
- `rag`/`hybrid` strategy 需附带 `ragQuery`

---

### 4.6 Executor

| 属性 | 值 |
|------|-----|
| 输入 | `state.plan`, `state.currentStage`, `state.stageResults` |
| 输出 | `{ stageResults: [result], currentStage: +1, messages, ... }` |
| 调用 LLM | 是（流式） |
| SSE 事件 | `stage_start`, `thought_delta`, `content_delta`, `action`, `observation` |

**行为**：根据当前阶段的 `strategy` 执行：

| Strategy | 行为 |
|----------|------|
| `reasoning` | 纯 LLM 推理，无工具无 RAG |
| `tool` | LLM + 指定工具调用（单阶段内最多 3 轮 mini-ReAct） |
| `rag` | 调用 RAG 检索 → 将检索结果注入 LLM 上下文 → 生成 |
| `hybrid` | 先 RAG 检索，再 LLM + 工具调用 |

**RAG 不可用时**：`rag`/`hybrid` 降级为 `reasoning`。

---

### 4.7 Evaluator

| 属性 | 值 |
|------|-----|
| 输入 | `state.query`, `state.plan`, `state.stageResults` |
| 输出 | `{ evaluationDecision, replanCount? }` |
| 调用 LLM | 是（非流式，结构化输出） |
| SSE 事件 | `evaluation`, `stage_result` |

**决策逻辑**：

| 决策 | 条件 | 下一步 |
|------|------|--------|
| `achieved` | 所有目标已满足 | → Synthesizer（跳过剩余阶段） |
| `continue` | 部分完成，需继续 | → Executor（下一阶段） |
| `replan` | 当前方案失败 | → Planner（重新规划） |
| `stuck` | 无法继续 | → Synthesizer（尽力回答） |

**防护**：`replanCount >= 2` 时强制 `stuck`。

**Prompt 要点**：
- 输入：原始 query + 计划 + 当前阶段结果 + 所有历史阶段结果
- 返回 JSON `{ "decision": "...", "reason": "...", "confidence": 0.8 }`

---

### 4.8 Synthesizer

| 属性 | 值 |
|------|-----|
| 输入 | `state.query`, `state.stageResults` |
| 输出 | `{ finalContent, messages }` |
| 调用 LLM | 是（流式） |
| SSE 事件 | `content_delta` |

**行为**：将所有阶段结果汇总为连贯的最终报告。流式输出。

**Prompt 要点**：
- 输入：原始 query + 所有 stageResults（goal + outcome）
- 输出格式：结构化报告或自然语言回答
- 如果 `evaluationDecision === 'stuck'`，说明已尽力但未完全解决

---

## 5. 边与条件路由

### 完整拓扑

```
START
  → router
    → [route === 'reactive']     → reactiveAgent
    → [route === 'deliberative'] → planner

reactiveAgent
  → [pendingToolCalls.length > 0] → reactiveToolExecutor → reactiveAgent (循环)
  → [无 tool_calls, 有内容]       → responseFinalizer → END

planner → executor → evaluator
  → [decision === 'continue']  → executor
  → [decision === 'replan']    → planner
  → [decision === 'achieved']  → synthesizer → END
  → [decision === 'stuck']     → synthesizer → END
```

### 无限循环防护

| 机制 | 阈值 | 说明 |
|------|------|------|
| 最大计划阶段数 | 5 | Planner 最多生成 5 个阶段 |
| 最大 replan 次数 | 2 | 超过强制 stuck |
| 单阶段内工具调用轮次 | 3 | Executor 内部 mini-ReAct 上限 |
| Graph recursionLimit | 25 | LangGraph 全局递归上限 |

---

## 6. Agentic RAG 设计

### 检索流水线

```
用户 query
    │
    ▼
┌─────────────────────────────┐
│   Hybrid Retrieve (粗筛)     │
│   ├─ BGE 关键词检索          │
│   └─ 向量相似度检索           │
│   → 合并去重 → Top-K (≈10)  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│   Rerank (精排)              │
│   Cross-encoder 模型评分     │
│   → Top-N (≈4)              │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│   Context Assembly           │
│   格式化为上下文字符串         │
│   注入 LLM prompt            │
└─────────────────────────────┘
```

### 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 向量数据库 | ChromaDB | 本地零配置，LangChain 原生，支持混合检索 |
| Embedding | OpenAI 兼容 API 代理 → BGE-m3 | 项目已有代理模式，后续可切本地 |
| Rerank | 初期 LLM 评分 → 后续 cross-encoder | 渐进式，初期无需额外模型服务 |
| 文档分块 | RecursiveCharacterTextSplitter | LangChain 内置，支持中文分隔符 |

### 文档摄入流程

```
上传文件 (PDF/MD/TXT)
    │
    ▼
解析内容
    │
    ▼
RecursiveCharacterTextSplitter
  chunkSize: 1000, chunkOverlap: 200
  separators: ['\n\n', '\n', '。', '.', ' ', '']
    │
    ▼
BGE-m3 Embedding
    │
    ▼
ChromaDB 存储
    │
    ▼
SQLite 记录元数据
```

### RAG API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/documents/upload` | 上传文档（multipart/form-data） |
| GET | `/api/documents` | 列出已摄入文档 |
| DELETE | `/api/documents/:id` | 删除文档及其向量 |
| POST | `/api/documents/query` | 测试 RAG 检索（调试用） |

### 新增数据库表

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 7. SSE 事件扩展

现有 `AgentEvent` 必须保留（向后兼容），新增以下变体：

```typescript
export type AgentEvent =
  // ===== 现有（不可修改） =====
  | { type: 'thought'; content: string }
  | { type: 'thought_delta'; content: string }
  | { type: 'action'; tool_name: string; content: string }
  | { type: 'observation'; content: string }
  | { type: 'content'; content: string }
  | { type: 'content_delta'; content: string }
  | { type: 'done' }

  // ===== 新增：路由 =====
  | { type: 'route'; decision: 'reactive' | 'deliberative'; reason: string }

  // ===== 新增：Deliberative 路径 =====
  | { type: 'plan'; stages: { index: number; goal: string; strategy: string }[] }
  | { type: 'stage_start'; index: number; goal: string; strategy: string }
  | { type: 'stage_result'; index: number; outcome: string; confidence: number }
  | { type: 'evaluation'; decision: string; reason: string }
```

**前端兼容性**：现有 `handleSSEEvent` 使用 switch-case，未匹配的事件类型会被静默忽略，无需前端改动即可运行。后续可选增加计划可视化面板。

---

## 8. 文件变更清单

### 新增文件

```
server/src/services/graph/
├── state.ts                        # AgentState Annotation + 辅助类型
├── graph.ts                        # buildGraph() 组装节点和边
├── prompts.ts                      # 所有 LLM prompt 模板
├── stuck-detector.ts               # detectStuckPattern（去重合并）
└── nodes/
    ├── router.ts                   # 智能路由节点
    ├── reactive-agent.ts           # Reactive LLM 调用
    ├── reactive-tool-executor.ts   # Reactive 工具执行
    ├── response-finalizer.ts       # 响应兜底
    ├── planner.ts                  # 计划拆解
    ├── executor.ts                 # 阶段执行
    ├── evaluator.ts                # 结果评估
    └── synthesizer.ts              # 结果汇总

server/src/services/rag/
├── index.ts                        # barrel export
├── embeddings.ts                   # BGE-m3 embedding 服务
├── vector-store.ts                 # ChromaDB 封装
├── reranker.ts                     # Rerank 模型封装
├── ingestion.ts                    # 文档摄入流水线
└── retrieval.ts                    # 混合检索 + Rerank

server/src/routes/documents.ts      # 文档上传/管理 API
```

### 重写文件

| 文件 | 原因 |
|------|------|
| `server/src/services/agent.ts` | 从 `createReactAgent` 调用改为自定义 graph 调用；移除 legacy 模式、`USE_LANGCHAIN` 开关 |
| `server/src/services/langchain-adapter.ts` | 从消费 `createReactAgent` stream 改为消费 `writer()` 事件；移除模块级 `pendingToolCalls` Map |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/src/types.ts` | 新增 AgentEvent 变体，移除 `Tool` interface |
| `server/src/tools/index.ts` | 统一为 `DynamicStructuredTool[]`，移除 legacy `tools[]` 数组 |
| `server/src/mcp/client.ts` | 只生成 `DynamicStructuredTool[]`，移除 legacy `Tool[]` 生成 |
| `server/src/routes/message.ts` | 适配新 `runAgent()` 签名，可选 `mode` 参数 |
| `server/src/index.ts` | 新增 ChromaDB 初始化步骤 |
| `server/src/db/migrations.ts` | 新增 documents 表迁移 |
| `client/src/types/index.ts` | 同步新增 AgentEvent 变体 |
| `client/src/stores/message.ts` | 处理新事件类型（pass-through） |

### 删除文件

| 文件 | 原因 |
|------|------|
| `server/src/services/tool-adapter.ts` | 工具统一为 `DynamicStructuredTool`，不再需要包装层 |

---

## 9. 分阶段实施计划

### Phase 1：自定义 StateGraph 替换 createReactAgent（仅 Reactive）

**目标**：行为与现有系统完全一致，底层迁移到自定义 graph。

**产出**：
- 新增 `graph/` 目录下所有 Reactive 节点
- 重写 `agent.ts` 和 `langchain-adapter.ts`
- 统一工具格式，移除 legacy 模式和 `USE_LANGCHAIN` 开关
- 移除模块级 `pendingToolCalls` Map

**验证**：启动前后端，简单问答 + 工具调用 + 卡死检测 + 并发请求均正常。

---

### Phase 2：Router 节点

**目标**：LLM 智能分类 query。

**产出**：
- `router.ts` 节点
- `prompts.ts` 路由 prompt
- 新增 `route` SSE 事件
- Deliberative 路径暂时为 stub（fallback 到 reactive）

**验证**：简单问候路由到 reactive，复杂分析路由到 deliberative（stub fallback）。

---

### Phase 3：Deliberative 路径

**目标**：完整实现 Planner → Executor → Evaluator → Synthesizer。

**产出**：
- 4 个新节点文件
- 完整图拓扑（条件边）
- 新增 `plan`/`stage_start`/`stage_result`/`evaluation` SSE 事件

**验证**：
- 多阶段问题正确拆解和执行
- Evaluator 提前终止功能
- Replan 上限（2 次）后强制 stuck
- 所有新 SSE 事件正确发射

---

### Phase 4：Agentic RAG

**目标**：集成混合检索 + Rerank。

**产出**：
- `rag/` 目录下 5 个模块
- 文档上传 API
- documents 表迁移
- Executor RAG 集成
- ChromaDB 初始化

**验证**：
- 文档上传 → 分块 → 入库
- 相关问题正确走 RAG strategy
- 检索结果出现在 observation
- ChromaDB 不可用时降级为 reasoning

---

## 10. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Router 分类不准导致体验差 | 默认 reactive，只有高置信度才走 deliberative |
| Deliberative 循环不终止 | 4 层防护：5 阶段上限、2 次 replan 上限、3 轮单阶段上限、25 recursionLimit |
| RAG 检索质量差 | Rerank 精排 + 不可用时降级为 reasoning |
| ChromaDB 连接失败 | 降级策略：RAG 不可用时 executor 自动切换 reasoning |
| 前端 SSE 不兼容 | 新事件类型向后兼容，前端静默忽略未知类型 |
| `writer()` API 变更风险 | Phase 1 充分测试后再推进后续 Phase |
| 并发请求 pendingToolCalls 串扰 | 已迁移到 graph state，每次请求隔离 |
