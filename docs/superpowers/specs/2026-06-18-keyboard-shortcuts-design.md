# Keyboard Shortcuts Design

## Problem

桌面端用户需要快捷键提升操作效率，减少鼠标依赖。

## Design

### 快捷键绑定

| 快捷键 | 动作 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift + Enter` | 插入换行 |
| `Ctrl + N` | 新建对话 |
| `Ctrl + Shift + C` | 清空当前对话 |

### 输入框交互

- 空内容时发送按钮禁用
- 思考中（`isStreaming`）时输入框禁用，发送按钮变为旋转 loading 图标
- 输入框自动扩展高度（监听 input 事件动态调整），最大 160px
- 输入框聚焦时边框变为柔和深灰色（`focus:border-neutral-400`）并带轻阴影（`focus:shadow-sm`）

## Acceptance Criteria

- Enter 触发发送
- Shift+Enter 不触发发送（用于换行）
- Ctrl+N 新建对话
- Ctrl+Shift+C 清空当前对话
- 空内容时发送按钮禁用
- 思考中时输入框禁用，发送按钮变 loading 图标
- 输入框自动扩展高度，最大 160px

## Changes by File

### `client/src/composables/useKeyboard.ts`

快捷键注册与触发逻辑

### `client/src/components/ChatInput.vue`

输入框交互：发送、换行、禁用状态、自动扩展

## What This Enables

- 桌面端高效操作
- 与主流聊天应用一致的交互习惯

## What This Drops

- 无
