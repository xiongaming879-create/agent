# Conversation Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增对话置顶功能，置顶对话固定在列表顶部，上限 5 个，三点图标下拉菜单交互。

**Architecture:** 数据库新增 is_pinned 列（迁移 v8），后端 CRUD 和排序支持，PATCH 路由校验置顶上限，前端 ConversationList 三点图标下拉菜单 + 图钉图标。

**Tech Stack:** sql.js, Express, Pinia, Vue 3, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-06-18-conversation-pinning-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/db/migrations.ts` | Modify | 新增迁移 v8: add_conversation_is_pinned |
| `server/src/types.ts` | Modify | Conversation 接口加 is_pinned |
| `server/src/db/index.ts` | Modify | CONV_COLS 加 is_pinned, rowToConversation 映射, 排序, updateConversation 支持 is_pinned |
| `server/src/routes/conversation.ts` | Modify | PATCH 支持 is_pinned + 上限校验, GET 排序 |
| `client/src/types/index.ts` | Modify | 前端 Conversation 类型加 is_pinned |
| `client/src/stores/conversation.ts` | Modify | update 函数支持 is_pinned, 新增 togglePin 方法 |
| `client/src/components/ConversationList.vue` | Modify | 三点图标下拉菜单 + 图钉图标 |
| `test/server/db/database.test.ts` | Modify | is_pinned 数据库测试 |
| `test/server/routes/conversation.test.ts` | Modify | 置顶上限校验测试 |
| `test/client/stores/conversation.test.ts` | Modify | 置顶排序测试 |

---

## Chunk 1: 后端数据层

### Task 1: 数据库迁移与类型定义

**Files:**
- Modify: `server/src/db/migrations.ts`
- Modify: `server/src/types.ts`
- Test: `test/server/db/database.test.ts`

- [ ] **Step 1: 写失败测试 — is_pinned 字段不存在**

在 `test/server/db/database.test.ts` 的「数据库 — 对话 CRUD」describe 块末尾追加：

```typescript
it('新建对话默认 is_pinned 为 false', () => {
  const conv = createConversation()
  expect(conv.is_pinned).toBe(false)
})

it('可更新 is_pinned 为 true', () => {
  const conv = createConversation()
  updateConversation(conv.id, { is_pinned: true })
  const updated = getConversation(conv.id)
  expect(updated?.is_pinned).toBe(true)
})

