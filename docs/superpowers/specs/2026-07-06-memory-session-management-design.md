# Memory 会话管理机制设计

## 版本记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-07-06 | 初版：四层记忆管道适配，3 张表（episodes/candidates/rules），抽取/晋升/召回三阶段 |
| v1.1 | 2026-07-20 | 修复五层问题（L1-L5）：parseResponse 容错、extractor/promoter 标准化 callLLM、user_preference 单会话提升、recall 读 candidates、durable 判定标准 |

## 概述

为 ReAct Agentic AI Chat 项目增加跨会话记忆能力。参考四层记忆管道（raw -> consolidated -> semantic -> working memory）的设计思路，将其适配到本项目现有架构中。

## 背景

当前项目每次对话相互独立，Agent 没有跨会话的长期记忆。用户偏好、历史教训、关键事实无法在后续对话中被引用。Python 参考代码展示了一套完整的四层记忆整理方案，本项目将其核心层次简化适配。

**v1.1 修复背景**：实际使用中发现"用户单次声明的个人偏好（如中午12-14点睡午觉）未被记住"，诊断出五层问题（见"修复历史"章节）。

## 技术选型

| 项目 | 选择 | 原因 |
|------|------|------|
| 存储引擎 | sql.js (WASM SQLite) | 与现有项目一致，无需新增依赖 |
| 存储文件 | `server/data/memory.db` | 独立文件，与 `agent.db` 并列，隔离生命周期 |
| 记忆抽取 | Anthropic API（LLM） | 复用现有 API 连接，用结构化输出提取 |
| 合并/晋升 | LLM + 规则判断 | 跨会话候选合并用 LLM，晋升条件用确定性规则 |
| LLM 调用 | `llm-caller.callLLM`（v1.1） | 统一标准调用，`system` 作为顶层字段，修复 L5 隐患 |

## 数据结构

### 文件存储路径

```
server/data/
├── agent.db        # 对话 + 消息 + 用户（现有）
└── memory.db       # 记忆数据
```

### 表1: `memory_episodes` - 已整理会话摘要

每次对话结束后，LLM 抽取该会话的摘要。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| conversation_id | TEXT NOT NULL | 关联的会话 ID |
| summary | TEXT NOT NULL | 三句话以内概括本次会话做了什么、失败过什么、怎么修正的 |
| candidate_count | INTEGER DEFAULT 0 | 本次会话抽取的候选记忆数 |
| created_at | TEXT NOT NULL | ISO 时间戳 |

### 表2: `memory_candidates` - 候选记忆

从每次会话中抽取出的候选记忆项，等待晋升为稳定规则。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `{conversation_id}#{index}` |
| conversation_id | TEXT NOT NULL | 来源会话 ID |
| type | TEXT NOT NULL | `user_preference` / `fact` / `lesson` |
| statement | TEXT NOT NULL | 脱离本次对话也能读懂的一句话 |
| durable | INTEGER DEFAULT 0 | 用户是否显式要求长期生效（0/1） |
| promoted | INTEGER DEFAULT 0 | 是否已晋升为规则（0/1） |
| created_at | TEXT NOT NULL | |

### 表3: `memory_rules` - 已晋升的稳定规则

经过跨会话验证后晋升的长期规则，注入到 Agent system prompt。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `rule_{n}`（自增序号） |
| kind | TEXT NOT NULL | `user_preference_rule` / `project_rule` / `stable_fact` |
| rule | TEXT NOT NULL | 规则原文 |
| promotion_reason | TEXT NOT NULL | 晋升原因：`cross_session` / `failure_evidence` / `explicit` |
| supporting_conversations | TEXT | JSON 数组，支持的会话 ID 列表 |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

注：v1.1 的 `user_preference` 单会话提升复用 `explicit` 标签，不新增枚举值（遵守"禁止 DROP TABLE"原则，详见修复历史）。

## 核心流程

### 1. 会话结束后记忆抽取（Phase 2）

在 SSE `done` 事件后触发（fire-and-forget，不阻塞用户响应）：

1. 收集当前会话的全部消息（截断单条 > 2000 字符）
2. 调用 `llm-caller.callLLM(truncatedMessages, EXTRACT_PROMPT, MODEL_LIGHT, 1024)`（v1.1 标准化：`system` 顶层字段，修复 L5）
3. `parseResponse` 容错解析 LLM 返回（v1.1 修复 L1）：
   - 剥离 markdown 代码块包裹（`stripMarkdownCodeFence`）
   - 栈匹配提取第一个完整 JSON 对象（`extractFirstJsonObject`），字段顺序无关
   - JSON 失败时 fallback 到文本格式，兼容中英文冒号
