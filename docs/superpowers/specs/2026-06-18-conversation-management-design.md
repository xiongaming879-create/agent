# Conversation Management Design

## Problem

用户需要管理多个独立对话，每个对话有自己的消息历史和上下文。没有对话管理，用户只能在单一上下文中交互，无法区分不同话题或场景。

## Design

### 对话列表与 CRUD

- 左侧边栏展示对话列表，按 `updated_at` 降序排列（最近活跃在最上方）
- 新建对话：创建空对话，默认标题「新对话」
- 切换对话：点击列表项切换 `activeId`，右侧展示对应消息
- 删除对话：hover 显示删除按钮，点击弹出自定义确认弹窗（非浏览器 `confirm()`），确认后删除
- 重命名对话：更新 `title` 字段
- 自动标题：首条消息发送后，标题自动更新为消息内容（最多 22 字，超出 `...` 截断）

### 对话级 System Prompt

- 每个对话可单独设置 `system_prompt`
- System Prompt 编辑弹窗：打开时显示当前值，保存后更新，空输入等同于清除（存储为 `null`）

### 侧边栏交互

- 活跃对话项有左侧白色边框标识（`border-l-2 border-l-white`）
- 删除按钮支持键盘 focus 时显示（`focus:opacity-100`）

## Acceptance Criteria

- 对话列表按 `updated_at` 降序渲染
- 点击对话项切换活跃对话
- 活跃对话项有左侧白色边框标识
- 删除对话时弹出自定义确认弹窗，确认后调用 `store.remove()`，取消时关闭弹窗不执行
- 新建对话默认标题「新对话」，首条消息后自动更新标题（22 字截断）
- `fetchAll()` 在消息发送完成后被调用刷新侧边栏
- `fetchByUserId` 后 `activeId` 为 `null`（管理员点击用户时不自动选中）
- 打开 System Prompt 弹窗显示当前值，保存后更新，空输入清除

## Changes by File

### `client/src/stores/conversation.ts`

对话状态管理：列表 CRUD、排序、活跃切换、fetchByUserId

### `client/src/components/ConversationList.vue`

侧边栏 UI：对话列表渲染、删除确认弹窗、活跃标识

### `client/src/components/ChatArea.vue`

System Prompt 弹窗、自动标题逻辑

## What This Enables

- 多话题并行管理
- 对话级自定义 System Prompt
- 自动标题减少手动命名负担

## What This Drops

- 无