it('可更新 is_pinned 为 false', () => {
  const conv = createConversation()
  updateConversation(conv.id, { is_pinned: true })
  updateConversation(conv.id, { is_pinned: false })
  const updated = getConversation(conv.id)
  expect(updated?.is_pinned).toBe(false)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/server/db/database.test.ts`
Expected: FAIL — `is_pinned` 属性在 Conversation 类型和数据库中不存在

- [ ] **Step 3: 在 migrations.ts 新增迁移 v8**

在 `server/src/db/migrations.ts` 的 `migrations` 数组末尾追加：

```typescript
{
  version: 8,
  name: 'add_conversation_is_pinned',
  up: `ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT 0`,
},
```

- [ ] **Step 4: 在 types.ts 的 Conversation 接口新增 is_pinned**

在 `server/src/types.ts` 的 `Conversation` 接口中，在 `user_id` 后追加：

```typescript
is_pinned: boolean
```

- [ ] **Step 5: 在 db/index.ts 更新列映射**

在 `server/src/db/index.ts` 中：

1. `CONV_COLS` 改为：
```typescript
const CONV_COLS = 'id, title, system_prompt, created_at, updated_at, user_id, is_pinned'
```

2. `rowToConversation` 函数改为：
```typescript
function rowToConversation(row: unknown[]): Conversation {
  return {
    id: row[0] as string,
    title: row[1] as string,
    system_prompt: row[2] as string | null,
    created_at: row[3] as string,
    updated_at: row[4] as string,
    user_id: (row[5] as string | null) ?? null,
    is_pinned: row[6] === 1,
  }
}
```

3. `createConversation` 返回值加 `is_pinned: false`

4. `updateConversation` 的类型签名和实现支持 `is_pinned`：
```typescript
export function updateConversation(id: string, data: Partial<Pick<Conversation, 'title' | 'system_prompt' | 'user_id' | 'is_pinned'>>): void {
```
在 sets 构建中追加：
```typescript
if (data.is_pinned !== undefined) { sets.push('is_pinned = ?'); values.push(data.is_pinned ? 1 : 0) }
```

- [ ] **Step 6: 运行测试验证通过**

Run: `npx vitest run test/server/db/database.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/db/migrations.ts server/src/types.ts server/src/db/index.ts test/server/db/database.test.ts
git commit -m "【新需求】数据库新增 is_pinned 字段和迁移"
```

### Task 2: 排序逻辑

**Files:**
- Modify: `server/src/db/index.ts`
- Test: `test/server/db/database.test.ts`

- [ ] **Step 1: 写失败测试 — 置顶对话排在前面**

在 `test/server/db/database.test.ts` 新增 describe 块：

```typescript
describe('数据库 — 置顶排序', () => {
  beforeEach(async () => {
    resetDb()
    await initDb()
    const convs = getConversations()
    for (const c of convs) deleteConversation(c.id)
  })

  it('置顶对话排在非置顶对话前面', () => {
    createConversation('普通对话A')
    const pinned = createConversation('置顶对话')
    createConversation('普通对话B')
    updateConversation(pinned.id, { is_pinned: true })
    const list = getConversations()
    expect(list[0].id).toBe(pinned.id)
    expect(list[0].is_pinned).toBe(true)
  })

  it('多个置顶对话之间按 updated_at 降序', () => {
    const p1 = createConversation('置顶1')
    const p2 = createConversation('置顶2')
    updateConversation(p1.id, { is_pinned: true })
    updateConversation(p2.id, { is_pinned: true })
    // p2 更新时间更新（因为后创建）
    const list = getConversations()
    expect(list[0].id).toBe(p2.id)
    expect(list[1].id).toBe(p1.id)
  })

  it('getConversationsByUserId 也按置顶优先排序', () => {
    const userId = 'user-pin-test'
    const normal = createConversation('普通', null, userId)
    const pinned = createConversation('置顶', null, userId)
    updateConversation(pinned.id, { is_pinned: true })
    const list = getConversationsByUserId(userId)
    expect(list[0].id).toBe(pinned.id)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/server/db/database.test.ts`
Expected: FAIL — 当前排序仅按 updated_at，置顶对话不会排在前面

- [ ] **Step 3: 修改排序逻辑**

在 `server/src/db/index.ts` 中：

1. `getConversations` 的 SQL 改为：
```typescript
const result = db.exec(`SELECT ${CONV_COLS} FROM conversations ORDER BY is_pinned DESC, updated_at DESC`)
```

2. `getConversationsByUserId` 的两个 SQL 都改为：
```typescript
// userId 非 null
db.exec(`SELECT ${CONV_COLS} FROM conversations WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC`, [userId])
// userId 为 null
db.exec(`SELECT ${CONV_COLS} FROM conversations WHERE user_id IS NULL ORDER BY is_pinned DESC, updated_at DESC`)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/server/db/database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/index.ts test/server/db/database.test.ts
git commit -m "【新需求】数据库查询支持置顶优先排序"
```

---

## Chunk 2: 后端路由

### Task 3: PATCH 路由支持置顶 + 上限校验

**Files:**
- Modify: `server/src/routes/conversation.ts`
- Modify: `server/src/db/index.ts`
- Test: `test/server/routes/conversation.test.ts`

- [ ] **Step 1: 写失败测试 — 置顶上限校验**

在 `test/server/routes/conversation.test.ts` 新增 describe 块：

```typescript
describe('置顶上限校验 — pinLimitCheck 逻辑', () => {
  function pinLimitCheck(pinnedCount: number, limit: number): { allowed: boolean; message?: string } {
    if (pinnedCount >= limit) {
      return { allowed: false, message: '最多置顶 5 个对话' }
    }
    return { allowed: true }
  }

  it('已置顶 5 个时再置顶 → 拒绝', () => {
    expect(pinLimitCheck(5, 5).allowed).toBe(false)
    expect(pinLimitCheck(5, 5).message).toBe('最多置顶 5 个对话')
  })

  it('已置顶 4 个时再置顶 → 允许', () => {
    expect(pinLimitCheck(4, 5).allowed).toBe(true)
  })

  it('取消置顶时无需校验上限', () => {
    // is_pinned: false 的操作不受限制
    expect(pinLimitCheck(5, 5).allowed).toBe(false)
    // 但取消置顶走不同分支，不调用 pinLimitCheck
  })
})
```

- [ ] **Step 2: 运行测试验证通过（纯逻辑测试）**

Run: `npx vitest run test/server/routes/conversation.test.ts`
Expected: PASS（纯逻辑函数，不依赖路由）

- [ ] **Step 3: 在 db/index.ts 新增 countPinnedConversations 函数**

```typescript
export function countPinnedConversations(userId: string): number {
  const db = getDb()
  const result = db.exec(
    `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND is_pinned = 1`,
    [userId]
  )
  return (result[0]?.values[0]?.[0] as number) ?? 0
}
```

- [ ] **Step 4: 在 conversation.ts PATCH 路由增加 is_pinned 支持和上限校验**

在 `server/src/routes/conversation.ts` 中：

1. 顶部 import 追加 `countPinnedConversations`

2. 修改 PATCH 路由处理函数，将 `const { title, system_prompt } = req.body || {}` 改为：
```typescript
const { title, system_prompt, is_pinned } = req.body || {}
```

3. 在 `claimOrphan` 调用之后、`updateConversation` 之前追加校验：
```typescript
if (is_pinned === true) {
  const pinnedCount = countPinnedConversations(req.user!.userId)
  if (pinnedCount >= 5) {
    res.status(400).json({ error: '最多置顶 5 个对话' })
    return
  }
}
updateConversation(req.params.id, { title, system_prompt, is_pinned })
```

- [ ] **Step 5: 在 GET / 路由中确保合并后的列表按置顶排序**

当前合并逻辑（用户对话 + 无主对话）后未排序。在 `res.json(merged)` 前追加排序：

```typescript
merged.sort((a, b) => {
  if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
})
```

- [ ] **Step 6: 运行全量后端测试**

Run: `npx vitest run test/server/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/conversation.ts server/src/db/index.ts test/server/routes/conversation.test.ts
git commit -m "【新需求】PATCH 路由支持置顶 + 上限校验 + 合并列表排序"
```

---

## Chunk 3: 前端类型与 Store

### Task 4: 前端类型和 Store 更新

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/stores/conversation.ts`
- Test: `test/client/stores/conversation.test.ts`

- [ ] **Step 1: 写失败测试 — 置顶排序**

在 `test/client/stores/conversation.test.ts` 新增 describe 块：

```typescript
describe('对话状态 — 置顶排序', () => {
  it('is_pinned 为 true 的对话排在前面', () => {
    const conversations: Conversation[] = [
      { id: 'c1', title: '普通', system_prompt: null, user_id: null, is_pinned: false, created_at: '2024-06-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
      { id: 'c2', title: '置顶', system_prompt: null, user_id: null, is_pinned: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
      { id: 'c3', title: '普通2', system_prompt: null, user_id: null, is_pinned: false, created_at: '2024-05-01T00:00:00Z', updated_at: '2024-05-01T00:00:00Z' },
    ]
    const sorted = [...conversations].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
    expect(sorted[0].id).toBe('c2')
    expect(sorted[0].is_pinned).toBe(true)
  })

  it('多个置顶对话之间按 updated_at 降序', () => {
    const conversations: Conversation[] = [
      { id: 'c1', title: '置顶旧', system_prompt: null, user_id: null, is_pinned: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
      { id: 'c2', title: '置顶新', system_prompt: null, user_id: null, is_pinned: true, created_at: '2024-06-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
      { id: 'c3', title: '普通', system_prompt: null, user_id: null, is_pinned: false, created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z' },
    ]
    const sorted = [...conversations].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
    expect(sorted[0].id).toBe('c2')
    expect(sorted[1].id).toBe('c1')
  })
})
```

注意：测试文件顶部的 `Conversation` interface 需要新增 `is_pinned: boolean` 字段。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/client/stores/conversation.test.ts`
Expected: FAIL — Conversation 接口缺少 is_pinned

- [ ] **Step 3: 在 client/src/types/index.ts 的 Conversation 接口追加 is_pinned**

```typescript
is_pinned: boolean
```

追加在 `user_id` 之后。

- [ ] **Step 4: 更新 client/src/stores/conversation.ts**

1. `update` 函数签名改为支持 `is_pinned`：
```typescript
async function update(id: string, data: Partial<Pick<Conversation, 'title' | 'system_prompt' | 'is_pinned'>>) {
```

2. 新增 `togglePin` 方法：
```typescript
async function togglePin(id: string, isPinned: boolean) {
  const res = await authFetch(`${API}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_pinned: isPinned }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || '操作失败')
  }
  const idx = conversations.value.findIndex(c => c.id === id)
  if (idx !== -1) {
    const updated = await res.json()
    Object.assign(conversations.value[idx], updated)
    // 前端按后端返回顺序展示，无需额外排序
    await fetchAll()
  }
}
```

3. 在 return 中导出 `togglePin`

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run test/client/stores/conversation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/types/index.ts client/src/stores/conversation.ts test/client/stores/conversation.test.ts
git commit -m "【新需求】前端类型和 Store 支持 is_pinned"
```

---

## Chunk 4: 前端 UI

### Task 5: ConversationList 三点图标下拉菜单 + 图钉图标

**Files:**
- Modify: `client/src/components/ConversationList.vue`

- [ ] **Step 1: 新增三点菜单状态**

在 `<script setup>` 中追加：

```typescript
const openMenu = ref<{ convId: string; x: number; y: number; isPinned: boolean } | null>(null)
const pinError = ref('')

function toggleMenu(e: MouseEvent, conv: Conversation) {
  e.stopPropagation()
  if (openMenu.value?.convId === conv.id) {
    openMenu.value = null
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu.value = { convId: conv.id, x: rect.left, y: rect.bottom + 4, isPinned: conv.is_pinned }
}

function closeMenu() {
  openMenu.value = null
}

async function handlePin(conv: Conversation) {
  closeMenu()
  try {
    await store.togglePin(conv.id, !conv.is_pinned)
  } catch (err: unknown) {
    pinError.value = err instanceof Error ? err.message : '操作失败'
    setTimeout(() => { pinError.value = '' }, 1500)
  }
}

function handleDelete(convId: string) {
  closeMenu()
  deleteTargetId.value = convId
  showDeleteConfirm.value = true
}
```

- [ ] **Step 2: 替换 × 删除按钮为三点图标，添加图钉图标和标题对齐**

移除现有的 `<button>&times;</button>`，替换为三点图标按钮（hover 时显示）。在标题前添加图钉图标（置顶时显示）和等宽占位符（未置顶时）：

```html
<div class="flex items-center justify-between">
  <div class="flex items-center min-w-0">
    <svg v-if="conv.is_pinned" class="w-3.5 h-3.5 mr-1.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/></svg>
    <span v-else class="w-[20px] shrink-0"></span>
    <span class="truncate">{{ conv.title }}</span>
  </div>
  <button
    class="opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-400 hover:text-white ml-2 shrink-0"
    @click="toggleMenu($event, conv)"
  >
    <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
  </button>
</div>
```

- [ ] **Step 3: 在模板末尾添加下拉菜单和错误提示**

```html
<!-- Dropdown Menu -->
<div
  v-if="openMenu"
  class="fixed z-50 bg-sidebar rounded-btn shadow-xl border border-neutral-600 text-sm overflow-hidden"
  :style="{ left: openMenu.x + 'px', top: openMenu.y + 'px' }"
  @click.stop
>
  <button
    class="w-full px-6 py-2 text-center hover:bg-neutral-700 transition-colors"
    :class="openMenu.isPinned ? 'text-red-400' : 'text-emerald-400'"
    @click="handlePin(store.conversations.find(c => c.id === openMenu?.convId)!)"
  >{{ openMenu.isPinned ? '取消置顶' : '置顶对话' }}</button>
  <button
    class="w-full px-6 py-2 text-center text-neutral-300 hover:bg-neutral-700 transition-colors"
    @click="handleDelete(openMenu.convId)"
  >删除</button>
</div>

<!-- Pin Error Toast -->
<div
  v-if="pinError"
  class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded-bubble z-50"
>{{ pinError }}</div>
```

- [ ] **Step 4: 点击空白关闭菜单**

在容器 `<div>` 上添加 `@click="closeMenu"`，三点按钮添加 `@click.stop` 防止冒泡。无需 `onMounted`/`onUnmounted`。

- [ ] **Step 5: 手动验证**

Run: `cd client && npm run dev` + `cd server && npm run dev`
Expected: hover 对话项显示三点图标，点击弹出下拉菜单含"置顶对话"和"删除"，置顶后显示图钉图标，删除仍弹确认弹窗

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ConversationList.vue
git commit -m "【新需求】ConversationList 三点图标下拉菜单 + 图钉图标"
```

---

## Chunk 5: 更新设计文档索引

### Task 6: 更新 SPEC.md 索引

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: 在 SPEC.md 功能设计文档表格中追加置顶行**

在表格末尾追加：

```markdown
| 对话置顶 | [design](docs/superpowers/specs/2026-06-18-conversation-pinning-design.md) | [plan](docs/superpowers/plans/2026-06-18-conversation-pinning.md) |
```

- [ ] **Step 2: Commit**

```bash
git add SPEC.md
git commit -m "【新需求】SPEC 索引追加对话置顶功能"
```
