# CLAUDE.md — ReAct Agentic AI Chat

## 项目概述

基于 ReAct (Reasoning + Acting) 模式的 AI Agent 聊天应用，Vue 3 前端 + Node.js/Express 后端。核心能力：**查询分类路由**（5 路径分流 + 多模型调度）、LangGraph ReAct 循环（原生 tool-calling）、长期记忆、RAG 知识库检索、MCP 动态工具、思考过程可视化、消息分支、用户认证与多租户隔离、流式打字机输出。

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 + TypeScript | ^3.5.0 |
| 状态管理 | Pinia | ^2.2.0 |
| 路由 | Vue Router | ^4.6.4 |
| 构建工具 | Vite | ^6.0.0 |
| UI 方案 | Tailwind CSS | ^3.4.0（暗色主题） |
| 后端 | Node.js + Express | ^4.21.0 |
| 数据库 | sql.js (WASM SQLite) | ^1.11.0（主库 + 记忆库双库） |
| LLM 编排 | LangChain + LangGraph | ^1.4.x（`createReactAgent`） |
| LLM 接入 | OpenAI 兼容 API（硅基流动，流式/非流式两套） | - |
| MCP 客户端 | @modelcontextprotocol/sdk | ^1.29.0 |
| 认证 | jsonwebtoken + bcryptjs | ^9 / ^3 |
| 数学计算 | mathjs + nerdamer | ^15 / ^1.1 |
| 网页解析 | cheerio | ^1.0.0 |
| 向量检索 | Elasticsearch 8.14 (Docker) + 硅基流动 bge-m3 / bge-reranker-v2-m3 | - |
| Schema | zod | ^4.4.3 |
| 测试 | Vitest | ^4.1.8 |
| 运行时 | tsx (服务端 TS 执行) | ^4.19.0 |

## 常用命令

```bash
# 1. 启动 Elasticsearch（RAG 依赖，不启则降级，其他功能正常）
docker compose up -d

# 2. 启动后端（端口 3001，MCP 初始化需 15-20 秒）
cd server && npm run dev

# 3. 启动前端（端口 5173，--host 已开启局域网访问）
cd client && npm run dev

# 运行全部测试（项目根目录）
npm run test

# 运行单个测试模块
npx vitest run test/server/services/query-router.test.ts

# 监听模式
npm run test:watch
```

## 项目结构