4. `EXTRACT_PROMPT` 的 durable 判定标准（v1.1 修复 L2）：
   - `durable=true`：个人习惯、长期偏好、用户身份信息、明确要求记住
   - `durable=false`：一次性事实、临时信息
   - 即使用户顺带提到个人习惯（非会话主题），也提取为 user_preference + durable=true
5. 将摘要写入 `memory_episodes`，候选写入 `memory_candidates`
6. fire-and-forget 触发 `promoteCandidates()`

### 2. 跨会话晋升（Phase 3）

晋升检查在每次新候选写入后触发（fire-and-forget）：

1. 收集 `memory_candidates` 中 `promoted=0` 的候选
2. 单候选：直接 `evaluateGroup`；多候选：先 `llmMergeCandidates`（v1.1 标准化 callLLM + 栈匹配 JSON）合并同义候选
3. 对每条候选判断晋升条件（优先级顺序）：

| 优先级 | 条件 | 晋升原因 | 判断逻辑 |
|--------|------|----------|----------|
| 1 | 跨 ≥2 个会话 | `cross_session` | 合并后 member_ids 来自不同会话 |
| 2 | type=lesson | `failure_evidence` | 从失败中总结的做法 |
| 3 | durable=1 | `explicit` | 用户明确要求长期生效 |
| 3 | type=user_preference 单会话（v1.1） | `explicit` | 个人偏好无需跨会话重复即应记住 |

4. 满足条件的写入 `memory_rules`，标记对应候选为 `promoted=1`
5. `fact` 单会话 + durable=0 不满足任何条件，保留在 candidates 等待后续证据

### 3. 召回注入（Phase 4）

在 Agent 构建 system prompt 时：

1. 从 `memory_rules` 读取所有活跃规则
2. 从 `memory_candidates` 读取 `promoted=0` 且 `type=user_preference` 的候选（v1.1 新增，最近 10 条）
3. 在 system prompt 追加两节：
   ```
   ## 长期记忆（基于历史会话总结的规则）
   - [用户偏好] 用户偏好使用 markdown 格式回复
   - [项目规则] 复杂需求先拆解再逐步执行
   - [稳定事实] 项目使用 sql.js 作为数据库引擎

   ## 近期偏好（待验证）
   - 用户中午12-14点睡午觉
   ```
4. 无 rules 且无 candidates 时返回空字符串

## 实现阶段

| 阶段 | 内容 | 涉及文件 |
|------|------|----------|
| Phase 1 | 建表 + migration | `server/src/db/memory-db.ts`、`server/src/db/migrations-memory.ts` |
| Phase 2 | 会话结束后记忆抽取 | `server/src/services/agent.ts`、`server/src/services/memory-extractor.ts`、`server/src/routes/message.ts` |
| Phase 3 | 跨会话晋升 | `server/src/services/memory-promoter.ts` |
| Phase 4 | 召回注入 | `server/src/services/agent.ts`、`server/src/services/memory-recall.ts`、`server/src/services/query-router.ts` |
| Phase 5 | 可视化（后续） | 前端展示当前已存储的记忆规则 |

## 与 Python 参考的关键差异

| 方面 | Python 参考 | 本项目适配 |
|------|-------------|-----------|
| 存储 | JSONL 文件 | sql.js SQLite 独立文件 |
| 触发 | 独立心跳 + subprocess | 会话结束后内联触发 |
| 召回 | 关键词评分 + workspace 检索 | system prompt 全量注入（rules + 近期 user_preference candidates） |
| 晋升 | 批量合并 + 跨 session 判断 | 增量式：每新候选检查 |
| 任务工作记忆 | task_brief.json | 暂不实现 |

## 晋升条件（四条）

1. **跨会话重复**（cross_session）：同一偏好/事实/做法在 ≥2 个不同会话中出现
2. **失败证据**（failure_evidence）：工具执行失败的经历，从失败中总结的做法（type=lesson）
3. **用户显式指令**（explicit）：用户明确要求"以后都这样/请记住"的偏好（durable=1）
4. **个人偏好单会话声明**（explicit，v1.1 新增）：`type=user_preference` 单会话即提升，个人偏好无需跨会话重复即应记住

## 修复历史

### v1.1 (2026-07-20): 五层问题修复

#### 问题诊断

实际使用中发现"用户单次声明的个人偏好（如中午12-14点睡午觉）未被记住"。诊断证据：

