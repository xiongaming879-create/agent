# Data Model Design

## Problem

需要定义对话、用户、消息和思考步骤的数据模型，支持多用户、消息分支树结构和思考过程存储。

## Design

### Conversation（对话）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (uuid) | 对话唯一标识 |
| title | string | 对话标题（默认取首条消息前 20 字） |
| system_prompt | string? | 对话级自定义系统提示词 |
| user_id | string? | 所属用户 ID（null 为无主对话，认证前创建） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 最后活跃时间 |

### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (uuid) | 用户唯一标识 |
| username | string | 用户名（唯一） |
| password_hash | string | bcrypt 加密的密码 |
| role | enum | `user` / `admin` |
| avatar | string | 头像 emoji |
| theme | enum | `light` / `dark` / `auto` |
| font_size | number | 字体大小 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### Message（消息）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (uuid) | 消息唯一标识 |
| conversation_id | string | 所属对话 ID |
| parent_id | string? | 父消息 ID（支持分支树结构） |
| role | enum | `user` / `assistant` / `system` |
| content | string | 最终回复正文 |
| thought_steps | JSON[] | 思考步骤数组 |
| created_at | datetime | 创建时间 |

**分支机制**：消息通过 `parent_id` 构成树。同一 `parent_id` 下可有多个子消息（分支）。

### ThoughtStep（思考步骤）

| 字段 | 类型 | 说明 |
|------|------|------|
| type | enum | `thought` / `action` / `observation` |
| content | string | 步骤内容 |
| tool_name | string? | Action 时附带的工具名称 |
| timestamp | datetime | 步骤时间戳 |

### 数据库层

- 引擎：sql.js (WASM SQLite)，异步 API
- 路径：`process.env.DB_PATH || server/data/agent.db`
- 每次写操作后调用 `saveDb()` 写盘
- 显式列名查询（`SELECT id, title, ...`），避免 `ALTER TABLE ADD COLUMN` 追加列导致的 `SELECT *` 位置映射错位
- 自动保存：写操作标记 `dirty` 而非立即写盘，由定时器每 5 秒批量保存
- `stopAutoSave()` 刷盘并停止定时器
- 服务入口注册 SIGINT/SIGTERM 信号处理

### 迁移版本控制

- `schema_version` 表追踪已执行的迁移
- 新数据库：所有迁移依次执行
- 已有数据库（无 `schema_version` 但表已存在）：标记全部迁移为已执行
- `ALTER TABLE ADD COLUMN` 列已存在时安全跳过
- 迁移只能 ADD COLUMN / CREATE TABLE IF NOT EXISTS，不能 DROP

## Acceptance Criteria

- Conversation 有 id/title/system_prompt/user_id/created_at/updated_at
- Message 有 id/conversation_id/parent_id/role/content/thought_steps/created_at
- parent_id 构成树结构：同一 parent_id 下多个子消息为分支
- ThoughtStep: thought 无 tool_name，action 有 tool_name，observation 无 tool_name
- `getConversation` 返回字段映射正确（user_id 不是时间戳）
- 无主对话查询：`getConversationsByUserId(null)` 返回 `user_id IS NULL` 的对话
- `updateConversation` 支持更新和清空 `user_id`
- 删除对话时级联删除所有消息
- 迁移版本控制正确执行

## Changes by File

### `server/src/types.ts`

Conversation, Message, ThoughtStep, User 类型定义

### `server/src/db/index.ts`

数据库初始化 + CRUD（显式列名查询）

### `server/src/db/migrations.ts`

建表语句 + 迁移版本控制

### `server/src/db/user.ts`

用户 CRUD

## What This Enables

- 多用户对话隔离
- 消息分支树结构
- 思考过程持久化存储
- 数据库迁移安全演进

## What This Drops

- 无（删库保护：禁止 DROP TABLE/DATABASE、删除 .db 文件、空数据覆盖）
