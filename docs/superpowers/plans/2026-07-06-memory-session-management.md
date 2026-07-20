# Memory 会话管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

## 版本记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-07-06 | 初版：Phase 1-5，建表 + 抽取 + 晋升 + 召回 |
| v1.1 | 2026-07-20 | 修复 L1-L5：parseResponse 容错、标准化 callLLM、user_preference 单会话提升、recall 读 candidates、durable 判定标准 |

**Goal:** 为 ReAct Agentic AI Chat 项目增加跨会话记忆能力，实现会话结束后记忆抽取、跨会话晋升、召回注入 system prompt 三条核心流程。v1.1 修复单次声明偏好未被记住的五层问题（L1-L5）。

**Architecture:** 独立 `memory.db` sql.js 文件存储 3 张表（memory_episodes / memory_candidates / memory_rules），LLM 驱动记忆抽取和候选合并，确定性规则决定晋升，活跃规则 + 近期 user_preference 候选全量注入 Agent system prompt。

**Tech Stack:** sql.js (WASM SQLite), Anthropic API (LLM 调用 via `llm-caller.callLLM`), Node.js/Express/TypeScript, Vitest

## Global Constraints

- 独立 `server/data/memory.db` 文件，与 `agent.db` 共享 sql.js WASM 实例但独立 Database 对象
- 记忆抽取和晋升调用 LLM，统一走 `llm-caller.callLLM`（`system` 顶层字段，v1.1 修复 L5）
- 所有新增表使用 `CREATE TABLE IF NOT EXISTS` 迁移策略
- 记忆抽取触发在 SSE done 事件后，不阻塞用户响应（fire-and-forget）
- 记忆抽取的候选记忆类型：`user_preference` / `fact` / `lesson`
- 晋升条件四条（v1.1）：cross_session（≥2 会话）、failure_evidence（lesson）、explicit（durable=1 或 user_preference 单会话）
- **v1.1 约束**：不删除/重建 `memory_rules` 表，`user_preference` 单会话提升复用 `explicit` 标签

---

## File Structure

### New files (v1.0)

| 文件 | 职责 |
|------|------|
| `server/src/db/migrations-memory.ts` | memory 表 CREATE TABLE IF NOT EXISTS SQL |
| `server/src/db/memory-db.ts` | initMemoryDb() / getMemoryDb() / CRUD for 3 tables |
| `server/src/services/memory-extractor.ts` | 调用 callLLM 抽取 episode_summary + memory_items |
| `server/src/services/memory-promoter.ts` | 合并同义候选 + 判断晋升条件 + 写入 rules |
| `server/src/services/memory-recall.ts` | 读取 rules + candidates 构建 system prompt 追加内容 |

### Modified files

| 文件 | 修改内容 |
|------|----------|
| `server/src/index.ts` | 启动时调用 `initMemoryDb()` |
| `server/src/services/agent.ts` | runAgent() 中 SSE done 后触发记忆抽取；system prompt 构建时追加 memory context |
| `server/src/routes/message.ts` | SSE done 后触发 extractSessionMemories（fire-and-forget） |
| `server/src/services/llm-caller.ts` | v1.1 新增 `stripMarkdownCodeFence` + `extractFirstJsonObject` 导出 |
| `server/src/services/query-router.ts` | 各路径 prompt 调用 `buildMemoryContext` 注入 |

---

### Task 1: Memory 数据库初始化 (v1.0)

**Files:**
- Create: `server/src/db/migrations-memory.ts`
- Create: `server/src/db/memory-db.ts`
- Modify: `server/src/index.ts` - 启动时初始化 memory 数据库

**Interfaces:**
- Consumes: 无
- Produces: `initMemoryDb()` / `getMemoryDb()` / `createEpisode()` / `createCandidate()` / `getUnpromotedCandidates()` / `getAllRules()` / `createRule()` / `markCandidatePromoted()`

- [x] **Step 1: 创建 migrations-memory.ts**（3 张表 CREATE TABLE IF NOT EXISTS，含 type/kind/promotion_reason 的 CHECK 约束）

- [x] **Step 2: 创建 memory-db.ts**（initMemoryDb 异步初始化 + runMigrations + saveMemoryDb + 3 张表 CRUD）

- [x] **Step 3: 在 index.ts 中调用 initMemoryDb()**（与 initDb() 并排）

