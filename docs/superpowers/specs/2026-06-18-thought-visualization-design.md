# Thought Visualization Design

## Problem

Agent 的思考过程对用户不可见，用户无法理解 Agent 为何做出特定回答。需要将 Agent 的推理步骤、工具调用和观察结果实时可视化展示。

## Design

### 思考过程折叠区

- Agent 思考时，在消息气泡内展示可折叠的「思考过程」区域
- 默认折叠（`showThoughts` 初始值为 `false`），点击展开
- 用户消息不应显示思考过程区域（`role === 'user'` 时无 `thought_steps` 渲染）
- 助手消息有 `thought_steps` 时应渲染可折叠区域
- `thought_steps` 为空时不渲染思考区域

### 思考步骤渲染 (ThoughtStep)

- `thought` 类型：斜体文字（`font-style: italic`）
- `action` 类型：工具徽章 + 内容（黑底白字标签 + 灰色文字）
- `observation` 类型：折叠结果（左边框缩进样式）
- 所有步骤内容超长时换行（`break-words` + `overflow-hidden`）

### 步数计数

- 步数按 action 数量计数（thought→action→observation = 1 轮）

### SSE 流式渲染

- 思考过程实时流式渲染（SSE 逐字输出）
- `thought_delta` 事件追加到最后一个 thought step
- `thought` 完整事件替换最后一个 thought step
- `action` 事件包含 `tool_name`
- `observation` 事件为工具执行结果

## Acceptance Criteria

- 用户消息不渲染思考区域
- 助手消息有 `thought_steps` 时渲染可折叠区域
- `thought_steps` 为空时不渲染
- 思考过程默认折叠
- `thought` 类型斜体，`action` 类型徽章，`observation` 类型缩进
- 步数按 action 数量计数
- SSE 事件正确解析和流式渲染

## Changes by File

### `client/src/components/ThoughtStep.vue`

单个思考步骤渲染组件

### `client/src/components/MessageBubble.vue`

消息气泡中的思考过程折叠区

### `client/src/stores/message.ts`

SSE 事件处理：`thought_delta`、`thought`、`action`、`observation`

## What This Enables

- Agent 推理过程透明可查
- 用户可理解工具调用链
- 实时流式反馈提升交互体验

## What This Drops

- 无