```
agent/
├── .mcp.json                    # MCP 服务器配置（5 个服务）
├── CLAUDE.md                    # 本文件
├── README.md                    # 完整架构/流程/API 文档（含 mermaid 图）
├── ARCHITECTURE.md              # 混合架构设计文档（StateGraph 迁移方案）
├── SPEC.md                      # 项目规格说明书（索引 + 技术选型 + 设计决策）
├── docker-compose.yml           # Elasticsearch Docker Compose
├── _start-all.ps1               # Windows 开发一键启动脚本
├── vitest.config.ts             # 测试配置
├── package.json                 # 根级测试依赖
├── docs/
│   └── superpowers/
│       ├── specs/               # 功能设计文档（YYYY-MM-DD-<topic>-design.md）
│       └── plans/               # 实现计划（YYYY-MM-DD-<feature>.md）
│
├── client/                      # Vue 3 前端 (ESM)
│   ├── vite.config.ts           # dev server + /api 代理到 :3001
│   ├── tailwind.config.ts       # 暗色主题色值
│   └── src/
│       ├── main.ts              # createApp + Pinia + router
│       ├── App.vue              # <router-view> 根组件
│       ├── router/index.ts      # /login + / 路由 + 认证守卫
│       ├── types/index.ts       # User/Conversation/Message/AgentEvent/Complexity
│       ├── assets/main.css      # 全局样式 + 打字机动画
│       ├── views/
│       │   ├── LoginPage.vue    # 登录/注册页
│       │   └── ChatPage.vue     # 主聊天页（侧边栏 + ChatArea）
│       ├── components/
│       │   ├── ChatArea.vue     # 消息流 + 复杂度选择 + System Prompt 弹窗
│       │   ├── ChatInput.vue    # 输入框 + loading spinner + 复杂度
│       │   ├── ConversationList.vue  # 对话列表 + 置顶 + 删除确认
│       │   ├── MessageBubble.vue # 消息气泡 + 思考折叠 + 复制 + 分支 + warning
│       │   ├── ThoughtStep.vue  # 单个思考步骤渲染
│       │   ├── BranchNavigator.vue  # 分支切换 < 1/3 >
│       │   ├── AdminSidebar.vue # 管理员侧边栏（用户列表）
│       │   ├── SettingsDialog.vue / ProfileDialog.vue / SidebarFooter.vue
│       │   └── DocumentManager.vue  # 文档管理（上传+列表+删除）
│       ├── stores/
│       │   ├── auth.ts          # JWT 登录/注册/me/设置/头像
│       │   ├── conversation.ts  # 对话 CRUD + 置顶 + 归属
│       │   ├── message.ts       # 消息管理 + SSE + 流式状态隔离(Map) + 分支
│       │   └── document.ts      # 文档 API
│       ├── composables/
│       │   ├── useKeyboard.ts / useTheme.ts / useAvatar.ts
│       ├── utils/fetch.ts       # authFetch: 注入 Bearer + 401 登出
│       └── tools/codeRunner.ts  # 浏览器端代码沙箱
│
├── server/                      # Express 后端 (ESM)
│   └── src/
│       ├── index.ts             # initDb → initMemoryDb → seedAdmin → MCP → RAG → listen
│       ├── types.ts             # Conversation/Message/User/Tool/AgentEvent(warning)
│       ├── db/
│       │   ├── index.ts         # 主库 agent.db: 异步初始化 + 迁移 + 5s 自动存盘
│       │   ├── migrations.ts    # 主库建表 (v1-v8)
│       │   ├── memory-db.ts     # 记忆库 memory.db: episode/candidate/rule CRUD
│       │   ├── migrations-memory.ts  # 记忆库建表
│       │   └── user.ts          # users CRUD + seedAdmin
│       ├── middleware/auth.ts   # JWT 校验 + adminMiddleware + signToken
│       ├── routes/
│       │   ├── auth.ts          # /api/auth: register/login/me
│       │   ├── user.ts          # /api/user: settings/avatar/password
│       │   ├── admin.ts         # /api/admin: users + 用户会话
│       │   ├── conversation.ts  # /api/conversations: CRUD + 置顶 + 导出
│       │   ├── message.ts       # SSE 流式 + 分支编辑 + 重新生成
│       │   └── document.ts      # /api/documents: 上传/列表/删除
│       ├── services/
│       │   ├── agent.ts         # ReAct 入口: 路由分发 + 后置事实核查(warning)
│       │   ├── query-router.ts  # 查询分类(规则+LLM) + 工具过滤 + 5 路径分发
│       │   ├── langchain-adapter.ts  # LangGraph stream → AgentEvent + 停止检测
│       │   ├── llm-caller.ts    # streamLLM / callLLM 通用调用
│       │   ├── llm-config.ts    # 模型/API 共享配置（避免循环依赖）
│       │   ├── knowledge.ts     # 内置知识 + 动态日期上下文
│       │   ├── prompt-loader.ts # prompt 模板加载（缓存, {{var}} 渲染）
│       │   ├── logger.ts        # 结构化 JSON 日志（query_classified/tool_call/...）
│       │   ├── tool-adapter.ts  # 内置 Tool → DynamicStructuredTool 包装
│       │   ├── memory-extractor.ts / memory-promoter.ts / memory-recall.ts
│       │   ├── es-client.ts / embedding-client.ts
│       │   ├── rag-chunker.ts / rag-indexer.ts / rag-search.ts / document-extractor.ts
│       │   ├── prompts/         # 外部化 prompt 模板（5 路径 + shared/）
│       │   └── workspace/       # 虚拟文件工作区
│       ├── tools/
│       │   ├── index.ts         # 内置工具 + registerTools/registerLcTools
│       │   ├── search.ts        # 智谱 web-search-pro 搜索 + cheerio 提取
│       │   ├── filesystem.ts    # 虚拟工作区 + 路径穿越防护
│       │   ├── calculator.ts    # mathjs + nerdamer 高等数学
│       │   ├── parallel-search.ts # parallel_search 并行搜索工具
│       │   ├── knowledge-search.ts  # knowledge_search 工具（RAG 检索）
│       │   └── localfs/          # 本地文件系统工具（fs_* 8 个 + 沙箱/审计/确认/锁）
│       ├── mcp/
│       │   ├── config.ts        # 读取 .mcp.json, MCP_CONFIG_PATH 覆盖
│       │   └── client.ts        # MCP SDK 客户端: stdio/sse + 工具发现 + Zod 转换
│       └── data/                # 运行时生成: agent.db / memory.db / avatars/
│
└── test/                        # 特征测试 (TDD)
    ├── client/                  # 前端: components/stores/composables/tools
    └── server/                  # 后端: services/tools/db/routes
```