- [x] **Step 4: 验证数据库初始化**（启动后检查 server/data/memory.db 创建）

- [x] **Step 5: 提交**

---

### Task 2: 记忆抽取服务（v1.1 覆盖更新）

**Files:**
- Create/Modify: `server/src/services/memory-extractor.ts`

**Interfaces:**
- Consumes: `createEpisode()` / `createCandidate()` from memory-db.ts；`callLLM` / `stripMarkdownCodeFence` / `extractFirstJsonObject` from llm-caller.ts；`MODEL_LIGHT` from llm-config.ts
- Produces: `extractSessionMemories(conversationId, messages)`

**v1.1 修复要点：**
- **L5**：删除内部 callLLM，改用 `llm-caller.callLLM(truncatedMessages, EXTRACT_PROMPT, MODEL_LIGHT, 1024)`，`system` 顶层字段
- **L1**：`parseResponse` 用 `stripMarkdownCodeFence` + `extractFirstJsonObject`（栈匹配，字段顺序无关）+ 中文冒号 fallback
- **L2**：`EXTRACT_PROMPT` 的 durable 判定标准（个人习惯/长期偏好/身份信息 = true）

- [x] **Step 1: 创建 memory-extractor.ts（v1.1 版本）**

关键代码：

```typescript
import { createEpisode, createCandidate } from '../db/memory-db'
import { promoteCandidates } from './memory-promoter'
import { callLLM, stripMarkdownCodeFence, extractFirstJsonObject } from './llm-caller'
import { MODEL_LIGHT } from './llm-config'

const MAX_CONTENT_LENGTH = 2000

const EXTRACT_PROMPT = `你是一个会话记忆提取助手。分析以下对话，提取：
1. episode_summary: 三句话以内概括会话做了什么、失败过什么、怎么修正的
2. memory_items: 候选记忆列表，每项包含 type / statement / durable

type 必须是以下之一：
- "fact": 事实性信息（一次性、临时）
- "user_preference": 用户偏好（个人习惯、长期倾向）
- "lesson": 教训/经验

durable 判定标准：
- durable=true：个人习惯、长期偏好、用户身份信息、用户明确要求记住的事
  - 例如：睡午觉习惯、饮食偏好、工作时段、常用语言、姓名、职业
- durable=false：一次性事实、临时信息、会话特定上下文
  - 例如：本次行程的具体日期、临时查询的结果

重要：即使用户只是在会话中顺带提到个人习惯或偏好（不是会话主题），也要提取为 user_preference 并标记 durable=true。

返回 JSON 格式，不要包含其他文字：
{
  "episode_summary": "...",
  "memory_items": [
    { "type": "fact", "statement": "...", "durable": false }
  ]
}`

export async function extractSessionMemories(conversationId, messages) {
  if (messages.length < 2) return

  const truncatedMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content.length > MAX_CONTENT_LENGTH ? m.content.slice(0, MAX_CONTENT_LENGTH) : m.content,
  }))

  let llmResponse: string | null = null
  try {
    llmResponse = await callLLM(truncatedMessages, EXTRACT_PROMPT, MODEL_LIGHT, 1024)
  } catch (err) {
    console.warn('[MemoryExtractor] LLM API call failed:', err)
    return
  }
  if (!llmResponse) return

  const parsed = parseResponse(llmResponse)
  if (!parsed) {
    console.warn('[MemoryExtractor] Failed to parse LLM response')
    return
  }

  createEpisode({ conversation_id: conversationId, summary: parsed.episode_summary, candidate_count: parsed.memory_items.length })
  for (const item of parsed.memory_items) {
    createCandidate({ conversation_id: conversationId, type: item.type, statement: item.statement, durable: item.durable ? 1 : 0 })
  }
  promoteCandidates().catch(() => {})
}

function parseResponse(text: string): ParsedResponse | null {
  // 路径1：JSON（剥离 markdown + 栈匹配，字段顺序无关）
  const stripped = stripMarkdownCodeFence(text)
  const jsonStr = extractFirstJsonObject(stripped)
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed && parsed.episode_summary && Array.isArray(parsed.memory_items)) {
        return parsed
      }
    } catch { /* fall through */ }
  }

  // 路径2：文本格式 fallback（兼容中英文冒号）
  const summaryMatch = text.match(/episode_summary[：:]\s*(.+?)(?:\n|$)/i)
  const typeMatches = [...text.matchAll(/type[：:]\s*(\w+)/gi)]
  const statementMatches = [...text.matchAll(/statement[：:]\s*(.+?)(?:\n|$)/gi)]

  if (summaryMatch && typeMatches.length > 0 && statementMatches.length > 0) {
    const items = typeMatches.map((tMatch, i) => ({
      type: tMatch[1].toLowerCase(),
      statement: statementMatches[i]?.[1]?.trim() ?? '',
      durable: /durable[：:]\s*(true|1)/i.test(text),
    }))
    return { episode_summary: summaryMatch[1].trim(), memory_items: items }
  }

  return null
}
```

