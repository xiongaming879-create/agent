# PnE (Plan-and-Execute) 设计规格 — COMPLEX 路径二级分流

> 日期：2026-10-09
> 上游文档：`ARCHITECTURE.md`（混合架构设计，本文档为其可实施版本）
> 状态：已澄清，待实施

## 1. 目标

COMPLEX 路径内部二级分流：简单复杂问题继续走现有 ReAct 单循环（零改动），真正多步问题走 Plan-and-Execute（Planner → Executor → Evaluator → Synthesizer）。支持并行/串行阶段调度、提前终止（achieved 跳过剩余阶段）、计划调整（replan，上限 2 次）。路由层、认证、数据库结构零改动。

## 2. 已澄清的设计决定（覆盖 ARCHITECTURE.md 原文）

| # | 决定 | 内容 |
|---|------|------|
| D1 | Executor 实现方式 | **手写轻量循环**，不复用 `createReactAgent`/`langchainAgentRunner`。单阶段内 `callLLM` + 直接 `.invoke()` 工具注册表，3 轮上限；LLM 不再发 tool_calls 即阶段完成。不经过 langchain-adapter，无 `pendingToolCalls` 串扰 |
| D2 | Prompt 存放 | **外部化**到 `server/src/prompts/pne/{planner,executor,evaluator,synthesizer}.txt`，走 `prompt-loader` 缓存 + `{{var}}` 渲染（偏离 ARCHITECTURE.md 的 `pne/prompts.ts`，与项目现有约定一致） |
| D3 | SSE 事件收敛 | 仅 **2 个新事件**：`plan`（完整快照，含 outcome）+ `evaluation`。砍掉 ARCHITECTURE.md 中的 `stage_start`/`stage_result`（plan 快照已携带状态变化信息） |
| D4 | Phase 3 移出本期 | `pendingToolCalls` 模块级 Map 是存量 bug（并发 ReAct 请求也受影响），**另开任务处理**，不混入 PnE。手写 Executor 后它不再是 PnE 前置条件 |

## 3. 模块结构

```
server/src/services/pne/
├── planner.ts      # query + 已完成阶段结果 → ExecutionPlan（MODEL_STRONG）
├── executor.ts     # 单阶段执行：手写 mini 循环（3 轮工具上限）
├── evaluator.ts    # 计划 + 阶段结果 → continue/achieved/replan/stuck（MODEL_LIGHT, 300 token）
├── synthesizer.ts  # 阶段结果 → 最终答案（MODEL_STRONG，流式 content_delta）
└── run.ts          # runPneAgent 编排：拓扑调度 + replan 外层循环
```

### 数据模型

```typescript
interface ExecutionPlan {
  reasoning: string
  stages: Stage[]
}

interface Stage {
  index: number
  goal: string
  strategy: 'tool' | 'reasoning' | 'hybrid'
  toolHint?: string
  toolArgs?: string
  dependsOn: number[]
}

interface StageResult {
  index: number
  goal: string
  outcome: string
}
```

Planner 输出经 `extractFirstJsonObject`（llm-caller.ts 已有）解析；解析失败/阶段数>5/字段缺失 → 抛错，由上层回退 ReAct。

## 4. 编排逻辑（run.ts `runPneAgent`）

```
while replanCount <= MAX_REPLAN(2):
    plan = await planner(query, stageResults)
    while true:
        ready = findReadyStages(plan.stages, stageResults)   # 依赖全部完成
        if not ready: break                                   # 全完成 / 死锁跳出
        results = await runBatch(ready)                       # 无依赖阶段 Promise.all 并行
        stageResults.push(...results)
        发 plan 快照事件（status 更新 + outcome）
        decision = await evaluator(query, plan, stageResults)
        发 evaluation 事件
        if achieved or stuck: goto synthesize（achieved 时未完成阶段标 skipped）
        if replan: replanCount++; break
synthesize:
    yield* synthesizer(query, stageResults)                   # 流式 content_delta
```

### 模型分配

| 角色 | 模型 | 说明 |
|------|------|------|
| Planner | MODEL_STRONG | 拆解质量优先 |
| Executor | MODEL_STRONG | 工具调用可靠性 |
| Evaluator | MODEL_LIGHT | `maxTokens: 300`，省成本 |
| Synthesizer | MODEL_STRONG | 最终答案流式输出 |

## 5. Executor 单阶段（手写循环）

```typescript
async function* executeStage(stage, contextMessages, tools): AsyncGenerator<AgentEvent, string> {
  for (round = 1; round <= 3; round++) {
    const resp = await callLLM(stagePrompt + 已有观察, { tools })  // 非流式
    if (resp.tool_calls?.length) {
      for (const tc of resp.tool_calls) {
        yield { type: 'action', tool_name: tc.name, content: tc.args }
        const obs = await invokeTool(tools, tc)   // 直接 .invoke()，含超时
        yield { type: 'observation', tool_name: tc.name, content: truncate(obs) }
      }
      continue
    }
    return resp.text   // 无 tool_calls → 阶段完成
  }
  return '阶段达到 3 轮上限，基于已有观察小结'   // 让 LLM 基于已有观察总结一次
}
```