## 核心数据流

```
用户输入 → ChatArea.handleSend()
  → msgStore.sendMessage() → POST /api/conversations/:id/messages (SSE)
    → runAgent() → runRoutedAgent()（5 路径分发）
      → createReactAgent 原生 tool-calling 循环
        → thought_delta / action / observation / content_delta 事件
      → 中间轮次（有 tool_calls）内容只走 thought，不产生 content_delta
      → 最终轮次 text → content_delta（打字机效果）
      → 后置事实核查 validateAnswer → 失败 yield warning（不覆盖回答）
    → SSE 推送到前端
      → handleSSEEvent() 更新 streamingMessage（按 conversationId 隔离）
  → done → fetchMessages() 替换为持久化消息
  → 异步 fire-and-forget：记忆提取 + ES 索引
```

## API 端点

### 认证 `/api/auth`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录，返回 JWT + user |
| GET | /api/auth/me | 当前用户信息 |

### 用户 `/api/user`（Bearer）
PATCH /settings（主题/字号）、POST /avatar（上传）、PATCH /password

### 管理 `/api/admin`（仅 admin）
GET /users、GET /users/:userId/conversations

### 对话管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations | 对话列表（自己 + 孤儿） |
| POST | /api/conversations | 新建对话 (可含 system_prompt) |
| GET | /api/conversations/:id | 获取单个对话（孤儿自动认领） |
| PATCH | /api/conversations/:id | 更新标题/system_prompt/is_pinned（置顶上限 5） |
| DELETE | /api/conversations/:id | 删除对话 |
| GET | /api/conversations/:id/export?format=json\|md | 导出对话 |

### 消息
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations/:id/messages | 获取消息列表 |
| POST | /api/conversations/:id/messages | 发送消息 (SSE 流式, complexity 参数) |
| PATCH | /api/conversations/:id/messages/:mid | 编辑消息 (创建分支) |
| POST | /api/conversations/:id/messages/:mid/regenerate | 重新生成 (SSE) |

### 文档 `/api/documents`（Bearer）
POST 上传（multer，MD/TXT/PDF ≤10MB）、GET 列表、DELETE /:docId

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/mcp/status | MCP 服务器连接状态 + 工具数 |
| GET | /avatars/<file> | 头像静态资源 |

## SSE 事件类型

| 事件 | 说明 |
|------|------|
| thought_delta | 流式思考片段 (追加到最后一个 thought step) |
| thought | 完整思考摘要 (替换最后一个 thought step) |
| action | 工具调用 (tool_name + input) |
| observation | 工具执行结果 |
| content_delta | 最终回答片段 (打字机效果) |
| content | 完整回答内容 (兜底汇总) |
| warning | 事实核查失败警告 (不覆盖回答) |
| done | 循环结束 |
| error | 流异常 |

## 内置工具

| 工具名 | 输入格式 | 说明 |
|--------|---------|------|
| search | URL 或搜索关键词 | 智谱 web-search-pro API 搜索 / URL 抓取，cheerio 提取纯文本，4000 字截断，15s 超时 |
| parallel_search | JSON `{queries: string[]}` | 并行执行多个独立搜索词（并发 4，单批 ≤6 条），按【查询N】分段返回，软截断；受 searchCallCount 上限约束 |
| filesystem_read | 相对路径 | 读取虚拟工作区文件 |
| filesystem_write | JSON `{"path","content"}` | 写入虚拟工作区文件 |
| filesystem_list | 相对目录路径 | 列出目录内容 |
| filesystem_delete | 相对路径 | 删除文件/目录 |
| calculator | JSON `{expression}` | 高等数学（mathjs + nerdamer），原生 DynamicStructuredTool |
| knowledge_search | JSON `{query, docType?, tags?}` | RAG 检索本地知识库（历史对话/记忆/文档），BM25+kNN+rerank，top3-5 |
| fs_read_file | JSON `{path}` | 仅 local_fs 模式，沙箱 + 审计：读取本地文件（>2MB/二进制拒绝） |
| fs_write_file | JSON `{path, content, confirm?}` | 仅 local_fs 模式，沙箱 + 高危确认 + 审计：写入/覆盖本地文件（覆盖需确认） |
| fs_list_dir | JSON `{path, recursive?}` | 仅 local_fs 模式，沙箱 + 审计：列出目录（深度≤3，≤500 项） |
| fs_mkdir | JSON `{path}` | 仅 local_fs 模式，沙箱 + 审计：创建目录（支持多级） |
| fs_rm | JSON `{path, confirm?}` | 仅 local_fs 模式，沙箱 + 高危确认 + 审计：删除文件/目录（高危需确认） |
| fs_cp | JSON `{src, dest, confirm?}` | 仅 local_fs 模式，沙箱 + 高危确认 + 审计：复制（目标已存在需确认） |
| fs_mv | JSON `{src, dest, confirm?}` | 仅 local_fs 模式，沙箱 + 高危确认 + 审计：移动/重命名（目标已存在需确认） |
| fs_stat | JSON `{path}` | 仅 local_fs 模式，沙箱 + 审计：获取文件/目录信息 |