- [x] **Step 2: 提交**

**Test cases (v1.1 覆盖):**
- [x] 消息数 < 2 时不调用 API
- [x] 正常抽取：调用 createEpisode 和 createCandidate
- [x] API 调用失败时不抛异常，只打 warning
- [x] 解析失败时（无效格式）不抛异常，只打 warning
- [x] 单条消息 > 2000 字符被截断
- [x] promoteCandidates 被调用（fire-and-forget）
- [x] markdown 代码块包裹的 JSON 能解析（v1.1 L1）
- [x] 字段顺序反转的 JSON 能解析（v1.1 L1）
- [x] JSON 前后有说明文字时仍能提取（v1.1 L1）
- [x] 中文冒号的文本格式能解析（v1.1 L1）
- [x] 请求 body 的 system 是顶层字段，messages 不含 system role（v1.1 L5）
- [x] prompt 含个人习惯/长期偏好的 durable 判定标准（v1.1 L2）

---

### Task 3: 将记忆抽取接入 Agent 流程 (v1.0)

**Files:**
- Modify: `server/src/routes/message.ts`

**Interfaces:**
- Consumes: `extractSessionMemories()` from memory-extractor.ts
- Produces: 在 SSE done 后触发记忆抽取

- [x] **Step 1: 修改 message.ts - SSE done 后触发记忆抽取**

在 `server/src/routes/message.ts` 的 POST handler 和 regenerate handler 中，`processAgentStream` 完成后 fire-and-forget 触发：

```typescript
import { extractSessionMemories } from '../services/memory-extractor'
import { getMessages } from '../db'

// processAgentStream 完成后
const allMessages = getMessages(req.params.conversationId)
extractSessionMemories(
  req.params.conversationId,
  allMessages.map(m => ({ role: m.role, content: m.content }))
).catch(err => console.warn('[Memory] Extraction failed:', err))
```

- [x] **Step 2: 提交**

---

### Task 4: 跨会话晋升服务（v1.1 覆盖更新）

**Files:**
- Create/Modify: `server/src/services/memory-promoter.ts`

**Interfaces:**
- Consumes: `getUnpromotedCandidates()` / `markCandidatePromoted()` / `createRule()` from memory-db.ts；`callLLM` / `stripMarkdownCodeFence` / `extractFirstJsonObject` from llm-caller.ts；`MODEL_LIGHT` from llm-config.ts
- Produces: `promoteCandidates()`

**v1.1 修复要点：**
- **L3**：`evaluateGroup` / `evaluateMergedGroup` 新增 `user_preference` 单会话提升（`type=user_preference` 单会话即提升为 `user_preference_rule`，`promotion_reason=explicit`）；`fact` 单会话不提升
- **L5**：`llmMergeCandidates` 改用 `llm-caller.callLLM`，JSON 解析用 `extractFirstJsonObject`

晋升优先级（v1.1）：
1. cross_session（≥2 会话）
2. failure_evidence（type=lesson）
3. explicit（durable=1 或 user_preference 单会话）

- [x] **Step 1: 创建 memory-promoter.ts（v1.1 版本）**

关键代码：

