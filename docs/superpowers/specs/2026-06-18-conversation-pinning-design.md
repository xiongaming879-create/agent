# Conversation Pinning Design

## Problem

对话列表按 updated_at 排序，重要对话容易被新对话淹没，用户无法快速找到常用对话。

## Design

### 数据层

- `conversations` 表新增 `is_pinned` 列，`BOOLEAN DEFAULT 0`
- 迁移语句 `ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT 0`，列已存在时安全跳过
- `server/src/types.ts` 的 `Conversation` 接口新增 `is_pinned: boolean`
- `client/src/types/index.ts` 同步

### API 行为

- `POST /api/conversations` — 新建对话 `is_pinned` 默认 false
- `PATCH /api/conversations/:id` — 支持更新 `is_pinned`，置顶时校验上限（当前用户的置顶数 >= 5 返回 400）
- `GET /api/conversations` — 返回列表按 `is_pinned DESC, updated_at DESC` 排序（置顶在前，内部按时间）
- 权限：只有对话所有者或 admin 可置顶/取消置顶

### 前端交互

- 三点图标下拉菜单：每个对话项右侧显示 ⋮ 图标（hover 时可见），点击弹出下拉菜单
  - 置顶对话（`is_pinned === false` 时显示，绿色文字）
  - 取消置顶（`is_pinned === true` 时显示，红色文字）
  - 删除（点击后弹出现有确认弹窗）
- 视觉标识：置顶对话左侧显示图钉 SVG 图标（线条描边风格），位于对话标题前方
- 标题对齐：未置顶对话用等宽占位符保持与置顶对话标题对齐
- 排序：`conversation.ts` store 的列表排序逻辑调整为 `is_pinned DESC, updated_at DESC`，后端已排序返回，前端保持同步
- 置顶上限提示：API 返回 400 时，底部 toast 提示"最多置顶 5 个对话"

## Changes by File

### `server/src/db/migrations.ts`
新增 is_pinned 列迁移

### `server/src/db/index.ts`
CRUD 支持 is_pinned，查询排序

### `server/src/types.ts`
Conversation 接口加 is_pinned

### `server/src/routes/conversation.ts`
PATCH 支持置顶+上限校验，GET 排序

### `client/src/types/index.ts`
前端 Conversation 类型加 is_pinned

### `client/src/stores/conversation.ts`
排序逻辑同步

### `client/src/components/ConversationList.vue`
三点图标下拉菜单 + 图钉图标

### `test/server/db/database.test.ts`
数据库 is_pinned 测试

### `test/server/routes/conversation.test.ts`
置顶上限校验测试

### `test/client/stores/conversation.test.ts`
排序逻辑测试

## What This Enables

- 重要对话不被新对话淹没
- 快速访问常用对话

## What This Drops

- 无