MCP 工具在服务启动时动态发现并注册，与内置工具并存。`calculator`/`knowledge_search`/`parallel_search`/`fs_*` 以原生 `DynamicStructuredTool` 注册，其余内置工具由 `wrapCustomTool` 包装为 `{input: string}` schema。

## MCP 配置

`.mcp.json` 配置 5 个 MCP 服务器：

| 服务 | 类型 | 命令 | 用途 |
|------|------|------|------|
| playwright | stdio | `npx -y @playwright/mcp --headless` | 浏览器自动化（CLI flag 有头模式，勿用 SDK headless） |
| fetch | sse | `https://mcp.api-inference.modelscope.net/.../sse` | 远程网页抓取（可能不稳定） |
| filesystem | stdio | `npx -y @modelcontextprotocol/server-filesystem` | 本地文件系统访问 |
| sqlite | stdio | `uvx mcp-server-sqlite` | SQLite 查询 |
| amap-maps | stdio | `npx -y @amap/amap-maps-mcp-server` | 高德地图（需 `AMAP_MAPS_API_KEY`） |

MCP 启动流程: `readMcpConfig()` → `initMcpClients()` (顺序连接) → `registerTools` + `registerLcTools` → 工具可用于 Agent。**仅启动时连接一次，不热加载**（改配置需重启后端）。

## 数据库

- **引擎**: sql.js (WASM SQLite)，异步 API，`initDb()` 必须 await
- **路径**: 主库 `DB_PATH || server/data/agent.db`；记忆库 `MEMORY_DB_PATH || server/data/memory.db`
- **持久化**: 主库每 5s 自动存盘（dirty 标记），记忆库每次写立即存盘
- **主库表**: `conversations`(id, title, system_prompt, user_id, is_pinned, ...)、`messages`(id, conversation_id, parent_id, role, content, thought_steps, ...)、`users`(username, password_hash, role, ...)、`schema_version`
- **记忆库表**: `memory_episodes`（会话摘要）、`memory_candidates`（待提升候选）、`memory_rules`（已提升规则）
- **分支**: parent_id 构成树结构，同一 parent_id 下多个子消息为分支
- **🚨 删库保护 (CRITICAL)**: 任何情况下禁止执行删库操作，包括但不限于：
  - 禁止删除数据库文件 (`agent.db`/`memory.db`) 或覆盖写入空数据
  - 禁止执行 `DROP TABLE`、`DROP DATABASE` 等 SQL 语句
  - 禁止在代码或 shell 中运行 `rm`/`del` 删除 .db 文件
  - 如需重置数据，只能逐条 DELETE 记录，且必须先确认
  - 数据库迁移只能 ADD COLUMN / CREATE TABLE IF NOT EXISTS，不能 DROP

## 环境变量

