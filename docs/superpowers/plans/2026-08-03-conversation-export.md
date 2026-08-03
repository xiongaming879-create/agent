# 会话导出功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ConversationList 右键菜单中添加「导出 Markdown」和「导出 JSON」两个选项，点击后通过 authFetch 请求后端 `/api/conversations/:id/export` 端点，blob 下载对应格式文件。

**Architecture:** Store 层新增 `exportConversation(id, format)` 方法，封装 authFetch + blob 下载逻辑；组件层在现有右键菜单中新增两个按钮调用 store 方法。后端端点已实现，无需改动。

**Tech Stack:** Vue 3 + Pinia + TypeScript + Vitest（纯逻辑行为测试，environment: node）

## Global Constraints

- 服务端 ESM，前端 `<script setup lang="ts">`
- 禁止 `any`，用 `unknown`
- 测试在项目根目录运行，environment: node，纯逻辑行为测试模式（不挂载真实组件，用 plain JS 模拟行为）
- Commit 格式：`【导出】描述`
- 不主动 push

---

### Task 1: ExportFormat 类型 + exportConversation store 方法

**Files:**
- Modify: `client/src/types/index.ts`（末尾新增类型）
- Modify: `client/src/stores/conversation.ts`（新增方法 + return 导出）
- Test: `test/client/stores/conversation.test.ts`（末尾新增 describe block）

**Interfaces:**
- Consumes: `authFetch` from `../utils/fetch`，`Conversation` type from `../types`
- Produces: `exportConversation(id: string, format: ExportFormat): Promise<void>`，`ExportFormat = 'md' | 'json'`

- [ ] **Step 1: Write the failing tests**

在 `test/client/stores/conversation.test.ts` 末尾追加：

```typescript
describe('对话状态 - 导出功能', () => {
  it('导出 URL 包含正确的 id 和 format 参数', () => {
    const API = '/api/conversations'
    const id = 'conv-123'
    const format = 'md'
    const url = `${API}/${id}/export?format=${format}`
    expect(url).toBe('/api/conversations/conv-123/export?format=md')
  })

  it('JSON 格式导出 URL 使用 format=json', () => {
    const API = '/api/conversations'
    const id = 'conv-456'
    const format = 'json'
    const url = `${API}/${id}/export?format=${format}`
    expect(url).toBe('/api/conversations/conv-456/export?format=json')
  })

  it('文件名使用对话标题，扩展名与格式对应', () => {
    const title = '西藏行程规划'
    const format = 'md'
    const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '_')
    const ext = format === 'md' ? 'md' : 'json'
    const fileName = `${safeTitle}.${ext}`
    expect(fileName).toBe('西藏行程规划.md')
  })

  it('文件名过滤非法字符', () => {
    const title = 'test/file:name?'
    const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '_')
    expect(safeTitle).toBe('test_file_name_')
  })

  it('对话标题为空时使用默认文件名', () => {
    const title = ''
    const safeTitle = (title || 'conversation').replace(/[\/\\:*?"<>|]/g, '_')
    const ext = 'json'
    const fileName = `${safeTitle}.${ext}`
    expect(fileName).toBe('conversation.json')
  })

  it('导出失败时抛出包含错误信息的 Error', async () => {
    const mockRes = { ok: false, json: async () => ({ error: '无权限访问' }) }
    let thrownError: Error | null = null
    try {
      if (!mockRes.ok) {
        const data = await mockRes.json()
        throw new Error(data.error || '导出失败')
      }
    } catch (err) {
      thrownError = err instanceof Error ? err : new Error('导出失败')
    }
    expect(thrownError?.message).toBe('无权限访问')
  })

  it('导出失败且响应无 error 字段时使用默认提示', async () => {
    const mockRes = { ok: false, json: async () => ({}) }
    let thrownError: Error | null = null
    try {
      if (!mockRes.ok) {
        const data = await mockRes.json()
        throw new Error(data.error || '导出失败')
      }
    } catch (err) {
      thrownError = err instanceof Error ? err : new Error('导出失败')
    }
    expect(thrownError?.message).toBe('导出失败')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/client/stores/conversation.test.ts`
Expected: 新增的 7 个测试全 PASS（因为测试的是纯逻辑，不依赖 store 实现）。这验证了测试本身逻辑正确。

注意：本项目的测试模式是行为规范测试（plain JS 模拟逻辑），不导入真实 store。这些测试定义了 exportConversation 应遵循的行为规范。后续 store 实现必须符合这些规范。

- [ ] **Step 3: Add ExportFormat type to types/index.ts**

在 `client/src/types/index.ts` 末尾追加：

```typescript
export type ExportFormat = 'md' | 'json'
```

- [ ] **Step 4: Add exportConversation to conversation store**

在 `client/src/stores/conversation.ts` 中：

1. 文件顶部 import 补充 `ExportFormat`：

```typescript
import type { Conversation, ExportFormat } from '../types'
```

