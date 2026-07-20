# CLAUDE.md — ReAct Agentic AI Chat

## 项目概述

基于 ReAct (Reasoning + Acting) 模式的 AI Agent 聊天应用，Vue 3 黑白简约前端 + Node.js/Express 后端，支持多对话管理、思考过程可视化、消息分支、MCP 动态工具加载、流式打字机输出。

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 + TypeScript | ^3.5.0 |
| 状态管理 | Pinia | ^2.2.0 |
| 构建工具 | Vite | ^6.0.0 |
| UI 方案 | Tailwind CSS | ^3.4.0 |
| 后端 | Node.js + Express | ^4.21.0 |
| 数据库 | sql.js (WASM SQLite) | ^1.11.0 |
| LLM 接入 | Anthropic 兼容 API（本地代理） | 仅 stream:true |
| MCP 客户端 | @modelcontextprotocol/sdk | ^1.29.0 |
| 测试 | Vitest | ^4.1.8 |
| 运行时 | tsx (服务端 TS 执行) | ^4.19.0 |

## 常用命令

```bash
# 启动后端（端口 3001，MCP 初始化需 15-20 秒）
cd server && npm run dev

# 启动前端（端口 5173，--host 已开启局域网访问）
cd client && npm run dev

# 运行全部测试（项目根目录）
npm run test

# 运行单个测试模块
npx vitest run test/server/services/agent.test.ts

# 监听模式
npm run test:watch
```

## 项目结构

```
agent/
├── .mcp.json                    # MCP 服务器配置（6 个服务）
├── .gitignore
├── CLAUDE.md                    # 本文件
├── SPEC.md                      # 项目规格说明书（索引 + 技术选型 + 设计决策）
├── vitest.config.ts             # 测试配置
├── package.json                 # 根级测试依赖
├── docs/
│   └── superpowers/
│       ├── specs/               # 功能设计文档（superpowers 格式）
│       └── plans/               # 实现计划（TDD 任务）
│
├── client/                      # Vue 3 前端 (ESM)
│   ├── vite.config.ts           # dev server + API proxy
│   ├── tailwind.config.ts       # 黑白主题色值
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts              # createApp + Pinia
│       ├── App.vue              # ConversationList + ChatArea 布局
│       ├── types/index.ts       # Conversation, Message, ThoughtStep, AgentEvent
│       ├── assets/main.css      # 全局样式 + blink 动画
│       ├── components/
│       │   ├── ChatArea.vue     # 主聊天区 + 复杂度选择 + System Prompt 弹窗
│       │   ├── ChatInput.vue    # 输入框 + loading spinner
│       │   ├── ConversationList.vue  # 侧边栏 + 删除确认弹窗
│       │   ├── MessageBubble.vue # 消息气泡 + 思考过程折叠 + 复制按钮
│       │   ├── ThoughtStep.vue  # 单个思考步骤渲染
│       │   └── BranchNavigator.vue  # 分支切换 < 1/3 >
│       ├── stores/
│       │   ├── conversation.ts  # 对话 CRUD + 活跃切换
│       │   └── message.ts       # 消息管理 + SSE 事件处理
│       ├── composables/
│       │   └── useKeyboard.ts   # 快捷键注册
│       └── tools/
│           └── codeRunner.ts    # 浏览器端代码沙箱
│
├── server/                      # Express 后端 (ESM)
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # 入口: initDb → initMcpClients → registerTools → listen
│       ├── types.ts             # Conversation, Message, ThoughtStep, Tool, AgentEvent
│       ├── db/
│       │   ├── index.ts         # sql.js 异步初始化 + CRUD
│       │   └── migrations.ts    # 建表语句 (conversations + messages)
│       ├── routes/
│       │   ├── conversation.ts  # GET/POST/PATCH/DELETE + 导出
│       │   └── message.ts       # SSE 流式 + 分支编辑 + 重新生成
│       ├── services/
│       │   └── agent.ts         # ReAct 核心循环 + 流式输出 + 中间轮次隔离
│       ├── tools/
│       │   ├── index.ts         # 内置工具注册 + registerTools() 动态扩展
│       │   ├── search.ts        # fetchHtml + cheerio 提取, 4000字截断
│       │   └── filesystem.ts    # 虚拟工作区, 路径穿越防护
│       ├── mcp/
│       │   ├── config.ts        # 读取 .mcp.json, 支持 MCP_CONFIG_PATH 覆盖
│       │   └── client.ts        # MCP SDK 客户端: 连接/发现工具/关闭
│       └── workspace/           # 虚拟文件工作区目录
│
└── test/                        # 特征测试 (TDD)
    ├── client/                  # 前端测试
    │   ├── components/          # 组件测试 + .md 说明文档
    │   ├── stores/              # 状态管理测试
    │   ├── composables/         # composable 测试
    │   └── tools/               # 代码执行测试
    └── server/                  # 后端测试
        ├── tools/               # 工具测试
        ├── db/                  # 数据库测试
        ├── routes/              # 路由集成测试 (skip, 需服务端运行)
        ├── services/            # Agent 逻辑测试
        └── data-model.test.ts   # 数据模型测试
```

