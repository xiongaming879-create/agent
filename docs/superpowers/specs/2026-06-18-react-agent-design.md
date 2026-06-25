# ReAct Agent Design

## Problem

需要一个遵循 ReAct (Reasoning + Acting) 范式的 Agent 循环，能够自主推理、调用工具、观察结果，并输出最终回答。中间推理步骤应隔离展示，避免干扰最终回复。

## Design

### ReAct 循环

```
循环：
  1. Thought — Agent 分析当前状态，推理下一步
  2. Action  — Agent 选择并执行一个工具/动作
  3. Observation — 获取工具执行结果
  4. 将 Observation 追加到上下文，回到步骤 1
直到：Agent 判断无需继续，输出最终回复
```

### 中间轮次内容隔离

- 多轮思考中，中间轮次（含 Action）的文本不作为 `content_delta` 发送到前端
- 中间轮次的非 ReAct 文本作为 `thought` 事件展示在思考过程中
- 只有最终轮次（含 `Answer:` 或无 ReAct 格式）的内容作为最终回复显示

### 输出解析 (parseReActOutput)

- 解析 `Action:` 格式（提取 `name` 和 `input`）
- 解析 `Answer:` 格式（提取最终答案）
- 同时有 `Action` 和 `Answer` 时只取 `Action`（中间轮次优先处理工具调用）
- 无 ReAct 格式时返回 `null`
- `containsToolIntent()` 兜底检测模型用 markdown 包裹 Action 的情况

### 卡住检测 (detectStuckPattern)

- 连续 3 次以下模式判定卡住（阈值=3）：
  - `Tool error:` 开头
  - `Request timeout`
  - `Error:` 出现
  - 结果过短（<20 字）
- 不足 3 次失败不判定卡住
- 成功结果穿插时不判定卡住

### 循环上限

- `MAX_ITERATIONS` 硬编码为 25（LangGraph 每轮 agent+tools 算 2 次 recursion）
- 循环正常结束但无有效回答时，兜底输出"经过多轮工具尝试后仍无法获取有效信息，暂时无法确定。"
- 递归超限时 catch 块应生成基于观察结果的回答，不再返回空内容

### Legacy 模式 vs LangChain 模式

- `runAgent` 支持 `USE_LANGCHAIN` 环境变量切换新旧实现
- LangChain 模式：无 `Action:/Answer:` 文本格式，使用原生 tool calling
- Legacy 模式：保留 `Thought:/Action:/Answer:` 格式指令（靠文本解析）

### LangChain 适配层

- LangGraph stream 输出包含 `agent`（AIMessageChunk）和 `tools`（ToolMessage）key
- `msg.tool_calls` 提取工具名和参数
- `stepHasToolCalls` 统一判断整个 agent step：先累积所有 thinking/text，步骤结束后再判断是 thought 还是 content_delta
- 模型只输出 thinking 无 text 时（有 observations），将 thinking 作为 content_delta 回退

### 工具适配器

- `wrapCustomTool` 保留工具 name 和 description
- `wrapCustomTool` 将 `execute(input: string)` 包装为 `func({ input })`
- Schema 使用 `z.object({ input: z.string() })`，兼容 LangGraph 原生 tool calling
- MCP 工具使用原始 `inputSchema` 转为 `DynamicStructuredTool`
- `wrapAllTools` 批量转换

### SSE 事件映射

| LangGraph 事件 | Agent 事件 |
|---------------|-----------|
| `agent` chunk `thinking` block | `thought_delta` |
| `agent` chunk `text` block（无 tool_calls） | `content_delta` |
| `agent` chunk `text` block（有 tool_calls） | `thought_delta` |
| `msg.tool_calls` | `action` |
| `tools` chunk ToolMessage | `observation` |
| 循环结束 | `done` |

## Acceptance Criteria

- parseReActOutput 正确解析 `Action:` 和 `Answer:` 格式
- 同时有 Action 和 Answer 时只取 Action
- 有 Action 的轮次不将 responseText 作为 content_delta
- 有 Answer 的轮次将 Answer 后内容作为 content_delta
- 无 ReAct 格式的最终轮次作为 content_delta
- 连续 3 次失败检测卡住，不足 3 次不判定
- 成功结果穿插时不判定卡住
- MAX_ITERATIONS 为 25
- `wrapCustomTool` 保留 name/description，Schema 用 `z.object({ input: z.string() })`
- `stepHasToolCalls` 统一判断：有 tool_calls 全部作为 thought，无则 thinking→thought + text→content_delta
- 递归超限 catch 块生成基于观察结果的回答

## Changes by File

### `server/src/services/agent.ts`

ReAct 循环主入口、parseReActOutput、detectStuckPattern、USE_LANGCHAIN 开关

### `server/src/services/langchain-adapter.ts`

LangGraph stream 解析 → AgentEvent 映射、stepHasToolCalls、detectStuckPattern

### `server/src/services/tool-adapter.ts`

Tool → DynamicStructuredTool 适配器

### `server/src/mcp/client.ts`

MCP 工具注册（`jsonSchemaToZod` 转换 inputSchema）

## What This Enables

- Agent 自主推理和工具调用
- 中间过程透明可见
- 卡住自动检测和恢复
- Legacy/LangChain 双模式切换

## What This Drops

- Legacy 模式的文本格式解析将在未来移除（当 LangChain 模式稳定后）