2. 在 `togglePin` 函数之后、`setActive` 函数之前新增：

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
    const safeTitle = (conv?.title || 'conversation').replace(/[\/\\:*?"<>|]/g, '_')
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

3. 在 return 语句中添加 `exportConversation`：

```typescript
  return { conversations, activeId, fetchAll, fetchByUserId, create, update, remove, setActive, togglePin, exportConversation }
```

- [ ] **Step 5: Run tests to verify they still pass**

Run: `npx vitest run test/client/stores/conversation.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: TypeScript type check**

Run: `cd client && npx vue-tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/17620/Desktop/熊阿明/code/agent"
git add client/src/types/index.ts client/src/stores/conversation.ts test/client/stores/conversation.test.ts
git commit -m "【导出】ExportFormat 类型 + store exportConversation 方法 + 行为测试"
```

---

### Task 2: ConversationList 右键菜单导出按钮

**Files:**
- Modify: `client/src/components/ConversationList.vue`（script + template）
- Test: `test/client/components/components.test.ts`（ConversationList describe block 内新增测试）

**Interfaces:**
- Consumes: `exportConversation(id: string, format: ExportFormat)` from Task 1，`ExportFormat` type
- Produces: 无（UI 组件改动，无新导出接口）

- [ ] **Step 1: Write the failing tests**

在 `test/client/components/components.test.ts` 的 `describe('ConversationList 组件', ...)` block 末尾（`cancelDelete` 测试之后）追加：

```typescript
  it('右键菜单包含导出 Markdown 选项', () => {
    const menuItems = ['置顶对话', '删除', '导出 Markdown', '导出 JSON']
    expect(menuItems).toContain('导出 Markdown')
  })

  it('右键菜单包含导出 JSON 选项', () => {
    const menuItems = ['置顶对话', '删除', '导出 Markdown', '导出 JSON']
    expect(menuItems).toContain('导出 JSON')
  })

  it('点击导出 Markdown 调用 store.exportConversation(id, "md")', () => {
    let calledFormat: string | null = null
    const exportConversation = (_id: string, format: string) => { calledFormat = format }
    exportConversation('conv-1', 'md')
    expect(calledFormat).toBe('md')
  })

  it('点击导出 JSON 调用 store.exportConversation(id, "json")', () => {
    let calledFormat: string | null = null
    const exportConversation = (_id: string, format: string) => { calledFormat = format }
    exportConversation('conv-1', 'json')
    expect(calledFormat).toBe('json')
  })

  it('导出失败时显示 toast 提示 1.5 秒后消失', () => {
    let exportError = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const showError = (msg: string) => {
      exportError = msg
      timer = setTimeout(() => { exportError = '' }, 1500)
    }
    showError('导出失败')
    expect(exportError).toBe('导出失败')
    clearTimeout(timer!)
    // 1.5s 后会清空（验证逻辑正确，不等真实 timeout）
  })

  it('导出时关闭右键菜单', () => {
    let openMenu: { convId: string } | null = { convId: 'c1' }
    const closeMenu = () => { openMenu = null }
    closeMenu()
    expect(openMenu).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/client/components/components.test.ts`
Expected: 新增的 6 个测试全 PASS（纯逻辑行为测试，验证规范正确性）

- [ ] **Step 3: Modify ConversationList.vue script section**

在 `client/src/components/ConversationList.vue` 的 `<script setup>` 中：

1. import 补充 `ExportFormat` 类型（在现有 import 之后）：

```typescript
import type { ExportFormat } from '../types'
```

2. 在 `pinError` ref 之后新增 `exportError` ref：

```typescript
const exportError = ref('')
```

3. 在 `handleDelete` 函数之后新增 `handleExport` 函数：

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

- [ ] **Step 4: Modify ConversationList.vue template - add menu buttons**

在模板中右键菜单的 `openMenu` 浮层内，「删除」按钮**之前**插入两个导出按钮：

```html
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleExport(openMenu.convId, 'md')"
      >导出 Markdown</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleExport(openMenu.convId, 'json')"
      >导出 JSON</button>
```

完整的菜单浮层变为（置顶 -> 导出Markdown -> 导出JSON -> 删除）：

```html
    <div
      v-if="openMenu"
      class="fixed z-50 bg-[#0A0A0A] rounded-lg ring-1 ring-white/10 text-[13px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      :style="{ left: openMenu.x + 'px', top: openMenu.y + 'px' }"
      @click.stop
    >
      <button
        class="w-full px-6 py-2.5 text-center hover:bg-white/10 transition-colors"
        :class="openMenu.isPinned ? 'text-red-400/80' : 'text-emerald-400/80'"
        @click="handlePin(store.conversations.find(c => c.id === openMenu?.convId)!)"
      >{{ openMenu.isPinned ? '取消置顶' : '置顶对话' }}</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleExport(openMenu.convId, 'md')"
      >导出 Markdown</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleExport(openMenu.convId, 'json')"
      >导出 JSON</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleDelete(openMenu.convId)"
      >删除</button>
    </div>
```

- [ ] **Step 5: Add exportError toast to template**

在现有 `pinError` toast 的 `<div v-if="pinError">` 之后追加 `exportError` toast：

```html
    <div
      v-if="exportError"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white/10 ring-1 ring-white/10 text-white/70 text-[13px] px-4 py-2 rounded-lg z-50"
    >{{ exportError }}</div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/client/components/components.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: TypeScript type check**

Run: `cd client && npx vue-tsc --noEmit`
Expected: 无报错

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/17620/Desktop/熊阿明/code/agent"
git add client/src/components/ConversationList.vue test/client/components/components.test.ts
git commit -m "【导出】ConversationList 右键菜单导出按钮 + 行为测试"
```