- `agent.db` 确认会话A（含睡午觉偏好）和会话B（西安两日游）存在，同一用户
- `memory.db` 的 `memory_episodes` 表：会话A/B 无 episode（提取失败）
- 日志：`[MemoryExtractor] Failed to parse LLM response`
- 同模型 `deepseek-v4-flash`，部分会话提取成功部分失败 -> LLM 输出格式不稳定

#### 五层问题

| 层级 | 问题 | 影响 |
|------|------|------|
| **L1 直接根因** | `parseResponse` 容错不足：JSON 正则要求字段顺序、不容忍 markdown 包裹；文本 fallback 与 JSON 互斥 | LLM 输出波动时整体丢弃，会话提取失败 |
| **L2 判断错位** | `durable` 按"是否明确要求记住"判断，个人习惯被判 false | 个人偏好不被标记为持久 |
| **L3 提升门槛** | 单会话 user_preference + durable=0 不满足 cross_session/failure_evidence/explicit 任何条件 | 个人偏好永远不提升 |
| **L4 召回盲区** | `buildMemoryContext` 只读 rules，不读 candidates | 未提升的偏好对后续会话不可见 |
| **L5 代码隐患** | extractor/promoter 的 callLLM 把 system 放 messages 数组（非标准 Anthropic 格式） | 当前代理兼容所以没炸，换环境会 400 |

#### 修复方案

**方案1（修复 L1）：放宽 parseResponse + 标准化 LLM 调用**
- 新增 `stripMarkdownCodeFence`：剥离 ` ```json ... ``` ` 包裹
- 新增 `extractFirstJsonObject`：栈匹配提取第一个完整 JSON 对象，字段顺序无关，跳过字符串字面量内的 `{}`
- 文本 fallback 兼容中英文冒号
- extractor 删除内部 callLLM，改用 `llm-caller.callLLM`（顶层 system 字段，顺带修复 L5）

**方案2（修复 L3+L4）：user_preference 单会话提升 + recall 读 candidate**
- promoter 新增：`type=user_preference` 单会话即提升为 `user_preference_rule`（`promotion_reason=explicit`）
- recall 读 rules + unpromoted `user_preference` candidates（最近 10 条），输出"## 长期记忆"+"## 近期偏好（待验证）"两节

**方案3（修复 L2）：调整提取 prompt**
- `durable=true`：个人习惯、长期偏好、用户身份信息、明确要求记住
- `durable=false`：一次性事实、临时信息
- 强调"即使用户顺带提到个人习惯，也提取为 user_preference + durable=true"

**L5 修复：promoter 标准化 callLLM**
- `llmMergeCandidates` 改用 `llm-caller.callLLM`，JSON 解析改用 `extractFirstJsonObject`

#### 验收标准

- markdown 包裹（` ```json ` / ` ``` `）的 JSON 能正确解析
- 字段顺序反转的 JSON 能正确解析
- 中文冒号的文本格式能解析
- extractor/promoter 请求 body 的 `system` 是顶层字段（`messages` 不含 `system` role）
- 单会话 `user_preference` candidate 提升为 `user_preference_rule`（`explicit`）
- 单会话 `fact` candidate 不提升
- `buildMemoryContext` 输出含 unpromoted `user_preference` candidates
- `buildMemoryContext` 不输出 `fact`/`lesson` candidates

#### Trade-offs

| 维度 | 收益 | 代价 |
|------|------|------|
| parseResponse 容错 | LLM 输出波动不再整体丢弃 | 解析逻辑变复杂 |
| user_preference 单会话提升 | 单次声明即记住 | 可能记住一次性偏好（靠 durable 判断 + recall 限 10 条缓解） |
| recall 读 candidates | 未提升偏好可见 | prompt 略有膨胀（限 10 条 + 仅 user_preference） |
| 复用 explicit 标签 | 不改表结构，遵守禁止 DROP TABLE | 无法区分"明确要求记住"和"单会话偏好" |

## 约束与注意事项

- 独立 `memory.db` 文件，与 `agent.db` 共享 sql.js WASM 实例但独立 Database 对象
- 记忆抽取调用 LLM 会增加一次 API 调用，需确保不影响用户体验（异步触发，不阻塞响应）
- 晋升操作同样调用 LLM 做合并，频率由新会话触发次数决定
- 所有新增表使用 `CREATE TABLE IF NOT EXISTS` 迁移策略，与现有 migration 模式一致
- 首次实现不处理规则删除/更新，后续可增加管理界面
- **v1.1 约束**：不删除/重建 `memory_rules` 表（遵守"禁止 DROP TABLE"），`user_preference` 单会话提升复用 `explicit` 标签
- **v1.1 约束**：所有 LLM 调用统一走 `llm-caller.callLLM`，`system` 作为顶层字段（修复 L5 隐患）
