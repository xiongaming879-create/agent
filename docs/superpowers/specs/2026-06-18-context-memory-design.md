# Context Memory Design

## Problem

LLM 有上下文窗口限制，对话过长时需要截断早期消息，但系统提示词必须保留。需要自动管理上下文窗口大小，确保 Agent 在合理范围内工作。

## Design

### 上下文窗口管理

- 每轮对话携带完整历史消息作为上下文发送给 LLM
- 支持配置上下文窗口大小（默认最近 20 轮）
- 超出窗口时自动截断最早的消息，保留系统提示词
- 截断时 `role === 'system'` 的消息始终保留

### 消息格式

- 输入 `ChatMessage[]` 转为 `HumanMessage` / `AIMessage` / `SystemMessage` 对象传入 LangGraph

## Acceptance Criteria

- 超出窗口大小时截断最早的消息
- 截断时保留系统提示词（`role === 'system'` 的消息始终保留）
- 上下文窗口大小可配置

## Changes by File

### `server/src/services/agent.ts`

上下文窗口截断逻辑

### `server/src/services/langchain-adapter.ts`

ChatMessage 转 LangChain Message 格式

## What This Enables

- 长对话自动管理上下文
- 系统提示词始终有效

## What This Drops

- 早期对话内容在超出窗口后丢失（权衡取舍）