## 核心数据流

```
用户输入 → ChatArea.handleSend()
  → msgStore.sendMessage() → POST /api/conversations/:id/messages
    → runAgent() (ReAct 循环)
      → streamAnthropic() → SSE chunks
        → thought_delta / action / observation / content_delta 事件
      → 中间轮次: 推理文本 → thought (不显示在最终回答)
      → 最终轮次: Answer: 后的内容 → content_delta (打字机效果)
    → SSE 推送到前端
      → handleSSEEvent() 更新 streamingMessage
        → Vue 响应式 → MessageBubble 实时渲染
  → done → fetchMessages() → 替换 streamingMessage 为持久化消息
```

## API 端点

### 对话管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations | 获取对话列表 |
| POST | /api/conversations | 新建对话 (可含 system_prompt) |
| GET | /api/conversations/:id | 获取单个对话 |
| PATCH | /api/conversations/:id | 更新标题/system_prompt |
| DELETE | /api/conversations/:id | 删除对话 |
| GET | /api/conversations/:id/export?format=json\|md | 导出对话 |

### 消息
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations/:id/messages | 获取消息列表 |
| POST | /api/conversations/:id/messages | 发送消息 (SSE 流式返回, complexity 参数) |
| PATCH | /api/conversations/:id/messages/:mid | 编辑消息 (创建分支) |
| POST | /api/conversations/:id/messages/:mid/regenerate | 重新生成 (SSE) |

### MCP
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/mcp/status | MCP 服务器连接状态 |

## SSE 事件类型

| 事件 | 说明 |
|------|------|
| thought_delta | 流式思考片段 (追加到最后一个 thought step) |
| thought | 完整思考摘要 (替换最后一个 thought step) |
| action | 工具调用 (tool_name + input) |
| observation | 工具执行结果 |
| content_delta | 最终回答片段 (打字机效果) |
| content | 完整回答内容 |
| done | 循环结束 |

## 内置工具

| 工具名 | 输入格式 | 说明 |
|--------|---------|------|
| search | URL 字符串 | fetch + cheerio 提取纯文本, 4000 字截断, 10s 超时 |
| filesystem_read | 相对路径 | 读取虚拟工作区文件 |
| filesystem_write | JSON `{"path","content"}` | 写入虚拟工作区文件 |
| filesystem_list | 相对目录路径 | 列出目录内容 |
| filesystem_delete | 相对路径 | 删除文件/目录 |

MCP 工具在服务启动时动态发现并注册，与内置工具并存。

## MCP 配置

`.mcp.json` 配置 6 个 MCP 服务器：

| 服务 | 类型 | 工具数 |
|------|------|--------|
| codebase-mcp | uvx (Python) | 1 (ast_read) |
| codebase-mcp-plus | node | 4 (代码语义搜索等) |
| playwright | npx | 23 (浏览器自动化) |
| dts-mcp-server | uvx | 4 (DTS 相关) |
| requirement-mcp-server | uvx | 2 (需求管理) |
| w3_search_tool | supergateway 桥接 | 连接可能失败 (远程 SSE) |

MCP 启动流程: `readMcpConfig()` → `initMcpClients()` (顺序连接) → `registerTools()` → 工具可用于 Agent

## 数据库

- **引擎**: sql.js (WASM SQLite)，异步 API，`initDb()` 必须 await
- **路径**: `process.env.DB_PATH || server/data/agent.db`
- **🚨 删库保护 (CRITICAL)**: 任何情况下禁止执行删库操作，包括但不限于：
  - 禁止删除数据库文件 (`agent.db`) 或覆盖写入空数据
  - 禁止执行 `DROP TABLE`、`DROP DATABASE` 等 SQL 语句
  - 禁止在代码或 shell 中运行 `rm`/`del` 删除 .db 文件
  - 如需重置数据，只能逐条 DELETE 记录，且必须先确认
  - 数据库迁移只能 ADD COLUMN / CREATE TABLE IF NOT EXISTS，不能 DROP
