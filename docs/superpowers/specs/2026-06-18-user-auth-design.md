# User Authentication & Authorization Design

## Problem

系统需要多用户支持，不同用户应只能访问自己的对话，管理员需要查看所有用户的对话。认证前创建的对话无所有者，需要被已登录用户接管。

## Design

### JWT 认证

- 注册：`POST /api/auth/register`，创建用户并返回 JWT token
- 登录：`POST /api/auth/login`，验证密码后返回 JWT token
- 获取当前用户：`GET /api/auth/me`（需认证）
- 所有 API 请求需携带 `Authorization: Bearer <token>`

### 角色与权限

- 两种角色：`admin`（管理员）和 `user`（普通用户）
- 权限模型：
  - admin 可访问所有用户的所有对话
  - 普通用户只能访问自己的对话和无主对话
  - 无主对话（`user_id = null`）首次被普通用户操作时自动绑定给该用户

### 无主对话继承 (claimOrphan)

- 访问无主对话后 `user_id` 被绑定为当前用户
- 删除操作不触发 claimOrphan（无绑定副作用）
- 已有 `user_id` 的对话访问后 `user_id` 不变

### 管理员交互

- 管理员侧边栏显示用户列表，点击用户查看其对话列表
- 管理员未选中具体会话时，右侧显示欢迎页
- 管理员点击用户时 `activeId` 为 `null`，不自动选中对话

### 权限检查 (checkOwnership / verifyOwnership)

- admin 操作任何对话 → 允许
- 对话 `user_id` 匹配当前用户 → 允许
- 对话 `user_id` 不匹配当前用户且非 admin → 拒绝（403）
- 对话 `user_id` 为 `null` → 允许任何已登录用户访问
- 普通用户发送消息到无主对话 → 允许且对话被绑定

## Acceptance Criteria

- admin 用户访问任何对话 → 允许
- 对话 `user_id` 匹配当前用户 → 允许
- 对话 `user_id` 不匹配且非 admin → 拒绝
- 对话 `user_id` 为 `null` → 允许任何已登录用户访问
- 访问无主对话后 `user_id` 被绑定为当前用户
- 删除操作不触发 claimOrphan
- 普通用户看到自己的对话 + 无主对话
- 管理员查指定用户仅返回该用户对话（不合并无主对话）
- 合并后无重复（以 id 去重）
- `fetchByUserId` 后 `activeId` 为 `null`
- `fetchAll` 后若 `activeId` 对应对话不在列表中则重置为第一个或 `null`

## Changes by File

### `server/src/routes/auth.ts`

认证路由：注册/登录/me

### `server/src/routes/user.ts`

用户设置路由

### `server/src/routes/admin.ts`

管理员路由：用户列表

### `server/src/middleware/auth.ts`

JWT 认证中间件 + admin 权限检查

### `server/src/db/user.ts`

用户 CRUD

### `client/src/stores/auth.ts`

认证状态管理：JWT 登录/注册/登出

### `client/src/utils/fetch.ts`

authFetch（自动附加 JWT header）

### `client/src/components/AdminSidebar.vue`

管理员侧边栏：用户列表→对话列表

## What This Enables

- 多用户隔离访问
- 管理员全局管控
- 认证前后对话无缝衔接

## What This Drops

- 无
