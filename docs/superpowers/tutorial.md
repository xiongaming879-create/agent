# Superpowers 完整使用教程

本教程详解如何使用 Superpowers 技能链进行开发，涵盖**新需求**、**修改已有需求**、**删除旧需求**三种场景。

---

## 目录

1. [核心概念](#1-核心概念)
2. [完整技能链流程图](#2-完整技能链流程图)
3. [场景一：开发新需求](#3-场景一开发新需求)
4. [场景二：修改已有需求](#4-场景二修改已有需求)
5. [场景三：删除旧需求](#5-场景三删除旧需求)
6. [场景四：成熟项目首次引入 SDD/TDD](#6-场景四成熟项目首次引入-sddtdd)
7. [TDD 在各场景中的操作细则](#7-tdd-在各场景中的操作细则)
8. [SDD 文档管理规范](#8-sdd-文档管理规范)
9. [技能速查表](#9-技能速查表)
10. [常见问题](#10-常见问题)

---

## 1. 核心概念

### SDD = Spec-Driven Development（规格驱动开发）

先写设计文档（Spec），再写实现计划（Plan），最后才写代码。每一层都要经过审查和批准。

### TDD = Test-Driven Development（测试驱动开发）

先写测试 → 看它失败 → 写最小代码通过 → 重构。红-绿-重构循环。

### 两者的关系

SDD 决定**做什么**（What），TDD 决定**怎么做**（How）。

```
SDD 流程:  brainstorming → spec → plan
TDD 流程:  red → green → refactor (在 plan 的每个 task 中执行)
```

### 关键文件路径

| 文件类型 | 路径模板 | 示例 |
|---------|---------|------|
| 设计文档 (Spec) | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `2026-06-18-conversation-pinning-design.md` |
| 实现计划 (Plan) | `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` | `2026-06-18-conversation-pinning.md` |

---

## 2. 完整技能链流程图

```
用户提出需求
    │
    ▼
┌──────────────────────┐
│  brainstorming       │  探索需求，逐步提问，提出 2-3 种方案
│  (必须第一个调用)     │  用户批准设计后 → 写 spec 文件
└──────────┬───────────┘
           │ spec 写完并经用户审核
           ▼
┌──────────────────────┐
│  writing-plans       │  把 spec 拆解为 bite-sized task
│  (每个 task 包含      │  每个 task 遵循 TDD: 先写测试再写实现
│   TDD 步骤)          │  计划写完并自审后 → 选择执行方式
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌──────────────────────┐
│ executing│ │ subagent-driven-     │
│ -plans   │ │ development (推荐)    │
│ (串行)   │ │ 每个 task 派 subagent │
└────┬─────┘ │ + 两阶段 review      │
     │       └──────────┬───────────┘
     │                  │
     └──────┬───────────┘
            │ 所有 task 完成
            ▼
┌──────────────────────┐
│  finishing-a-         │  验证测试 → 选择合并/PR/保留/丢弃
│  development-branch   │
└──────────┬───────────┘
           │
           ▼
      完成 ✅
```

---

## 3. 场景一：开发新需求

这是最完整的流程。以「对话置顶」功能为例。

### Step 1: 触发 brainstorming

告诉 Claude 你的需求，例如：

> 我想要对话置顶功能，重要的对话可以固定在列表顶部

Claude 会自动调用 `superpowers:brainstorming` 技能，然后：

1. **探索项目上下文** — Claude 检查现有代码、文档、最近提交
2. **一次问一个问题** — 逐步澄清需求细节
3. **提出 2-3 种方案** — 给出推荐和权衡
4. **分段呈现设计** — 每段确认后才继续
5. **写 spec 文件** — 保存到 `docs/superpowers/specs/`
6. **自审 spec** — 检查占位符、矛盾、歧义、范围
7. **你审核 spec** — 确认无误后进入下一步

#### Spec 文件示例（对话置顶）

Spec 文件保存在 `docs/superpowers/specs/2026-06-18-conversation-pinning-design.md`，内容大致如下：

- **Problem** — 对话列表按 updated_at 排序，重要对话容易被新对话淹没
- **数据层** — conversations 表新增 `is_pinned` 列，迁移语句 `ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT 0`，类型接口新增 `is_pinned: boolean`
- **API 行为** — PATCH 支持更新 `is_pinned` + 置顶上限 5；GET 按 `is_pinned DESC, updated_at DESC` 排序
- **前端交互** — 右键菜单置顶/取消置顶、图钉图标标识、置顶上限提示
- **Changes by File** — 列出每个需修改的文件及改动摘要

**关键点：** Spec 只描述 What（做什么），不描述 How（代码怎么写）。

### Step 2: 触发 writing-plans

Spec 审核通过后，Claude 自动调用 `superpowers:writing-plans`，将 spec 拆解为：

- **File Map** — 哪些文件要创建/修改，每个文件负责什么
- **Task** — 每个任务是一个 TDD 循环，2-5 分钟可完成
- **Step** — 每个 step 是一个原子操作

#### Plan 文件示例（对话置顶，截取 Task 1）

Plan 文件保存在 `docs/superpowers/plans/2026-06-18-conversation-pinning.md`，每个 Task 结构如下：

**Task: 数据库迁移与类型定义**

Files: `migrations.ts`, `types.ts`, `database.test.ts`

Step 1 — 写失败测试：

```typescript
it('新建对话默认 is_pinned 为 false', () => {
  const conv = createConversation()
  expect(conv.is_pinned).toBe(false)
})
```

Step 2 — 运行测试验证失败（`is_pinned` 属性不存在）

Step 3 — 在 `migrations.ts` 新增迁移 v8

Step 4 — 在 `types.ts` 新增 `is_pinned`

Step 5 — 更新 `db/index.ts` 列映射

Step 6 — 运行测试验证通过

Step 7 — Commit

**关键点：** 每个 Task 都遵循 TDD — 先红后绿，代码必须写在 step 里，不能有 TBD/TODO。

### Step 3: 执行计划

Plan 审核通过后，选择执行方式：

| 方式 | 适用场景 | 特点 |
|------|---------|------|
| **subagent-driven-development** (推荐) | 大多数情况 | 每个 task 派独立 subagent，两阶段 review |
| **executing-plans** | 简单/小型任务 | 串行执行，当前会话内 |

#### subagent-driven-development 执行流程

```
对每个 Task:
  1. 派 implementer subagent（执行 TDD + commit）
  2. 派 spec reviewer subagent（检查代码是否匹配 spec）
  3. 如有问题 → implementer 修复 → 重新 review
  4. 派 code quality reviewer subagent（检查代码质量）
  5. 如有问题 → implementer 修复 → 重新 review
  6. 标记 Task 完成
```

#### executing-plans 执行流程

```
1. 读取 plan 文件
2. 对每个 Task:
   a. 标记 in_progress
   b. 严格按 step 执行
   c. 运行验证命令
   d. 标记 completed
3. 全部完成后 → finishing-a-development-branch
```

### Step 4: finishing-a-development-branch

所有 task 完成后：

1. **验证测试通过** — 运行测试套件，失败则必须修复后才能继续
2. **选择收尾方式**：
   - 合并到主分支
   - 推送并创建 PR
   - 保留分支（稍后处理）
   - 丢弃工作

### 完整流程回顾

```
"我要对话置顶功能"
  → brainstorming (探索需求, 写 spec)
  → writing-plans (spec → TDD tasks)
  → subagent-driven-development (逐 task 执行 + review)
  → finishing-a-development-branch (验证 + 合并)
```

---

## 4. 场景二：修改已有需求

修改一个已经实现了的需求（例如调整置顶上限从 5 改为 10，或增加批量置顶）。

### Step 4.0: 文件定位（重要）

**Superpowers 不会自动定位到旧的 spec/plan/test 文件。**

当你说"大改置顶功能"时，brainstorming 的"探索项目上下文"步骤会读代码和文档，但不保证能精确找到 `docs/superpowers/specs/2026-06-18-conversation-pinning-design.md` 并关联起来。它更像是重新开始，而不是"定位旧 spec → 更新"。

**你需要在对话开头手动指定关键文件路径**，推荐话术：

> 修改对话置顶功能。原 spec 在 `docs/superpowers/specs/2026-06-18-conversation-pinning-design.md`，原 plan 在 `docs/superpowers/plans/2026-06-18-conversation-pinning.md`，请基于这些文件更新。

这样 Claude 就能在 brainstorming 阶段读到旧文档，进入"修改模式"而非从零开始。

| 文件 | 定位方式 |
|------|---------|
| **Spec** | 手动指定路径，或在 `docs/superpowers/specs/` 目录下按日期和关键词查找 |
| **Plan** | 手动指定路径，或从 spec 中引用（plan 头部通常有 `Spec:` 字段指向 spec） |
| **Test** | 从 plan 的各 Task 的 `Test:` 字段中找到对应测试文件 |

### Step 4.1: 评估修改范围

修改的幅度决定了需要回到流程的哪一步：

| 修改幅度 | 回退到哪一步 | 操作 |
|---------|------------|------|
| **纯 UI 微调**（颜色、文案、间距） | 直接改代码 | 小改动不需要走完整流程，但仍遵循 TDD |
| **行为调整**（改上限、改排序规则） | 更新 Spec → 更新 Plan | 修改 spec 中对应章节，更新 plan 中受影响的 task |
| **新增子功能**（批量置顶、置顶分组） | 回到 Brainstorming | 当作新需求处理 |
| **架构调整**（改数据库结构、改 API） | 回到 Brainstorming | 需要重新评估影响面 |

### Step 4.2: 更新 Spec

找到原 spec 文件，修改对应章节：

**修改前：** `PATCH /api/conversations/:id — 置顶上限 5`

**修改后：** `PATCH /api/conversations/:id — 置顶上限 10`

在 spec 文件末尾追加变更日志：

```markdown
## Changelog
- 2026-06-20: 置顶上限从 5 调整为 10
```

### Step 4.3: 更新 Plan

修改 plan 中受影响的 task：

1. **新增 task** — 如果修改引入了新的测试/实现步骤
2. **修改现有 task** — 更新测试断言、实现代码
3. **标记已完成的 task** — 已完成且不受影响的 task 不动

例如，置顶上限从 5 改为 10 时，更新 Task 3 中对应的测试断言：

```typescript
// 测试断言从 5 改为 10
it('已置顶 10 个时再置顶 → 拒绝', () => {
  expect(pinLimitCheck(10, 10).allowed).toBe(false)
})
```

### Step 4.4: TDD 更新策略

修改已有功能时，TDD 的操作如下：

1. **先写/修改失败测试，验证当前行为**
   - 如果修改行为：写新测试覆盖新行为 → 看它失败
   - 如果修复 bug：写测试复现 bug → 看它失败

2. **修改实现代码让测试通过**

3. **运行全量测试确认无回归**

4. **如果旧测试与新行为冲突**：
   - 更新旧测试（行为确实改了）
   - 不要删除旧测试（除非功能完全移除）

### Step 4.5: 执行修改

和场景一一样，选择 subagent-driven-development 或 executing-plans 执行修改后的 plan。

---

## 5. 场景三：删除旧需求

完全移除一个已有功能（例如移除对话导出功能）。

### Step 5.1: 评估删除影响

| 问题 | 需要检查的 |
|------|-----------|
| 哪些文件引用了这个功能？ | Grep 搜索功能名/路由/API |
| 哪些测试测试了这个功能？ | Grep 搜索测试文件 |
| 删除后是否有其他功能依赖？ | 检查 import/调用链 |
| 数据库表/列是否需要清理？ | 检查迁移和 schema |

### Step 5.2: 更新 Spec

找到原 spec 文件，标记为已废弃。在标题后追加 `(DEPRECATED)`，在顶部添加移除说明：

```markdown
# Export Design (DEPRECATED)

> 此功能已于 2026-06-20 移除。见删除 plan: docs/superpowers/plans/2026-06-20-remove-export.md
```

原内容保留但标记划掉，便于历史追溯。

### Step 5.3: 写删除 Plan

删除也需要写 plan，同样遵循 TDD（先写测试验证删除后行为）。

**Task: 移除导出路由**

Files: `conversation.ts`, `conversation.test.ts`

Step 1 — 写测试验证导出路由不存在：

```typescript
it('导出路由返回 404', async () => {
  const res = await request(app).get('/api/conversations/abc/export?format=json')
  expect(res.status).toBe(404)
})
```

Step 2 — 运行测试验证失败（路由还存在，返回 200）

Step 3 — 删除导出路由代码

Step 4 — 运行测试验证通过

Step 5 — 删除导出相关测试用例（避免测试引用已删代码）

Step 6 — 运行全量测试确认无回归

Step 7 — Commit

### Step 5.4: 数据库列的删除

**项目 CLAUDE.md 约定：数据库迁移只能增不能删。**

如果需要删除列：
1. 在代码中停止使用该列（从 SELECT、INSERT、UPDATE 中移除）
2. 不执行 `ALTER TABLE DROP COLUMN`
3. 在 spec 中注明该列已废弃但保留在 schema 中

### Step 5.5: 执行删除

同场景一，用 subagent-driven-development 或 executing-plans 执行。

---

## 6. 场景四：成熟项目首次引入 SDD/TDD

项目已经开发了一段时间，有大量存量代码但没有 spec 文档和测试，现在要引入 SDD/TDD。

### 核心原则：渐进式引入，不追求一步到位

不要试图一次性为所有存量代码补齐 spec 和测试。这既不现实也不经济。正确的做法是**先搭骨架，再按需填充**。

### Step 6.1: 写项目骨架 Spec

先写一个覆盖全局的骨架 spec，只描述架构、数据模型、核心流程，不深入每个功能的细节。

**骨架 spec 应包含：**

1. **架构概述** — 技术栈、分层结构、模块划分
2. **数据模型** — 核心表结构、字段含义、关系
3. **核心数据流** — 主要用户操作的端到端流程
4. **API 端点清单** — 路由 + 方法 + 简要说明（不需要详细行为描述）
5. **已知约束和陷阱** — 项目中的特殊限制、已知的坑

**骨架 spec 不需要包含：**

- 每个功能的详细行为描述（碰到了再补）
- 前端组件的详细交互设计（碰到了再补）
- 边界条件和错误处理细节（碰到了再补）

**示例骨架结构：**

```markdown
# 项目骨架 Spec

## 架构
Vue 3 + Express + sql.js，前端 Pinia 状态管理，后端 ReAct Agent 模式。

## 数据模型
- conversations: id, title, system_prompt, created_at, updated_at
- messages: id, conversation_id, parent_id, role, content, thought_steps

## 核心数据流
用户输入 → POST /messages → runAgent (ReAct 循环) → SSE → 前端渲染

## API 端点
- GET/POST/PATCH/DELETE /api/conversations
- GET/POST /api/conversations/:id/messages
- PATCH /api/conversations/:id/messages/:mid (分支)
```

这个骨架 spec 可以直接基于项目的 CLAUDE.md 或 README 提炼，不需要走 brainstorming 流程。

### Step 6.2: 为核心路径补测试

**优先级从高到低：**

| 优先级 | 层级 | 示例 | 原因 |
|-------|------|------|------|
| P0 | 数据层 | `db/index.ts` CRUD 操作 | 所有功能的基础，回归影响面最大 |
| P1 | 服务层 | `agent.ts` ReAct 循环 | 核心业务逻辑，改动频繁 |
| P2 | 路由层 | `conversation.ts` API 端点 | 依赖数据层，数据层有测试后容易补 |
| P3 | 工具层 | `search.ts`, `filesystem.ts` | 独立模块，可单独补 |
| P4 | 前端 | stores, components | 依赖后端，且 UI 测试投入产出比低，暂缓 |

**补测试的方式 — "描述当前行为"：**

为存量代码补测试时，测试描述的是**当前实际行为**（不是期望行为），目的是：

1. 锁定当前行为作为基线
2. 未来修改时能检测回归
3. 逐步进入 TDD 节奏

```typescript
// 存量代码补测试：描述当前实际行为
it('getConversations 返回所有对话，按 updated_at 降序', () => {
  createConversation('A')
  createConversation('B')
  const list = getConversations()
  expect(list.length).toBe(2)
  expect(list[0].title).toBe('B')  // 后创建的排前面
})
```

**注意：** 这不是 TDD（测试不是先写的），但它是引入 TDD 的前序步骤。补完基线测试后，后续修改就能走标准 TDD 了。

### Step 6.3: 新需求走完整 SDD/TDD 流程

骨架 spec 和核心路径测试就位后，**所有新需求**严格走完整流程：

```
brainstorming → 写功能 spec（补充到骨架 spec 中或创建独立 spec）→ writing-plans → 执行
```

新需求的 spec 可以：
- 创建独立文件 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- 或在骨架 spec 中追加章节

独立文件更适合大功能，骨架 spec 追加更适合小功能。

### Step 6.4: 改存量代码时按需补 spec 和测试

修改存量代码时，顺势补上对应的 spec 和测试：

```
改 db/index.ts → 先补数据层测试 → 再走 TDD 修改
改 agent.ts    → 先补 ReAct 循环测试 → 再走 TDD 修改
改 routes/     → 先补路由测试 → 再走 TDD 修改
```

**原则：改到哪里，测试补到哪里，spec 补到哪里。**

不需要一次性补全所有功能的 spec 和测试，随着改动自然生长即可。

### 渐进式路线图

```
第 1 周: 写骨架 spec + 核心路径 P0 测试（数据层）
         ↓
第 2 周: P1 测试（服务层）+ 第一个新需求走完整 SDD/TDD
         ↓
第 3 周: P2 测试（路由层）+ 继续新需求走 SDD/TDD
         ↓
后续:    改存量代码时按需补测试和 spec，新需求严格走 SDD/TDD
         ↓
结果:    spec 和测试随项目演进自然生长，最终实现全覆盖
```

### 关键心态

- **不要追求完美覆盖** — 80% 的价值来自 20% 的测试，先补核心路径
- **不要停发补齐再开发** — 存量测试和新需求开发可以并行
- **新需求必须严格走 SDD/TDD** — 这是从现在开始的红线，存量可以慢慢补
- **补 spec 不是写小说** — 骨架 spec 一页纸就够，细节碰到再补

---

## 7. TDD 在各场景中的操作细则

### 核心铁律

```
没有失败的测试，就没有生产代码
```

### 红绿重构循环

```
RED       → 写一个最小测试，描述期望行为
验证 RED  → 运行测试，确认它因为功能缺失而失败（不是语法错误）
GREEN     → 写最小代码让测试通过
验证 GREEN → 运行测试，确认通过 + 其他测试不被破坏
REFACTOR  → 清理（去重、改善命名、提取函数），保持测试通过
重复       → 下一个测试
```

### 新需求中的 TDD

```typescript
// RED: 写测试（功能还不存在）
it('新建对话默认 is_pinned 为 false', () => {
  const conv = createConversation()
  expect(conv.is_pinned).toBe(false)
})
// → 运行: FAIL (is_pinned 不存在)

// GREEN: 写最小实现
// types.ts: is_pinned: boolean
// db/index.ts: is_pinned: row[6] === 1
// → 运行: PASS

// REFACTOR: 如果需要提取公共逻辑
```

### 修改需求中的 TDD

```typescript
// 修改前: 置顶上限 5
// 修改后: 置顶上限 10

// RED: 修改测试断言
it('已置顶 9 个时再置顶 → 允许', () => {
  expect(pinLimitCheck(9, 10).allowed).toBe(true)  // 之前 4→允许, 现在 9→允许
})
// → 运行: FAIL (当前上限还是 5)

// GREEN: 修改实现
const PIN_LIMIT = 10  // 从 5 改为 10
// → 运行: PASS

// 全量测试: 确认其他测试不回归
```

### 删除需求中的 TDD

```typescript
// RED: 写测试验证功能已不存在
it('导出路由返回 404', async () => {
  const res = await request(app).get('/api/conversations/abc/export?format=json')
  expect(res.status).toBe(404)
})
// → 运行: FAIL (路由还在，返回 200)

// GREEN: 删除路由代码
// → 运行: PASS

// 清理: 删除导出相关的旧测试（它们引用的代码已不存在）
```

### Bug 修复中的 TDD

```typescript
// RED: 写测试复现 bug
it('空邮箱不应被接受', async () => {
  const result = await submitForm({ email: '' })
  expect(result.error).toBe('Email required')
})
// → 运行: FAIL (当前接受了空邮箱)

// GREEN: 修复 bug
if (!data.email?.trim()) {
  return { error: 'Email required' }
}
// → 运行: PASS

// 回归验证: 确认正常邮箱仍然通过
```

### TDD 反模式（必须避免）

| 反模式 | 正确做法 |
|-------|---------|
| 先写实现再补测试 | 先写测试，看它失败 |
| 测试通过后跳过验证 | 每步都必须运行测试验证 |
| 一次性写多个测试 | 一次一个测试，红绿循环 |
| 测试写得太宽泛 | 一个测试验证一个行为 |
| 过度 mock | 尽量测试真实代码 |
| 为了通过测试改测试 | 测试失败时改实现代码 |

---

## 8. SDD 文档管理规范

### Spec 文件格式

```markdown
# [Feature Name] Design

## Problem
为什么需要这个功能？当前有什么痛点？

## Design
### [子模块 1]
- 具体行为描述

### [子模块 2]
- 具体行为描述

## Changes by File
### server/src/xxx.ts
改动摘要

### client/src/xxx.vue
改动摘要

## What This Enables
这个功能带来的价值

## What This Drops
这个功能移除了什么（如有）

## Changelog
- YYYY-MM-DD: 变更描述
```

### Plan 文件格式

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 一句话目标

**Architecture:** 2-3 句架构描述

**Tech Stack:** 关键技术

**Spec:** 指向 spec 文件的路径

---

## File Map
| File | Action | Responsibility |
|------|--------|---------------|
| path/to/file | Create/Modify | 职责描述 |

---

## Chunk N: [模块名]

### Task N: [组件名]

**Files:**
- Create/Modify: exact/path/to/file
- Test: exact/path/to/test

- [ ] **Step 1: 写失败测试**
(完整测试代码)

- [ ] **Step 2: 运行测试验证失败**
Run: command
Expected: FAIL reason

- [ ] **Step 3: 写最小实现**
(完整实现代码)

- [ ] **Step 4: 运行测试验证通过**
Run: command
Expected: PASS

- [ ] **Step 5: Commit**
```

### 文档生命周期

```
新需求:  不存在 → brainstorming 创建 spec → writing-plans 创建 plan → 实现
修改需求: spec 存在 → 更新 spec 对应章节 → 更新 plan 受影响的 task → 实现
删除需求: spec 存在 → 标记 spec 为 DEPRECATED → 创建删除 plan → 实现
```

### Plan 中禁止出现的占位符

以下内容是 **plan 失败**，绝对不能写：

- `TBD`、`TODO`、`implement later`、`fill in details`
- `Add appropriate error handling`（没有具体代码）
- `Write tests for the above`（没有具体测试代码）
- `Similar to Task N`（必须重复代码，因为 subagent 可能乱序执行）
- 只描述做什么但不展示代码的 step

---

## 9. 技能速查表

### 核心流程技能

| 技能名 | 何时调用 | 做什么 |
|-------|---------|-------|
| `superpowers:brainstorming` | 收到新需求/大改动 | 探索需求 → 设计 → 写 spec |
| `superpowers:writing-plans` | spec 审核通过后 | spec → bite-sized TDD tasks |
| `superpowers:subagent-driven-development` | plan 写完，选择推荐执行方式 | 每 task 派 subagent + 两阶段 review |
| `superpowers:executing-plans` | plan 写完，选择串行执行 | 串行执行 task |
| `superpowers:finishing-a-development-branch` | 所有 task 完成 | 验证测试 → 合并/PR/保留/丢弃 |

### 质量保证技能

| 技能名 | 何时调用 | 做什么 |
|-------|---------|-------|
| `superpowers:test-driven-development` | 写任何功能/修复代码时 | 红-绿-重构循环 |
| `superpowers:verification-before-completion` | 声称完成之前 | 必须有证据才能说完成了 |
| `superpowers:requesting-code-review` | 需要代码审查时 | 请求审查模板 |
| `superpowers:receiving-code-review` | 收到审查反馈时 | 处理审查反馈 |

### 辅助技能

| 技能名 | 何时调用 | 做什么 |
|-------|---------|-------|
| `superpowers:using-git-worktrees` | 需要隔离工作区时 | 创建/管理 git worktree |
| `superpowers:systematic-debugging` | 遇到 bug 时 | 系统化调试 |
| `superpowers:dispatching-parallel-agents` | 需要并行处理独立任务时 | 派发多个并行 subagent |

### 技能调用顺序

```
1. brainstorming        ← 起点，所有新需求必须先走这步
2. writing-plans        ← brainstorming 的唯一出口
3. subagent-driven-dev  ← writing-plans 的出口之一（推荐）
   或 executing-plans   ← writing-plans 的出口之一
4. finishing-a-dev-branch ← 执行完的出口
```

**brainstorming 之后只能调用 writing-plans**，不能直接跳到实现。

---

## 10. 常见问题

### Q: 小改动也需要走完整流程吗？

纯 UI 微调（颜色、间距、文案）可以直接改代码，但仍建议遵循 TDD。如果改动可能影响行为，至少走 writing-plans。

### Q: 我已经有明确的设计，还需要 brainstorming 吗？

需要。brainstorming 不仅帮你设计，还帮你检查假设、发现遗漏。即使你很确定，至少过一遍简短的 brainstorming 确认没有盲点。

### Q: spec 和 plan 有什么区别？

- **Spec**: 描述 **What** — 功能应该做什么，用户看到什么行为
- **Plan**: 描述 **How** — 具体改哪些文件、写什么代码、测试怎么写

### Q: 修改已有功能时，需要重写整个 plan 吗？

不需要。只更新受影响的 task 和 step，已完成的 task 不动。在 plan 文件中用删除线标记被替换的 step。

### Q: 删除功能时，TDD 怎么做？

写测试验证功能已不存在（如：路由返回 404），看它失败（因为路由还在），删除代码，看测试通过。然后清理旧测试。

### Q: subagent-driven-development 和 executing-plans 怎么选？

- **subagent-driven**（推荐）：每个 task 有独立 subagent + 两阶段 review，质量更高
- **executing-plans**：简单任务串行执行，更快但无独立 review

### Q: verification-before-completion 什么时候用？

**任何声称完成之前**。说"测试通过了"之前，必须刚刚运行过测试命令并看到了输出。说"功能完成了"之前，必须验证过代码确实做了 spec 里说的事。

### Q: 已有的代码没有测试，怎么加？

为已有代码加测试时，先写测试描述当前行为（不是期望行为），确认测试通过。然后再按 TDD 循环修改行为。

### Q: 数据库列能删吗？

**项目约定：不能。** 迁移只能 ADD COLUMN / CREATE TABLE IF NOT EXISTS。如果列不再使用，在代码中停止引用它，但不执行 DROP COLUMN。