| 变量 | 默认值 | 必需 | 说明 |
|------|--------|------|------|
| SILICONFLOW_API_KEY | (空) | ✅ | LLM API 密钥（兼容链: SILICONFLOW_DEEPSEEK_V4_FLASH → SILICONFLOW_GLM_52 → ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN） |
| SILICONFLOW_BASE_URL | https://api.siliconflow.cn | ✅ | OpenAI 兼容 API 地址 |
| AGENT_MODEL_LIGHT | deepseek-ai/DeepSeek-V4-Flash | ❌ | 轻量模型（CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH + 分类器） |
| AGENT_MODEL_STRONG | zai-org/GLM-5.2 | ❌ | 强模型（COMPLEX 路径） |
| AGENT_MODEL | = MODEL_LIGHT | ❌ | 向后兼容统一模型 |
| JWT_SECRET | agent-chat-dev-secret-change-in-prod | ✅ | JWT 签名密钥 |
| ADMIN_USERNAME | admin | ❌ | 管理员账号名 |
| ADMIN_PASSWORD | Xiongam-1314 | ✅ | 管理员初始密码 |
| PORT | 3001 | ❌ | 服务端口 |
| DB_PATH | server/data/agent.db | ❌ | 主库路径 |
| MEMORY_DB_PATH | server/data/memory.db | ❌ | 记忆库路径 |
| MCP_CONFIG_PATH | .mcp.json | ❌ | MCP 配置文件路径 |
| WORKSPACE_ROOT | server/src/workspace | ❌ | 虚拟文件系统根目录 |
| LOCAL_FS_CONFIG_PATH | server/config/workspace.json | ❌ | 本地文件系统沙箱配置路径（workspace_mode/sandbox_root 等） |
| EMBEDDING_AND_RERANK_API_KEY | (空) | ❌* | 硅基流动 key（RAG 必需，不配则降级） |
| EMBEDDING_BASE_URL | https://api.siliconflow.cn/v1 | ❌ | embedding base_url |
| EMBED_MODEL | BAAI/bge-m3 | ❌ | embedding 模型（1024 维） |
| RERANK_MODEL | BAAI/bge-reranker-v2-m3 | ❌ | rerank 模型 |
| ES_URL | http://localhost:9200 | ❌* | ES 地址（RAG 必需） |
| RAG_INDEX | rag_index | ❌ | ES 索引名 |
| RAG_SCORE_THRESHOLD | 0 | ❌ | rerank score 过滤阈值 |
| ES_DISK_WARN_GB | 10 | ❌ | 磁盘水位告警阈值（GB） |

> **❌\***：RAG 相关变量。不配置时 `knowledge_search` 工具与文档上传不可用，其余功能正常（降级不阻断）。

## 开发约定

### 通用
- 服务端 ESM (`"type": "module"`)，用 tsx 运行 TS 文件
- 前端 `<script setup lang="ts">`
- 函数体超 50 行考虑拆分
- 默认不写注释，只在 WHY 不显而易见时加一行
- 禁止 `any`，用 `unknown`
- 禁止 `eval()` / `innerHTML` / `v-html`
- 🚨 **禁止删库**: 绝不执行 DROP TABLE/DATABASE、删除 .db 文件、或用空数据覆盖数据库；迁移只能增不能删
- 本地文件操作必须经 `server/src/tools/localfs/` 中间层，禁止绕过沙箱直接 fs

### Agent 核心逻辑
- ReAct 用 LangGraph `createReactAgent` **原生 tool-calling**（ChatOpenAI + OpenAI 兼容接口），非 prompt 驱动的 Action 解析
- **一轮可发多个 `tool_calls` 并行执行**（LangGraph ToolNode 并发跑），约束在 `prompts/shared/parallel-rules.txt`（prompt 建议非硬编码，模型是否照做取决于模型行为；单轮上限 8 个）
- 中间轮次（有 tool_calls）内容只走 thought，不产生 content_delta；最终轮次 text → content_delta
- `maxTokens: 4096`（每轮单次 LLM 调用），`maxIterations`：COMPLEX/SEARCH=25、CALCULATION=10；`recursionLimit = maxIterations * 2`
- `detectStuckPattern()` 连续 3 次工具失败终止；`checkSearchEffectiveness()` 搜索死循环防护（search>25 / knowledge_search>5 / 同一输入重复≥2 / 连续 3 次无新关键词）
- 循环停止后无最终回答 → `synthesizeFromObservations()` 基于已有 observations 综合
- prompt 外部化到 `server/src/prompts/*.txt`，`prompt-loader` 启动缓存加载（不热加载），`{{var}}` 占位渲染
- 后置事实核查 `validateAnswer()` 失败只 yield `warning` 事件（记日志），不覆盖/不追加回答

### 前端
- 流式消息固定 `w-[45%]`（非 max-w，否则空内容时气泡缩窄）
- 思考过程默认折叠，步数按 action 数量计数（thought→action→observation = 1轮）
- `crypto.randomUUID()` 在非 HTTPS 环境不可用，用 `uuid()` 兼容函数
- 复制按钮: 气泡外右下角，hover 显示，1.5s 后恢复
- 删除对话: 自定义确认弹窗 (非 confirm())
- 思考中: 输入框/复杂度选择器禁用，发送按钮变 loading spinner
- `streamingMessage` 是 `Map<conversationId, Message>`，切换对话时 `AbortController` 取消进行中 SSE

