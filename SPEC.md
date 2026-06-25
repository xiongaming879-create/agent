# Agent Chat — 项目规格说明书

基于 ReAct Agentic 模式的 AI Agent 聊天应用，具备多对话管理、思考过程可视化、上下文记忆、消息分支编辑等核心能力，前端采用黑白简约风格。

---

## 技术选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 前端框架 | Vue 3 + TypeScript | 组合式 API 适配复杂交互 |
| 构建工具 | Vite | 快速冷启动，开箱即用 |
| UI 方案 | Tailwind CSS | 原子化类名，天然适配黑白主题 |
| 状态管理 | Pinia | 轻量、TS 友好，管理多对话状态 |
| 后端 | Node.js + Express | 简单 Agent 服务端，承接 LLM 调用 |
| LLM 接入 | Anthropic 兼容 API（本地代理） | 通过 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` 接入，流式 SSE |
| 数据持久化 | SQLite (sql.js WASM) | 零配置本地存储对话记录 |

---

## 设计决策记录

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | LLM 提供商 | Anthropic 兼容 API（本地代理） | 用户已有本地代理服务 |
| 2 | 内置工具 | 搜索(网页抓取) + 代码执行(浏览器模拟) + 文件操作(虚拟工作区) | 平衡能力与安全 |
| 3 | 用户认证 | JWT + bcrypt，管理员/普通用户 | 多用户支持，管理员可查看所有用户对话 |
| 4 | 数据存储 | SQLite | 零配置本地持久化 |
| 5 | 对话导出 | Markdown + JSON | 满足可读性和可导入两种需求 |
| 6 | 移动端 | 仅桌面端 | 聚焦核心体验 |
| 7 | 消息编辑 | 编辑+分支树结构 | 支持探索式对话，不丢失历史 |
| 8 | 代码执行 | 浏览器端模拟 | 安全隔离，无需沙箱 |
| 9 | 文件操作 | 虚拟工作区（./workspace/） | 可操作文件但限制在安全范围 |
| 10 | System Prompt | 对话级可自定义 | 灵活适配不同场景 |
| 11 | 快捷键 | Enter/Shift+Enter/Ctrl+N 等 | 提升桌面端操作效率 |
| 12 | 搜索实现 | 网页抓取（URL → 文本） | 无需额外 API Key |
| 13 | 数据库查询 | 显式列名（`SELECT id, title, ...`） | `ALTER TABLE ADD COLUMN` 追加的列排在末尾，`SELECT *` + 位置映射会错位 |
| 14 | 无主对话继承 | 首次访问自动绑定当前用户 | 认证上线前创建的对话无 `user_id`，允许已登录用户访问并接管 |
| 15 | 管理员交互 | 先选用户再选会话 | 管理员点击用户只展示对话列表，选中具体会话才显示聊天内容 |

---

## 功能设计文档

| 功能 | 设计文档 | 实现计划 |
|------|---------|---------|
| 多对话管理 | [design](docs/superpowers/specs/2026-06-18-conversation-management-design.md) | — |
| 用户认证与权限 | [design](docs/superpowers/specs/2026-06-18-user-auth-design.md) | — |
| 思考过程可视化 | [design](docs/superpowers/specs/2026-06-18-thought-visualization-design.md) | — |
| 上下文记忆 | [design](docs/superpowers/specs/2026-06-18-context-memory-design.md) | — |
| 消息分支 | [design](docs/superpowers/specs/2026-06-18-message-branching-design.md) | — |
| 对话导出 | [design](docs/superpowers/specs/2026-06-18-export-design.md) | — |
| 键盘快捷键 | [design](docs/superpowers/specs/2026-06-18-keyboard-shortcuts-design.md) | — |
| ReAct Agent | [design](docs/superpowers/specs/2026-06-18-react-agent-design.md) | — |
| 内置工具 | [design](docs/superpowers/specs/2026-06-18-built-in-tools-design.md) | — |
| 数据模型 | [design](docs/superpowers/specs/2026-06-18-data-model-design.md) | — |
| API 设计 | [design](docs/superpowers/specs/2026-06-18-api-design.md) | — |
| 前端设计 | [design](docs/superpowers/specs/2026-06-18-frontend-design.md) | — |
| 对话置顶 | [design](docs/superpowers/specs/2026-06-18-conversation-pinning-design.md) | [plan](docs/superpowers/plans/2026-06-18-conversation-pinning.md) |
