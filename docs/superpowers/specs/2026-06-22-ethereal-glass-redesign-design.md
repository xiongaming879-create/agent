# Ethereal Glass 全局视觉重设计

## Problem

项目当前存在两套视觉语言混搭：侧边栏暗色（#1A1A1A）、聊天区浅灰（#F5F5F5）、弹窗白底。SettingsDialog 已改为 Ethereal Glass 暗色风格，与其余组件形成割裂。需要统一到一套设计语言。

## Design

### 风格基调：Ethereal Glass

- **主背景**：OLED 黑 `#050505`，全页面统一暗色
- **侧边栏**：`#0A0A0A` + `ring-1 ring-white/[0.06]` 细线边框
- **聊天区**：`#080808`，略深于侧边栏形成层次
- **毛玻璃卡片**：`bg-white/[0.03] backdrop-blur-xl ring-white/[0.06]`
- **交互态**：hover `bg-white/[0.06]`，active `scale-[0.98]`
- **文字**：主文字 `text-white/80`，次要 `text-white/30`，辅助 `text-white/15`
- **圆角**：大容器 `rounded-[1rem]`，按钮 `rounded-lg`，头像 `rounded-full`
- **动效**：统一 `cubic-bezier(0.32,0.72,0,1)` spring 曲线

### 布局变更：可收起侧边栏 + 全屏聊天

- **侧边栏**：可收起/展开，收起时 60px 图标栏，展开时 280px
- **聊天区**：`flex-1` 全屏，无白底
- **状态持久化**：展开/收起状态存 localStorage `sidebar-collapsed`
- **动画**：`transition-all duration-500 cubic-bezier(0.32,0.72,0,1)`

### 色彩体系

```
背景层级（由深到浅）:
#050505  →  #080808  →  #0A0A0A  →  white/[0.03]  →  white/[0.06]
页面底色    聊天区     侧边栏     卡片/表面        交互态

文字层级:
white/80  →  white/30  →  white/15
主文字       次要文字     辅助/标签
```

- 无彩色强调色，纯靠 white 透明度梯度
- 代码块：保持 GitHub Dark dimmed
- 错误/删除：`text-red-400/80`
- 链接：`text-white/60 underline`
- 选中/高亮：`bg-white/[0.08]`

### 主题变更

去掉亮色模式，SettingsDialog 主题选项只保留"暗色"和"跟随系统"。系统偏好亮色时仍使用暗色（本项目不再维护亮色方案）。

## Components by File

### `client/tailwind.config.ts`
更新主题色值：sidebar→#0A0A0A, chat-bg→#080808, msg-border→white/[0.06], text-muted→white/30

### `client/src/assets/main.css`
- 去掉所有 `html.dark` 条件覆盖（全局暗色不再需要暗色模式切换）
- body 默认 `background: #050505; color: rgba(255,255,255,0.8)`
- 滚动条颜色适配暗色
- focus-visible ring 适配暗色
- markdown-body 样式全部用暗色基底重写

### `client/src/views/LoginPage.vue`
暗底 + glass 登录卡片，tab 切换用 segmented control

### `client/src/views/ChatPage.vue`
全暗底，侧边栏可收起（新增 collapsed ref + localStorage 持久化）

### `client/src/components/ConversationList.vue`
暗底列表，active 项 `bg-white/[0.06]` + 左侧白线，hover `bg-white/[0.03]`，新建按钮 glass 风格，右键菜单 glass 卡片

### `client/src/components/SidebarFooter.vue`
暗底，头像用 Double-Bezel 圆环（和 SettingsDialog 一致）

### `client/src/components/ChatArea.vue`
暗底 `#080808`，header `border-white/[0.06]`，system prompt dialog glass 风格

### `client/src/components/ChatInput.vue`
暗底 textarea `bg-white/[0.04] ring-white/[0.08]`，发送按钮 glass pill

### `client/src/components/MessageBubble.vue`
用户消息 `bg-white/[0.08]`，助手消息 `bg-white/[0.03]`，时间戳 `text-white/30`，复制按钮 glass

### `client/src/components/ThoughtStep.vue`
`bg-white/[0.03]` 卡片，action 标签 `bg-white/10 text-white/60`

### `client/src/components/BranchNavigator.vue`
glass 按钮 `bg-white/[0.06]`，hover `bg-white/[0.1]`

### `client/src/components/ProfileDialog.vue`
和 SettingsDialog 同款 Double-Bezel glass 风格

### `client/src/components/SettingsDialog.vue`
已完成，保持不变。主题选项改为两选一（暗色/跟随系统）

### `client/src/components/AdminSidebar.vue`
和 ConversationList 同款暗底列表风格

### `client/src/stores/auth.ts`
主题类型从 `'light' | 'dark' | 'auto'` 简化，后端仍保留三值但前端不再提供亮色选项

## What This Enables

- 统一的全暗 Ethereal Glass 视觉语言
- 更大的聊天区（侧边栏可收起）
- 毛玻璃质感和微交互动效
- 无需维护亮色模式

## What This Drops

- 亮色主题（light mode）
- 白底/浅灰背景
- 原生 HTML select/input 默认样式