```typescript
import { callLLM, stripMarkdownCodeFence, extractFirstJsonObject } from './llm-caller'
import { MODEL_LIGHT } from './llm-config'

function evaluateGroup(group: Candidate[]): {...} | null {
  const conversations = new Set(group.map(c => c.conversation_id))

  // Priority 1: cross_session (≥2 不同会话)
  if (conversations.size >= 2) {
    return { kind: 'user_preference_rule', rule: group[0].statement, promotion_reason: 'cross_session', supporting_conversations: Array.from(conversations) }
  }

  // Priority 2: failure_evidence (type=lesson)
  if (group.some(c => c.type === 'lesson')) {
    return { kind: 'stable_fact', rule: group[0].statement, promotion_reason: 'failure_evidence', supporting_conversations: [group[0].conversation_id] }
  }

  // Priority 3: explicit (durable=1) OR single-session user_preference (v1.1)
  // - durable=1: 用户明确要求记住
  // - user_preference 单会话: 个人偏好无需跨会话重复即应记住（复用 explicit 标签）
  const hasDurable = group.some(c => c.durable === 1)
  const isUserPreference = group.some(c => c.type === 'user_preference')
  if (hasDurable || isUserPreference) {
    return { kind: 'user_preference_rule', rule: group[0].statement, promotion_reason: 'explicit', supporting_conversations: [group[0].conversation_id] }
  }

  return null // fact 单会话不提升
}

async function llmMergeCandidates(candidates: Candidate[]): Promise<MergedResult[] | null> {
  // ... 构造 candidateList + systemPrompt
  let text: string
  try {
    text = await callLLM(
      [{ role: 'user', content: JSON.stringify({ candidates: candidateList }) }],
      systemPrompt,
      MODEL_LIGHT,
      1024
    )
  } catch { return null }
  if (!text) return null

  // v1.1: 栈匹配提取 JSON（替代原 indexOf/lastIndexOf 贪婪匹配）
  const stripped = stripMarkdownCodeFence(text)
  const jsonStr = extractFirstJsonObject(stripped)
  if (!jsonStr) return null
  // ... JSON.parse + 校验 merged_memories
}
```

- [x] **Step 2: 将晋升触发接入 memory-extractor**（extractSessionMemories 末尾 fire-and-forget 调 promoteCandidates）

- [x] **Step 3: 提交**

**Test cases (v1.1 覆盖):**
- [x] 没有候选时返回 promoted: 0, kept: 0
- [x] 单个 fact 候选不晋升（fact 单会话不提升）
- [x] 跨会话候选晋升为 cross_session
- [x] durable=true 的候选晋升为 explicit
- [x] type=lesson 的候选晋升为 failure_evidence
- [x] 多候选：cross_session 优先于 explicit
- [x] 多候选：failure_evidence 优先于 explicit
- [x] 晋升后候选标记 promoted=1
- [x] 晋升后规则写入 memory_rules
- [x] 单会话 user_preference（durable=0）晋升为 explicit（v1.1 L3）
- [x] 单会话 fact（durable=0）不提升（v1.1 L3）
- [x] cross_session 优先于单会话 user_preference（v1.1 L3）

---

### Task 5: 召回注入 System Prompt（v1.1 覆盖更新）

**Files:**
- Create/Modify: `server/src/services/memory-recall.ts`

**Interfaces:**
- Consumes: `getAllRules()` / `getUnpromotedCandidates()` from memory-db.ts
- Produces: `buildMemoryContext()`

**v1.1 修复要点：**
- **L4**：`buildMemoryContext` 同时读 rules + unpromoted `user_preference` candidates（最近 10 条）
- 输出两节："## 长期记忆" + "## 近期偏好（待验证）"
- candidates 限 10 条，仅 `user_preference`（fact/lesson 不注入，避免噪音）

- [x] **Step 1: 创建 memory-recall.ts（v1.1 版本）**

