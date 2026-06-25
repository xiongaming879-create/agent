# Export Design

## Problem

用户需要将对话内容导出为可读或可导入的格式，方便分享和备份。

## Design

### 导出格式

- Markdown 格式：可读性强，方便分享
- JSON 格式：结构完整，可重新导入
- 导出包含完整思考过程和消息树

### API 端点

- `GET /api/conversations/:id/export?format=json` — 导出 JSON
- `GET /api/conversations/:id/export?format=md` — 导出 Markdown

## Acceptance Criteria

- 导出 JSON 格式包含完整消息树和思考过程
- 导出 Markdown 格式可读性强
- 导出需所有者或 admin 权限

## Changes by File

### `server/src/routes/conversation.ts`

导出端点实现

## What This Enables

- 对话内容持久化备份
- 跨系统分享对话
- JSON 格式支持重新导入

## What This Drops

- 无