### Superpowers 工作流
- 所有功能开发使用 superpowers 技能链：brainstorming → writing-plans → TDD → review
- 设计文档存放 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- 实现计划存放 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
- 测试文件路径指向 `test/` 目录，延续 Vitest + 项目目录约定
- 新测试不再使用 TC-ID 命名，改用描述性 test 名称
- 全局规格（技术选型、设计决策）在 SPEC.md 中维护
- 功能级规格在对应设计文档中维护

### 测试
- 集成测试用 `describe.skip()`，需服务端运行时手动执行
- 测试在项目根目录运行 (`test/`)，environment: node

### Git
- Commit 格式: `【单号】描述`
- 不主动 commit/push
- 不跳过 pre-commit hooks

## Tailwind 主题色值（暗色）

| Token | 色值 | 用途 |
|-------|------|------|
| sidebar | #0A0A0A | 侧边栏背景 |
| chat-bg | #080808 | 消息区背景 |
| msg-border | #161616 | 边框 |
| text-muted | #4d4d4d | 次要文字 |
| surface | #0c0c0c | 卡片/表面 |
| surface-hover | #161616 | hover 态 |
| surface-active | #1a1a1a | 激活态 |

圆角: bubble=12px, btn=6px（`darkMode: 'class'`）

## 已知陷阱

1. **LLM 走硅基流动 OpenAI 兼容接口** — 默认 base `https://api.siliconflow.cn`，key 优先 `SILICONFLOW_API_KEY`（旧文档"本地代理/仅 stream:true"已过时，`llm-caller` 流式/非流式两套实现）
2. **sql.js 异步** — 所有 db 操作必须 await，不能用 better-sqlite3 (native 编译问题)；主库 5s 自动存盘，记忆库立即存盘
3. **ESM __dirname** — 用 `fileURLToPath(import.meta.url)` 替代
4. **Windows child_process** — spawn 需要完整路径，npx 可能需 `.cmd` 后缀
5. **MCP 启动慢** — uvx/npx 服务需 15-20 秒，且仅启动时连接一次，改 `.mcp.json` 需重启后端
6. **fetch (modelscope 远程 SSE)** — 远程端点可能不稳定/超时
7. **crypto.randomUUID** — 非 HTTPS 环境 (如 http://10.x.x.x) 不可用，已用 uuid() 兼容
8. **LangGraph recursionLimit** — 50 super-steps ≈ 25 次实际工具调用（每轮 = 推理 + 工具 = 2 步）
9. **并行工具调用是 prompt 建议非硬编码** — 依赖 `parallel-rules.txt` + 模型行为；模型不老实并行是复杂查询慢的主因，排查先看日志 `tool_call` 的 `step` 序号
10. **搜索死循环防护** — 上限/重复检测在 `langchain-adapter.ts` 的 `checkSearchEffectiveness()`，命中时提前终止并综合已有结果
11. **打字机效果** — 前端 `contentBuffer` + `setInterval(25ms, 3字符)` 控制，`done` 时 flush 剩余
12. **流式消息宽度** — 必须用固定 `w-[45%]` 而非 `max-w`，否则空内容时气泡会缩窄
13. **Playwright 弹窗干扰** — `@playwright/mcp` 默认有头模式会弹浏览器窗口；`.mcp.json` args 加 `--headless`（CLI flag，非 Python SDK 的 `headless=True`）；改配置需重启后端
14. **RAG 降级** — ES 未启动或无 `EMBEDDING_AND_RERANK_API_KEY` 时 `knowledge_search` 与文档上传不可用，其余功能正常；索引操作 catch 后 warn 不阻断主流程
15. **记忆异步提取** — `extractSessionMemories` / `promoteCandidates` 在 SSE 结束后 fire-and-forget，不阻塞响应
16. **事实核查 warning** — `validateAnswer` 无法区分"内置知识"和"编造"（节假日/常识不在 observations），校验失败只 warning 不覆盖回答
17. **🚨 删库保护** — 禁止 DROP TABLE/DATABASE、删除 .db 文件、空数据覆盖；迁移只能 ADD COLUMN / CREATE TABLE IF NOT EXISTS
18. **fs_\* 工具仅 local_fs 模式生效** — `workspace_mode` 改 `server/config/workspace.json`（3s 缓存，无需重启）；高危删除/覆盖默认拦截，`auto_confirm_high_risk` 与 `allow_dangerous_delete` 慎开
