# 会话导出功能设计

> 日期：2026-08-03
> 状态：已批准

## 背景

后端已实现 `GET /api/conversations/:id/export?format=json|md` 端点（`server/src/routes/conversation.ts:129-170`），支持 JSON 和 Markdown 两种格式，Markdown 格式包含思考过程折叠。但前端无任何 UI 入口，用户无法通过界面触发导出。

本次需求：在前端 ConversationList 右键菜单中添加导出入口，支持下载 Markdown 和 JSON 两种格式。

## 决策记录

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 入口位置 | ConversationList 右键菜单 | 与现有置顶/删除交互一致，改动最小 |
| 2 | 支持格式 | Markdown + JSON 两种 | 后端两种格式均已实现，多一个二级选择成本极低；JSON 对未来导入功能有铺垫价值 |
| 3 | 交互方式 | 菜单内直接两项 | 点击次数最少（1 次即下载），菜单共 4 项不会过长 |
| 4 | 实现方案 | Store 方法 + Blob 下载 | 遵循现有 store 管理 API 调用的模式，auth 处理一致 |

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `client/src/types/index.ts` | 新增类型 | `ExportFormat = 'md' \| 'json'` |
| `client/src/stores/conversation.ts` | 新增方法 | `exportConversation(id: string, format: ExportFormat): Promise<void>` |
| `client/src/components/ConversationList.vue` | 修改 | 右键菜单加「导出 Markdown」「导出 JSON」两项 |

无新增文件。

## 组件设计

### 1. types/index.ts

```typescript
export type ExportFormat = 'md' | 'json'
```

### 2. conversation.ts store — exportConversation

```typescript
async function exportConversation(id: string, format: ExportFormat): Promise<void> {
  const res = await authFetch(`${API}/${id}/export?format=${format}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: '导出失败' }))
    throw new Error(data.error || '导出失败')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const conv = conversations.value.find(c => c.id === id)
  const safeTitle = (conv?.title ?? 'conversation').replace(/[\/\\:*?"<>|]/g, '_')
  const ext = format === 'md' ? 'md' : 'json'
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeTitle}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

### 3. ConversationList.vue — 菜单项

在现有右键菜单（`openMenu` 浮层）中，「删除」按钮上方插入两个导出按钮：

```html
<button @click="handleExport(openMenu.convId, 'md')">导出 Markdown</button>
<button @click="handleExport(openMenu.convId, 'json')">导出 JSON</button>
```

```typescript
async function handleExport(convId: string, format: ExportFormat) {
  closeMenu()
  try {
    await store.exportConversation(convId, format)
  } catch (err: unknown) {
    exportError.value = err instanceof Error ? err.message : '导出失败'
    setTimeout(() => { exportError.value = '' }, 1500)
  }
}
```

错误提示复用现有 `pinError` 的 toast 模式（新增 `exportError` ref，或合并为一个通用 `toastMessage`）。

## 数据流

```
用户右键对话 -> 菜单显示 4 项（置顶/删除/导出Markdown/导出JSON）
  -> 点击「导出 Markdown」
    -> store.exportConversation(convId, 'md')
      -> authFetch('GET /api/conversations/:id/export?format=md')
        -> 后端返回 Content-Type: text/markdown; charset=utf-8 + MD 正文
      -> res.blob() 转 Blob
      -> URL.createObjectURL(blob) -> tempUrl
      -> 创建 <a href=tempUrl download="对话标题.md">
      -> document.body.appendChild + a.click() 触发下载
      -> URL.revokeObjectURL(tempUrl) 清理
      -> a.remove()
  -> 浏览器下载文件，菜单关闭
```

JSON 格式同理，`format='json'`，下载文件名 `对话标题.json`。

文件名来源：对话 `title` 字段，过滤非法字符 `/\:*?"<>|` 替换为 `_`。

## 错误处理

- `authFetch` 返回非 200：`res.json()` 读取错误信息，throw Error
- 组件 catch 后显示 toast 提示（1.5s 自动消失），复用 `pinError` 模式
- 不加 loading 状态--请求通常 < 1s，菜单直接关闭即可
- blob 下载失败（极端情况）catch 后同样 toast 提示

## 测试策略

| 测试文件 | 测试内容 |
|---------|---------|
| `test/client/stores/conversation.test.ts` | mock `authFetch` 返回 blob，验证 URL 正确（含 format 参数）、`createObjectURL`/`click`/`revokeObjectURL` 被调用、文件名含正确扩展名 |
| `test/client/components/components.test.ts` | 菜单渲染测试：验证菜单中有「导出 Markdown」和「导出 JSON」两个按钮，点击时调用 `store.exportConversation` |

不测的：
- 后端 `/export` 端点（已有实现，不在本次范围）
- 浏览器原生下载行为（`URL.createObjectURL` 等，属于平台 API）
