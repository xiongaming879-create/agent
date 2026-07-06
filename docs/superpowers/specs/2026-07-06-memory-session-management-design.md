# Memory 会话管理机制设计

## 概述

为 ReAct Agentic AI Chat 项目增加跨会话记忆能力。参考四层记忆管道（raw → consolidated → semantic → working memory）的设计思路，将其适配到本项目现有架构中。

## 背景

当前项目每次对话相互独立，Agent 没有跨会话的长期记忆。用户偏好、历史教训、关键事实无法在后续对话中被引用。Python 参考代码展示了一套完整的四层记忆整理方案，本项目将其核心层次简化适配。

## 技术选型

| 项目 | 选择 | 原因 |
|------|------|------|
| 存储引擎 | sql.js (WASM SQLite) | 与现有项目一致，无需新增依赖 |
| 存储文件 | `server/data/memory.db` | 独立文件，与 `agent.db` 并列，隔离生命周期 |
| 记忆抽取 | Anthropic API（LLM） | 复用现有 API 连接，用结构化输出提取 |
| 合并/晋升 | LLM + 规则判断 | 跨会话候选合并用 LLM，晋升条件用确定性规则 |

## 数据结构

### 文件存储路径

```
server/data/
├── agent.db        # 对话 + 消息 + 用户（现有）
└── memory.db       # 记忆数据（新增）
```

### 表1: `memory_episodes` — 已整理会话摘要

每次对话结束后，LLM 抽取该会话的摘要。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| conversation_id | TEXT NOT NULL | 关联的会话 ID |
| summary | TEXT NOT NULL | 三句话以内概括本次会话做了什么、失败过什么、怎么修正的 |
| candidate_count | INTEGER DEFAULT 0 | 本次会话抽取的候选记忆数 |
| created_at | TEXT NOT NULL | ISO 时间戳 |

### 表2: `memory_candidates` — 候选记忆

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

### 表3: `memory_rules` — 已晋升的稳定规则

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

## 核心流程

### 1. 会话结束后记忆抽取（Phase 2）

在 `agent.ts` 的 `runAgent()` 中，SSE `done` 事件后触发：

1. 收集当前会话的全部消息（用户输入 + Agent 回答 + 工具调用/结果）
2. 调用 LLM（复用现有 API），使用结构化输出提取：
   - `episode_summary`：会话摘要
   - `memory_items`：候选记忆列表，每项包含 type / statement / durable
3. 将摘要写入 `memory_episodes`，候选写入 `memory_candidates`

### 2. 跨会话晋升（Phase 3）

晋升检查在每次新候选写入后触发：

1. 收集 `memory_candidates` 中 `promoted=0` 的候选
2. 按 project 分组（当前项目只有一个 project，预留扩展）
3. 调用 LLM 合并同义候选（不同会话中说同一件事的合并为一条）
4. 对每条合并后的候选，判断是否满足晋升条件：

| 条件 | 晋升原因 | 判断逻辑 |
|------|----------|----------|
| 同一内容在 ≥2 个会话中出现 | `cross_session` | 合并后 member_ids 来自不同会话 |
| 工具执行失败的证据 | `failure_evidence` | 来源事件中有 status=failed |
| 用户明确要求长期生效 | `explicit` | durable=true |

5. 满足条件的写入 `memory_rules`，标记对应候选为 `promoted=1`
6. 不满足条件的保留在 `memory_candidates`，等待后续会话补充证据

### 3. 召回注入（Phase 4）

在 Agent 构建 system prompt 时：

1. 从 `memory_rules` 读取所有活跃规则
2. 在 system prompt 末尾追加 "## 长期记忆" 章节
3. 格式示例：
   ```
   ## 长期记忆（基于历史会话总结的规则）
   - [用户偏好] 用户偏好使用 markdown 格式回复
   - [项目规则] 复杂需求先拆解再逐步执行
   - [稳定事实] 项目使用 sql.js 作为数据库引擎
   ```

## 实现阶段

| 阶段 | 内容 | 涉及文件 |
|------|------|----------|
| Phase 1 | 建表 + migration | `server/src/db/memory-db.ts`（新增）、`server/src/db/migrations-memory.ts`（新增） |
| Phase 2 | 会话结束后记忆抽取 | `server/src/services/agent.ts`（修改）、`server/src/services/memory-extractor.ts`（新增） |
| Phase 3 | 跨会话晋升 | `server/src/services/memory-promoter.ts`（新增） |
| Phase 4 | 召回注入 | `server/src/services/agent.ts`（修改）、`server/src/services/memory-recall.ts`（新增） |
| Phase 5 | 可视化（后续） | 前端展示当前已存储的记忆规则 |

## 与 Python 参考的关键差异

| 方面 | Python 参考 | 本项目适配 |
|------|-------------|-----------|
| 存储 | JSONL 文件 | sql.js SQLite 独立文件 |
| 触发 | 独立心跳 + subprocess | 会话结束后内联触发 |
| 召回 | 关键词评分 + workspace 检索 | system prompt 全量注入 |
| 晋升 | 批量合并 + 跨 session 判断 | 增量式：每新候选检查 |
| 任务工作记忆 | task_brief.json | 暂不实现 |

## 晋升条件（三条）

1. **跨会话重复**（cross_session）：同一偏好/事实/做法在 ≥2 个不同会话中出现
2. **失败证据**（failure_evidence）：工具执行失败的经历，从失败中总结的做法
3. **用户显式指令**（explicit）：用户明确要求"以后都这样/请记住/不要让我反复提醒/我再说一遍"的偏好

## 约束与注意事项

- 独立 `memory.db` 文件，与 `agent.db` 共享 sql.js WASM 实例但独立 Database 对象
- 记忆抽取调用 LLM 会增加一次 API 调用，需确保不影响用户体验（异步触发，不阻塞响应）
- 晋升操作同样调用 LLM 做合并，频率由新会话触发次数决定
- 所有新增表使用 `CREATE TABLE IF NOT EXISTS` 迁移策略，与现有 migration 模式一致
- 首次实现不处理规则删除/更新，后续可增加管理界面