```typescript
import { getAllRules, getUnpromotedCandidates } from '../db/memory-db'

const LABEL_MAP: Record<string, string> = {
  user_preference_rule: '用户偏好',
  project_rule: '项目规则',
  stable_fact: '稳定事实',
}

const MAX_RECENT_CANDIDATES = 10

export function buildMemoryContext(): string {
  const rules = getAllRules()
  const candidates = getUnpromotedCandidates()
    .filter(c => c.type === 'user_preference')
    .slice(0, MAX_RECENT_CANDIDATES)

  if (rules.length === 0 && candidates.length === 0) return ''

  const parts: string[] = []

  if (rules.length > 0) {
    const lines = rules.map(r => `- [${LABEL_MAP[r.kind] || r.kind}] ${r.rule}`)
    parts.push(`## 长期记忆（基于历史会话总结的规则）\n${lines.join('\n')}`)
  }

  if (candidates.length > 0) {
    const lines = candidates.map(c => `- ${c.statement}`)
    parts.push(`## 近期偏好（待验证）\n${lines.join('\n')}`)
  }

  return parts.join('\n\n') + '\n'
}
```

- [x] **Step 2: 修改 agent.ts / query-router.ts - 在 system prompt 构建时注入记忆**

在各路径（CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH/COMPLEX）的 prompt 末尾追加 `${buildMemoryContext()}`。

- [x] **Step 3: 提交**

**Test cases (v1.1 覆盖):**
- [x] 没有规则时返回空字符串
- [x] 有规则时返回格式化的记忆上下文
- [x] 不同类型规则使用正确的中文标签
- [x] 多条规则按创建时间排序
- [x] 规则内容被正确包含
- [x] 构建完整输出格式正确
- [x] unpromoted user_preference candidate 被注入近期偏好节（v1.1 L4）
- [x] fact/lesson candidate 不被注入（v1.1 L4）
- [x] 有 rules 有 candidates 时输出两节（v1.1 L4）
- [x] 已 promoted 的 candidate 不被注入（v1.1 L4）

---

### Task 6: L5 标准化 - llm-caller 工具函数 (v1.1 新增)

**Files:**
- Modify: `server/src/services/llm-caller.ts`

**背景:** v1.0 实际实现中 extractor/promoter 偏离了 TDD 原始设计，把 `system` 放在 messages 数组（非标准 Anthropic 格式）。v1.1 统一回归 `llm-caller.callLLM`（顶层 system 字段），并在 llm-caller 新增共享的 JSON 解析工具函数供 extractor/promoter 复用。

- [x] **Step 1: 在 llm-caller.ts 新增 `stripMarkdownCodeFence` + `extractFirstJsonObject`**

```typescript
/** 剥离 markdown 代码块包裹（```json ... ``` 或 ``` ... ```） */
export function stripMarkdownCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (match) return match[1].trim()
  return text.trim()
}

/** 用栈匹配从文本中提取第一个完整 JSON 对象，跳过字符串字面量内的 {} */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = false; continue }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
```

- [x] **Step 2: extractor/promoter 统一用 callLLM**（已在 Task 2/4 覆盖）

- [x] **Step 3: Grep 验证无残留 system-in-messages**

```bash
# 应无输出（确认 L5 已修复）
grep -rn "role: ['\"]system['\"]" server/src/services/memory-*.ts
```

**Test cases:**
- [x] `stripMarkdownCodeFence('```json\n{...}\n```')` 返回 `{...}`
- [x] `extractFirstJsonObject('前缀{"a":1}后缀')` 返回 `{"a":1}`
- [x] `extractFirstJsonObject` 跳过字符串内的 `{}`

---

## Self-Review

**1. Spec coverage:**
- ✅ Phase 1: 建表 + migration - Task 1
- ✅ Phase 2: 会话结束后记忆抽取 - Task 2 (v1.1 含 parseResponse 容错 + 标准 callLLM + durable prompt) + Task 3
- ✅ Phase 3: 跨会话晋升 - Task 4 (v1.1 含 user_preference 单会话提升)
- ✅ Phase 4: 召回注入 - Task 5 (v1.1 含读 candidates) + agent.ts/query-router.ts
- ✅ Phase 5: 可视化（后续）
- ✅ 独立 memory.db 文件 - Task 1
- ✅ 四条晋升条件（v1.1）- Task 4
- ✅ 三张表 - Task 1
- ✅ L1 parseResponse 容错 - Task 2 + Task 6
- ✅ L2 durable 判定标准 - Task 2
- ✅ L3 user_preference 单会话提升 - Task 4
- ✅ L4 recall 读 candidates - Task 5
- ✅ L5 标准化 callLLM - Task 2/4/6

**2. v1.1 测试覆盖:** 记忆模块 34 个测试用例全绿（extractor 12 + promoter 12 + recall 10），全量 309 passed + 17 skipped，无回归。

**3. Placeholder scan:** 无 TBD/TODO。

**4. Type consistency:** `memory-db.ts` 导出函数签名在 Task 2/4/5 引用一致；`llm-caller.ts` 导出 `callLLM` / `stripMarkdownCodeFence` / `extractFirstJsonObject` 在 extractor/promoter 引用一致。