要点：
- 工具来自 `getAllLcTools()` 注册表（DynamicStructuredTool），`toolArgs` 为 JSON 字符串 → `JSON.parse` 后传入
- 每轮 LLM 调用 `maxTokens: 4096`，单次调用超时复用 `LLM_TIMEOUT_MS`
- 卡死防护简化版：单阶段连续 3 次工具执行失败 → 提前结束该阶段，outcome 记录失败
- observation 截断复用现有截断策略（4000 字符级），防止上下文膨胀
- 高危确认照旧 prompt 驱动：工具返回"需确认"提示，模型下轮带 `confirm:true` 重调，机制在任意循环中均生效

## 6. 二级分流（runComplex 入口，query-router.ts）

判据（顺序短路）：

| 顺序 | 判据 | 命中 → |
|------|------|--------|
| 1 | `complexity === 'deep'` | PnE |
| 2 | query 长度 > 120 字符 | PnE |
| 3 | 含信号词「对比/分析/方案/规划/步骤/制定/策划/评估」 | PnE |
| 4 | 以上未命中 → MODEL_LIGHT 单次判断（~20 token：「该问题是否需要多阶段执行」） | 是→PnE / 否→ReAct 现状 |

**回退**：`runPneAgent` 全程 try/catch，任何异常（planner 解析失败、工具异常、evaluator 输出非法）→ 发 thought 事件说明回退 → 重跑现有 ReAct 路径一次。回退只重试一次，再失败走现有 COMPLEX 错误处理。

分流判断函数独立导出（`shouldUsePne(query, complexity)`），纯逻辑可单测；LLM 兜底判据单独 mock。

## 7. SSE 事件（types.ts）

```typescript
// 新增 2 个变体，现有事件不动
| { type: 'plan'; stages: { index: number; goal: string; strategy: string;
    status: 'pending' | 'running' | 'done' | 'skipped'; dependsOn: number[];
    outcome?: string }[] }
| { type: 'evaluation'; decision: 'continue' | 'achieved' | 'replan' | 'stuck'; reason: string }
```

- `plan` 发**完整快照**（非增量），每次阶段状态变化重发，天然容错丢包
- 阶段开始执行前先发一帧 status='running' 的快照
- 前端 `handleSSEEvent` switch-case 对未知类型静默忽略 → 向后兼容

## 8. 持久化与前端可视化（方案 A：thought_steps）

- 后端 `processAgentStream`（routes/message.ts）增加 `case 'plan'`：透传 SSE + 写入服务端 `thoughtSteps`（`{ type: 'plan', content: JSON.stringify(stages), ... }`），随 `createMessage` 持久化，无 DB 迁移
- `evaluation` 事件同样透传，作为 thought 文本记录
- 前端改动四处：

| 文件 | 改动 |
|------|------|
| `client/src/types/index.ts` | 同步 AgentEvent 变体 + ThoughtStep.type 增加 'plan' |
| `client/src/stores/message.ts` | `handleSSEEvent` 增加 `case 'plan'`：写入 thoughtSteps |
| `client/src/utils/thoughtGroup.ts` | `groupThoughtSteps` 识别 `type==='plan'` → `kind:'plan'` 条目（解析 stages 快照） |
| `client/src/components/ThoughtStep.vue` | 新增 `kind==='plan'` 模板分支：todo list（状态图标 ☑ done / ⏳ running / ○ pending、 skipped 标记、依赖标注「依赖 1,2」、outcome 短文本） |

老数据无 'plan' 步骤 → 新分支不触发，note/round 渲染不受影响；刷新后从持久化 thought_steps 回放 todo 完成态。

## 9. 防护阈值（全部代码内常量，不做配置项）

| 机制 | 阈值 |
|------|------|
| 最大计划阶段数 | 5（Planner 超出截断/拒绝） |
| 最大 replan 次数 | 2，超过强制 stuck → Synthesizer 兜底 |
| 单阶段内工具调用轮次 | 3 |
| 单次 LLM 调用超时 | 复用 LLM_TIMEOUT_MS（60s 级） |
| 依赖死锁 | 无 ready 阶段即跳出 → 最终评估 |
| 单阶段连续工具失败 | 3 次提前结束该阶段 |

## 10. 明确不做（本期范围外）

- `pendingToolCalls` 模块级 Map 消除（存量 bug，另开任务）
- Planner/Executor 之外的模型路由调优
- plan 事件增量协议（快照够用）
- PnE 执行过程的数据库持久化（仅 thought_steps 回放）

## 11. 实施阶段

| 阶段 | 内容 | 验证 |
|------|------|------|
| P1 | pne/ 5 文件 + 单测 | Vitest：planner JSON 解析（合法/非法/超 5 阶段）、拓扑调度（并行批次正确性、死锁跳出）、Executor 3 轮上限、事件序列 |
| P2 | runComplex 二级分流 + 回退 | `shouldUsePne` 单测（4 判据）；describe.skip 集成：PnE 路由发起多阶段问题，观察 plan/evaluation 事件；注入 planner 抛错验证回退 ReAct |
| P3 | 前端 todo 可视化 | 组件测试：plan kind 渲染、状态图标、依赖标注；手动验证实时更新 + 刷新回放 |

## 12. 测试约定

- 单测放 `test/server/services/pne/`、`test/client/`（延续现有目录约定），Vitest，environment: node
- LLM 调用 mock（planner/evaluator/synthesizer 注入 fake callLLM）
- 集成测试 `describe.skip()`，需后端运行手动执行
- 新测试用描述性 test 名称，不用 TC-ID