- **表结构**:
  - `conversations`: id, title, system_prompt, created_at, updated_at
  - `messages`: id, conversation_id, parent_id, role, content, thought_steps (JSON), created_at
- **分支**: parent_id 构成树结构，同一 parent_id 下多个子消息为分支
- **持久化**: 每次写操作后调用 `saveDb()` 写盘

## 环境变量

| 变量 | 默认值 | 必需 | 说明 |
|------|--------|------|------|
| ANTHROPIC_AUTH_TOKEN | (空) | ✅ | API 密钥 |
| ANTHROPIC_BASE_URL | https://api.anthropic.com | ✅ | 代理地址 (实际 http://127.0.0.1:8090/anthropic) |
| AGENT_MODEL | maas-glm-5.1-zhipu | ❌ | 模型名 |
| PORT | 3001 | ❌ | 服务端口 |
| DB_PATH | server/data/agent.db | ❌ | 数据库文件路径 |
| WORKSPACE_ROOT | server/src/workspace | ❌ | 虚拟文件系统根目录 |
| MCP_CONFIG_PATH | .mcp.json | ❌ | MCP 配置文件路径 |

## 开发约定

### 通用
- 服务端 ESM (`"type": "module"`)，用 tsx 运行 TS 文件
- 前端 `<script setup lang="ts">`
- 函数体超 50 行考虑拆分
- 默认不写注释，只在 WHY 不显而易见时加一行
- 禁止 `any`，用 `unknown`
- 禁止 `eval()` / `innerHTML` / `v-html`
- 🚨 **禁止删库**: 绝不执行 DROP TABLE/DATABASE、删除 .db 文件、或用空数据覆盖数据库；迁移只能增不能删

### Agent 核心逻辑
- 代理 API 不支持 `tools` 参数，ReAct 用 prompt 驱动 (Thought:/Action:/Answer:)
- 中间轮次 (有 Action) 内容不作为 content_delta，只走 thought
- `parseReActOutput()` 先 strip markdown 再匹配 Action，`containsToolIntent()` 兜底检测
- `detectStuckPattern()` 连续 3 次失败才终止 (阈值=3)
- 工具返回差结果时 Observation 追加替代工具提示

### 前端
- 气泡宽度 `max-w-[40%]`，流式消息固定 `w-[45%]`
- 思考过程默认折叠，步数按 action 数量计数 (thought→action→observation = 1轮)
- `crypto.randomUUID()` 在非 HTTPS 环境不可用，用 `uuid()` 兼容函数
- 复制按钮: 气泡外右下角，hover 显示，1.5s 后恢复
- 删除对话: 自定义确认弹窗 (非 confirm())
- 思考中: 输入框/复杂度选择器禁用，发送按钮变 loading spinner

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

## Tailwind 主题色值

| Token | 色值 | 用途 |
|-------|------|------|
| sidebar | #1A1A1A | 侧边栏背景 |
| chat-bg | #F5F5F5 | 消息区背景 |
| msg-border | #E0E0E0 | 边框 |
| text-muted | #888888 | 次要文字 |

圆角: bubble=8px, btn=4px

## 已知陷阱

1. **代理 API 只支持 stream:true** — 非流式请求返回 500
2. **sql.js 异步** — 所有 db 操作必须 await，不能用 better-sqlite3 (native 编译问题)
3. **ESM __dirname** — 用 `fileURLToPath(import.meta.url)` 替代
4. **Windows child_process** — spawn 需要完整路径，npx 可能需 `.cmd` 后缀
5. **MCP 启动慢** — Python uvx 服务需 15-20 秒，服务启动后控制台会打日志
6. **w3_search_tool** — 远程 SSE 端点可能 400，supergateway 桥接不稳定
7. **crypto.randomUUID** — 非 HTTPS 环境 (如 http://10.x.x.x) 不可用，已用 uuid() 兼容
8. **ReAct 格式不严格** — 模型可能用 markdown 包裹 Action，`containsToolIntent()` 做兜底检测
9. **打字机效果** — 由后端 content_delta 单字拆分 + 30ms 间隔控制，前端直接追加
10. **流式消息宽度** — 必须用固定 `w-[45%]` 而非 `max-w`，否则空内容时气泡会缩窄
11. **Playwright 弹窗干扰** - `@playwright/mcp` 默认有头模式会弹浏览器窗口；在 `.mcp.json` 的 args 加 `--headless` 后台运行（CLI flag，非 Python SDK 的 `headless=True`）；改配置后需重启后端，MCP 仅在服务启动时连接一次，不热加载
