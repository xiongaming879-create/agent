# ReAct Agent Chat

基于 ReAct (Reasoning + Acting) 模式的 AI Agent 聊天应用。Vue 3 前端 + Express 后端，支持多对话管理、思考过程可视化、消息分支、MCP 动态工具加载、流式打字机输出。

## 功能特性

- **ReAct 智能对话** — 思考→行动→观察循环，支持多轮工具调用
- **多对话管理** — 创建/切换/删除对话，对话置顶，System Prompt 自定义
- **思考过程可视化** — 实时展示 Agent 推理步骤，可折叠查看
- **消息分支** — 编辑任意消息生成分支，支持分支导航切换
- **流式输出** — SSE 打字机效果，实时流式返回 Agent 回复
- **MCP 工具扩展** — 通过 `.mcp.json` 配置动态加载外部工具
- **内置工具** — 网页搜索、虚拟文件系统、计算器
- **用户认证** — JWT 登录，管理员/普通用户角色
- **对话导出** — 支持 JSON / Markdown 格式导出
- **暗色主题** — Ethereal Glass 全局暗色设计风格

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 + TypeScript | ^3.5.0 |
| 状态管理 | Pinia | ^2.2.0 |
| 构建工具 | Vite | ^6.0.0 |
| UI 方案 | Tailwind CSS | ^3.4.0 |
| 后端 | Node.js + Express | ^4.21.0 |
| 数据库 | sql.js (WASM SQLite) | ^1.11.0 |
| LLM 接入 | Anthropic 兼容 API | stream:true |
| MCP 客户端 | @modelcontextprotocol/sdk | ^1.29.0 |
| 测试 | Vitest | ^4.1.8 |

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
# 根目录（测试依赖）
npm install

# 前端
cd client && npm install

# 后端
cd server && npm install
```

### 配置环境变量

在 `server/` 目录下创建 `.env` 文件：

```env
ANTHROPIC_AUTH_TOKEN=your-api-key
ANTHROPIC_BASE_URL=https://api.anthropic.com
AGENT_MODEL=claude-sonnet-4-6
PORT=3001
```

### 启动开发服务

```bash
# 启动后端（端口 3001，MCP 初始化需 15-20 秒）
cd server && npm run dev

# 启动前端（端口 5173，已开启局域网访问）
cd client && npm run dev
```

访问 http://localhost:5173

### 运行测试

```bash
# 全部测试
npm run test

# 单个测试模块
npx vitest run test/server/services/agent.test.ts

# 监听模式
npm run test:watch
```

## 项目结构

```
agent/
├── client/                      # Vue 3 前端
│   ├── src/
│   │   ├── components/          # UI 组件
│   │   ├── composables/         # 组合式函数
│   │   ├── stores/              # Pinia 状态管理
│   │   ├── views/               # 页面视图
│   │   ├── router/              # 路由配置
│   │   ├── tools/               # 浏览器端代码沙箱
│   │   ├── types/               # TypeScript 类型定义
│   │   └── utils/               # 工具函数
│   └── vite.config.ts           # 开发服务器 + API 代理
│
├── server/                      # Express 后端
│   └── src/
│       ├── routes/              # API 路由
│       ├── services/            # Agent 核心逻辑
│       ├── db/                  # 数据库操作 + 迁移
│       ├── tools/               # 内置工具（搜索/文件系统/计算器）
│       ├── mcp/                 # MCP 客户端配置与连接
│       ├── middleware/          # 认证中间件
│       └── index.ts             # 入口
│
├── test/                        # 测试文件
│   ├── client/                  # 前端测试
│   └── server/                  # 后端测试
│
├── docs/                        # 文档
│   └── superpowers/             # 设计文档 + 实现计划
│
├── .mcp.json                    # MCP 服务器配置
├── SPEC.md                      # 项目规格说明书
└── CLAUDE.md                    # Claude Code 开发指引
```

## API 端点

### 对话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations | 获取对话列表 |
| POST | /api/conversations | 新建对话 |
| GET | /api/conversations/:id | 获取单个对话 |
| PATCH | /api/conversations/:id | 更新对话（标题/置顶/system_prompt） |
| DELETE | /api/conversations/:id | 删除对话 |
| GET | /api/conversations/:id/export | 导出对话 |

### 消息

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations/:id/messages | 获取消息列表 |
| POST | /api/conversations/:id/messages | 发送消息（SSE 流式） |
| PATCH | /api/conversations/:id/messages/:mid | 编辑消息（创建分支） |
| POST | /api/conversations/:id/messages/:mid/regenerate | 重新生成 |

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录 |
| POST | /api/auth/register | 注册 |

## MCP 配置

`.mcp.json` 配置 MCP 工具服务器，服务启动时自动发现并注册：

| 服务 | 类型 | 工具数 |
|------|------|--------|
| codebase-mcp | Python (uvx) | 1 |
| codebase-mcp-plus | Node.js | 4 |
| playwright | Node.js (npx) | 23 |
| dts-mcp-server | Python (uvx) | 4 |
| requirement-mcp-server | Python (uvx) | 2 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| ANTHROPIC_AUTH_TOKEN | — | API 密钥（必填） |
| ANTHROPIC_BASE_URL | https://api.anthropic.com | API 代理地址 |
| AGENT_MODEL | maas-glm-5.1-zhipu | 模型名称 |
| PORT | 3001 | 后端端口 |
| DB_PATH | server/data/agent.db | 数据库文件路径 |
| MCP_CONFIG_PATH | .mcp.json | MCP 配置文件路径 |

## License

ISC
