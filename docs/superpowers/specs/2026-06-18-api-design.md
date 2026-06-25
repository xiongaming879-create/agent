# API Design

## Problem

定义前后端通信的 REST API 和 SSE 流式协议，支持对话管理、消息交互、认证和权限控制。

## Design

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册用户 |
| POST | /api/auth/login | 登录（返回 JWT token） |
| GET | /api/auth/me | 获取当前用户信息（需认证） |

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| PATCH | /api/user/settings | 更新当前用户设置（头像/主题/字号） |

### 管理员

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 获取所有用户列表（仅 admin） |

### 对话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations | 获取对话列表（普通用户返回自己的+无主对话；admin 可传 userId 查指定用户） |
| POST | /api/conversations | 新建对话（可含 system_prompt，自动绑定当前用户） |
| PATCH | /api/conversations/:id | 更新对话（重命名 / 修改 system_prompt，需所有者或 admin） |
| DELETE | /api/conversations/:id | 删除对话（需所有者或 admin） |
| GET | /api/conversations/:id/export?format=md\|json | 导出对话 |

### 消息

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations/:id/messages | 获取对话消息列表（树结构） |
| POST | /api/conversations/:id/messages | 发送消息（触发 Agent，SSE 流式返回） |
| PATCH | /api/conversations/:id/messages/:mid | 编辑用户消息（创建分支） |
| POST | /api/conversations/:id/messages/:mid/regenerate | 重新生成助手消息（创建分支） |

### SSE 流式响应格式

```
event: thought_delta
data: {"type":"thought_delta","content":"..."}

event: thought
data: {"type":"thought","content":"..."}

event: action
data: {"type":"action","tool_name":"search","content":"搜索: ..."}

event: observation
data: {"type":"observation","content":"搜索结果: ..."}

event: content_delta
data: {"type":"content_delta","content":"根据分析，"}

event: content
data: {"type":"content","content":"..."}

event: done
data: {"type":"done"}
```

### SSE 事件解析

- 解析 `data:` 行为 `SSEEvent` 对象
- 忽略非 `data:` 行（`event:` / `id:` / 空行）
- 无效 JSON 返回 `null`
- 连续解析多行 SSE 流，正确提取所有事件

## Acceptance Criteria

- 所有 API 端点正常响应
- SSE 流包含 thought/action/observation/content/done 事件
- SSE 事件解析正确处理 data 行、忽略非 data 行、处理无效 JSON
- 权限检查：admin 全访问，普通用户限自己+无主
- 无主对话首次操作自动绑定

## Changes by File

### `server/src/routes/conversation.ts`

对话路由：CRUD + 导出 + 权限检查 + 无主对话继承

### `server/src/routes/message.ts`

消息路由：消息列表 + SSE 流式 + 分支编辑 + 重新生成 + 权限校验

### `server/src/routes/auth.ts`

认证路由

### `server/src/routes/user.ts`

用户设置路由

### `server/src/routes/admin.ts`

管理员路由

### `server/src/middleware/auth.ts`

JWT 认证中间件

### `client/src/stores/message.ts`

SSE 读取与事件处理逻辑

## What This Enables

- 前后端分离通信
- 流式消息实时传输
- 细粒度权限控制

## What This Drops

- 无
