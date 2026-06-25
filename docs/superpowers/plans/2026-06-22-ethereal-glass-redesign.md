# Ethereal Glass 全局视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将整个项目从混合风格统一为全暗 Ethereal Glass 视觉语言，侧边栏可收起，聊天区全屏。

**Architecture:** 从底层基础（tailwind 配置 + 全局 CSS）开始，再改页面布局（ChatPage 可收起侧边栏），最后逐个改造组件。每一步都保证应用可运行。

**Tech Stack:** Vue 3, Tailwind CSS 3, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `client/tailwind.config.ts` | Modify | 更新主题色值为暗色体系 |
| `client/src/assets/main.css` | Modify | 全局暗色基底，去掉 html.dark 条件覆盖 |
| `client/src/composables/useTheme.ts` | Modify | 简化为始终暗色 |
| `client/src/views/LoginPage.vue` | Modify | 暗底 + glass 登录卡片 |
| `client/src/views/ChatPage.vue` | Modify | 可收起侧边栏 + 全屏聊天 |
| `client/src/components/ConversationList.vue` | Modify | 暗底 glass 风格列表 |
| `client/src/components/SidebarFooter.vue` | Modify | Double-Bezel 头像 + 暗底 |
| `client/src/components/AdminSidebar.vue` | Modify | 暗底 glass 风格 |
| `client/src/components/ChatArea.vue` | Modify | 暗底聊天区 + glass 弹窗 |
| `client/src/components/ChatInput.vue` | Modify | 暗底输入框 + glass 发送按钮 |
| `client/src/components/MessageBubble.vue` | Modify | 暗底消息气泡 |
| `client/src/components/ThoughtStep.vue` | Modify | 暗底思考步骤 |
| `client/src/components/BranchNavigator.vue` | Modify | glass 按钮 |
| `client/src/components/ProfileDialog.vue` | Modify | Double-Bezell glass 弹窗 |
| `client/src/components/SettingsDialog.vue` | Modify | 主题选项改为暗色/跟随系统 |
| `client/src/types/index.ts` | Modify | theme 类型简化 |

---

### Task 1: 更新 Tailwind 主题配置

**Files:**
- Modify: `client/tailwind.config.ts`

- [ ] **Step 1: 更新 tailwind.config.ts**

将整个文件替换为：

```typescript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#0A0A0A',
        'chat-bg': '#080808',
        'msg-border': 'rgba(255,255,255,0.06)',
        'text-muted': 'rgba(255,255,255,0.3)',
        surface: 'rgba(255,255,255,0.03)',
        'surface-hover': 'rgba(255,255,255,0.06)',
        'surface-active': 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        bubble: '12px',
        btn: '6px',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/tailwind.config.ts
git commit -m "【视觉重设计】更新 Tailwind 主题色值为 Ethereal Glass 暗色体系"
```

---

### Task 2: 重写全局 CSS 为暗色基底

**Files:**
- Modify: `client/src/assets/main.css`

- [ ] **Step 1: 替换 main.css**

将整个文件替换为：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: var(--base-font-size, 14px);
  background: #050505;
  color: rgba(255, 255, 255, 0.8);
}

#app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}

button:focus-visible,
textarea:focus-visible,
select:focus-visible,
input:focus-visible,
[tabindex]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
  border-radius: inherit;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.animate-blink {
  animation: blink 1s infinite;
}

/* Markdown body styles (dark) */
.markdown-body p {
  margin-bottom: 0.5em;
  color: rgba(255, 255, 255, 0.8);
}
.markdown-body p:last-child {
  margin-bottom: 0;
}
.markdown-body ul, .markdown-body ol {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}
.markdown-body li {
  margin-bottom: 0.25em;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  font-weight: 600;
  margin-top: 0.75em;
  margin-bottom: 0.5em;
  color: rgba(255, 255, 255, 0.9);
}
.markdown-body h1 { font-size: 1.25em; }
.markdown-body h2 { font-size: 1.125em; }
.markdown-body h3 { font-size: 1em; }
.markdown-body blockquote {
  border-left: 3px solid rgba(255, 255, 255, 0.1);
  padding-left: 0.75em;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.5em;
}
.markdown-body table {
  border-collapse: collapse;
  margin-bottom: 0.5em;
  font-size: 0.875em;
}
.markdown-body th, .markdown-body td {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.375em 0.75em;
}
.markdown-body th {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}
.markdown-body a {
  color: rgba(255, 255, 255, 0.6);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: opacity 0.15s;
}
.markdown-body a:hover {
  opacity: 0.7;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 0.75em 0;
}
.markdown-body img {
  max-width: 100%;
}
.markdown-body code:not(.hljs) {
  background: rgba(255, 255, 255, 0.06);
  padding: 0.125em 0.375em;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  font-size: 0.875em;
  font-family: 'Menlo', 'Consolas', monospace;
  color: rgba(255, 255, 255, 0.85);
}

/* Code blocks */
.markdown-body .hljs-pre {
  position: relative;
  background: #0A0A0A;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 1em;
  margin-bottom: 0.5em;
  overflow-x: auto;
  cursor: pointer;
}
.markdown-body .hljs-pre:hover::after {
  content: '点击复制';
  position: absolute;
  top: 0.375em;
  right: 0.5em;
  font-size: 0.75em;
  color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
  padding: 0.125em 0.5em;
  border-radius: 3px;
}
.markdown-body .hljs-pre code {
  font-size: 0.8125em;
  font-family: 'Menlo', 'Consolas', monospace;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.85);
}

/* Highlight.js GitHub Dark dimmed theme */
.hljs { color: #e0e0e0; background: transparent; }
.hljs-keyword { color: #ff7b72; }
.hljs-string { color: #a5d6ff; }
.hljs-number { color: #79c0ff; }
.hljs-comment { color: #8b949e; font-style: italic; }
.hljs-function { color: #d2a8ff; }
.hljs-title { color: #d2a8ff; }
.hljs-params { color: #e0e0e0; }
.hljs-built_in { color: #ffa657; }
.hljs-literal { color: #79c0ff; }
.hljs-type { color: #ffa657; }
.hljs-attr { color: #79c0ff; }
.hljs-selector-tag { color: #7ee787; }
.hljs-selector-class { color: #d2a8ff; }
.hljs-selector-id { color: #ffa657; }
.hljs-variable { color: #ffa657; }
.hljs-meta { color: #8b949e; }
.hljs-tag { color: #7ee787; }
.hljs-name { color: #7ee787; }
.hljs-attribute { color: #79c0ff; }
.hljs-symbol { color: #79c0ff; }
.hljs-regexp { color: #a5d6ff; }
.hljs-addition { color: #aff5b4; background: rgba(63, 185, 80, 0.15); }
.hljs-deletion { color: #ffdcd7; background: rgba(248, 81, 73, 0.15); }

/* Global input/select/textarea dark overrides */
input, textarea, select {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.08);
}

input::placeholder, textarea::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

::selection {
  background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/assets/main.css
git commit -m "【视觉重设计】全局 CSS 改为暗色基底，去掉 html.dark 条件覆盖"
```

---

### Task 3: 简化 useTheme 为始终暗色

**Files:**
- Modify: `client/src/composables/useTheme.ts`

- [ ] **Step 1: 替换 useTheme.ts**

```typescript
export function useTheme() {
  document.documentElement.classList.add('dark')
}
```

保留 `dark` class 以确保 tailwind dark: 变体仍可使用，但不再切换。

- [ ] **Step 2: Commit**

```bash
git add client/src/composables/useTheme.ts
git commit -m "【视觉重设计】useTheme 简化为始终暗色"
```

---

### Task 4: 重写 LoginPage 为暗色 Glass 风格

**Files:**
- Modify: `client/src/views/LoginPage.vue`

- [ ] **Step 1: 替换 LoginPage.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

const isRegister = ref(false)
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  if (isRegister.value) {
    if (password.value.length < 6) {
      error.value = '密码至少6位'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次密码不一致'
      return
    }
  }

  loading.value = true
  try {
    if (isRegister.value) {
      await authStore.register(username.value.trim(), password.value)
    } else {
      await authStore.login(username.value.trim(), password.value)
    }
    router.push({ name: 'chat' })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-center h-screen w-screen bg-[#050505]">
    <!-- Outer Shell (Double-Bezel) -->
    <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem] w-[380px]">
      <!-- Inner Core -->
      <div class="bg-[#0A0A0A] rounded-[1.25rem] p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
        <h1 class="text-[17px] font-semibold text-white tracking-tight text-center mb-6">Agent Chat</h1>

        <!-- Tab Switcher -->
        <div class="flex gap-1 bg-white/[0.03] ring-1 ring-white/[0.06] rounded-lg p-1 mb-6">
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="!isRegister ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-white/40 hover:text-white/60'"
            @click="isRegister = false"
          >登录</button>
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="isRegister ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-white/40 hover:text-white/60'"
            @click="isRegister = true"
          >注册</button>
        </div>

        <form class="space-y-4" @submit.prevent="submit">
          <input
            v-model="username"
            type="text"
            placeholder="用户名"
            autocomplete="username"
            class="w-full px-4 py-2.5 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <input
            v-model="password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            class="w-full px-4 py-2.5 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <input
            v-if="isRegister"
            v-model="confirmPassword"
            type="password"
            placeholder="确认密码"
            autocomplete="new-password"
            class="w-full px-4 py-2.5 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <p v-if="error" class="text-red-400/80 text-[12px]">{{ error }}</p>
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 bg-white/10 ring-1 ring-white/10 text-white text-[13px] rounded-lg hover:bg-white/[0.15] active:scale-[0.98] transition-all disabled:opacity-40"
          >{{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}</button>
        </form>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/views/LoginPage.vue
git commit -m "【视觉重设计】LoginPage 改为暗色 Double-Bezel Glass 风格"
```

---

### Task 5: ChatPage 可收起侧边栏

**Files:**
- Modify: `client/src/views/ChatPage.vue`

- [ ] **Step 1: 替换 ChatPage.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useConversationStore } from '../stores/conversation'
import { useAuthStore } from '../stores/auth'
import { useKeyboard } from '../composables/useKeyboard'
import { useTheme } from '../composables/useTheme'
import ConversationList from '../components/ConversationList.vue'
import ChatArea from '../components/ChatArea.vue'
import SidebarFooter from '../components/SidebarFooter.vue'
import AdminSidebar from '../components/AdminSidebar.vue'

const convStore = useConversationStore()
const authStore = useAuthStore()

useTheme()

const sidebarCollapsed = ref(localStorage.getItem('sidebar-collapsed') === 'true')

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed.value))
}

onMounted(() => {
  convStore.fetchAll()
})

useKeyboard({
  'Ctrl+N': () => convStore.create(),
  'Ctrl+B': () => toggleSidebar(),
})

watch(() => authStore.user?.font_size, (size) => {
  if (size) document.documentElement.style.setProperty('--base-font-size', `${size}px`)
}, { immediate: true })
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-[#050505]">
    <template v-if="authStore.user?.role !== 'admin'">
      <!-- Sidebar -->
      <aside
        class="bg-sidebar text-white flex flex-col h-full shrink-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden border-r border-white/[0.06]"
        :class="sidebarCollapsed ? 'w-[60px]' : 'w-[280px]'"
      >
        <!-- Toggle button at top -->
        <div class="p-3 border-b border-white/[0.06] flex items-center" :class="sidebarCollapsed ? 'justify-center' : 'justify-between'">
          <button
            class="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all active:scale-[0.95]"
            @click="toggleSidebar"
            :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          >
            <svg class="w-4 h-4 transition-transform duration-300" :class="sidebarCollapsed ? '' : 'rotate-180'" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
            </svg>
          </button>
          <button
            v-if="!sidebarCollapsed"
            class="px-3 py-1.5 ring-1 ring-white/[0.08] rounded-lg text-[12px] text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-all active:scale-[0.98]"
            @click="convStore.create()"
          >+ 新对话</button>
        </div>

        <ConversationList :embedded="true" :collapsed="sidebarCollapsed" />
        <SidebarFooter :collapsed="sidebarCollapsed" />
      </aside>
    </template>
    <template v-else>
      <AdminSidebar />
    </template>
    <ChatArea />
  </div>
</template>
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/views/ChatPage.vue
git commit -m "【视觉重设计】ChatPage 可收起侧边栏 + 全屏聊天"
```

---

### Task 6: 重写 ConversationList 为暗色 Glass 风格

**Files:**
- Modify: `client/src/components/ConversationList.vue`

- [ ] **Step 1: 替换 ConversationList.vue template 和 props**

在 `<script setup>` 中添加 `collapsed` prop:

```typescript
defineProps<{
  embedded?: boolean
  collapsed?: boolean
}>()
```

替换整个 `<template>` 为：

```html
<template>
  <div class="flex flex-col h-full" @click="closeMenu">
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="conv in store.conversations"
        :key="conv.id"
        class="px-4 py-3 cursor-pointer text-[13px] transition-all duration-200 group border-l-2"
        :class="conv.id === store.activeId ? 'bg-white/[0.06] border-l-white' : 'border-l-transparent hover:bg-white/[0.03]'"
        @click="store.setActive(conv.id)"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center min-w-0">
            <svg v-if="conv.is_pinned && !collapsed" class="w-3.5 h-3.5 mr-1.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/></svg>
            <span class="truncate text-white/70" :class="{ 'text-center w-full': collapsed }">{{ collapsed ? conv.title.charAt(0) : conv.title }}</span>
          </div>
          <button
            v-if="!collapsed"
            class="opacity-0 group-hover:opacity-100 focus:opacity-100 text-white/30 hover:text-white/60 ml-2 shrink-0 transition-opacity"
            @click="toggleMenu($event, conv)"
          >
            <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Dropdown Menu -->
    <div
      v-if="openMenu"
      class="fixed z-50 bg-[#0A0A0A] rounded-lg ring-1 ring-white/[0.08] text-[13px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      :style="{ left: openMenu.x + 'px', top: openMenu.y + 'px' }"
      @click.stop
    >
      <button
        class="w-full px-6 py-2.5 text-center hover:bg-white/[0.06] transition-colors"
        :class="openMenu.isPinned ? 'text-red-400/80' : 'text-emerald-400/80'"
        @click="handlePin(store.conversations.find(c => c.id === openMenu?.convId)!)"
      >{{ openMenu.isPinned ? '取消置顶' : '置顶对话' }}</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/[0.06] transition-colors"
        @click="handleDelete(openMenu.convId)"
      >删除</button>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center z-50">
      <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem]">
        <div class="bg-[#0A0A0A] rounded-[1.25rem] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] w-[340px]">
          <h2 class="text-[14px] font-medium text-white mb-2">确认删除</h2>
          <p class="text-[13px] text-white/40 mb-5">确定要删除此对话吗？删除后不可恢复。</p>
          <div class="flex justify-end gap-3">
            <button
              class="px-4 py-1.5 ring-1 ring-white/[0.08] text-[13px] rounded-lg text-white/60 hover:bg-white/[0.06] transition-all"
              @click="showDeleteConfirm = false"
            >取消</button>
            <button
              class="px-4 py-1.5 bg-red-500/20 ring-1 ring-red-500/30 text-red-400 text-[13px] rounded-lg hover:bg-red-500/30 transition-all active:scale-[0.98]"
              @click="doDelete"
            >删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pin Error Toast -->
    <div
      v-if="pinError"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white/[0.06] ring-1 ring-white/[0.08] text-white/70 text-[13px] px-4 py-2 rounded-lg z-50"
    >{{ pinError }}</div>
  </div>
</template>
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ConversationList.vue
git commit -m "【视觉重设计】ConversationList 暗色 Glass 风格"
```

---

### Task 7: 重写 SidebarFooter 为暗色 + collapsed 支持

**Files:**
- Modify: `client/src/components/SidebarFooter.vue`

- [ ] **Step 1: 替换 SidebarFooter.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, avatarSrc } from '../composables/useAvatar'
import SettingsDialog from './SettingsDialog.vue'
import ProfileDialog from './ProfileDialog.vue'

defineProps<{
  collapsed?: boolean
}>()

const authStore = useAuthStore()
const router = useRouter()

const showSettings = ref(false)
const showProfile = ref(false)

function logout() {
  authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="border-t border-white/[0.06] p-3">
    <div class="flex items-center gap-2" :class="collapsed ? 'justify-center' : ''">
      <button
        class="w-8 h-8 rounded-full flex items-center justify-center text-sm hover:bg-white/[0.06] transition-colors shrink-0 overflow-hidden relative group"
        :style="!isAvatarImagePath(authStore.user?.avatar || '') ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U') } : { backgroundColor: 'rgba(255,255,255,0.05)' }"
        @click="showProfile = true"
        :title="authStore.user?.username"
      >
        <img
          v-if="isAvatarImagePath(authStore.user?.avatar || '')"
          :src="avatarSrc(authStore.user?.avatar || '')"
          alt="avatar"
          class="w-full h-full object-cover"
        />
        <span v-else class="text-white text-xs font-medium">
          {{ getInitialLetter(authStore.user?.username || 'U') }}
        </span>
      </button>
      <span v-if="!collapsed" class="text-[13px] text-white/50 truncate flex-1">{{ authStore.user?.username }}</span>
      <button
        v-if="!collapsed"
        class="text-white/30 hover:text-white/60 transition-colors p-1"
        @click="showSettings = true"
        title="设置"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </button>
    </div>
  </div>

  <SettingsDialog v-if="showSettings" @close="showSettings = false" />
  <ProfileDialog v-if="showProfile" @close="showProfile = false" @logout="logout" />
</template>
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SidebarFooter.vue
git commit -m "【视觉重设计】SidebarFooter 暗色 + collapsed 支持"
```

---

### Task 8: 重写 ChatArea 为暗色 Glass 风格

**Files:**
- Modify: `client/src/components/ChatArea.vue`

- [ ] **Step 1: 替换 ChatArea.vue template 部分**

在 `<template>` 中，替换所有内容为：

```html
<template>
  <div class="flex-1 flex flex-col h-full bg-chat-bg">
    <!-- Welcome page -->
    <div v-if="!hasActiveConv" class="flex-1 flex flex-col items-center justify-center text-white/30">
      <svg class="w-20 h-20 opacity-10 mb-4" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
      <h2 class="text-[15px] font-medium text-white/50 mb-1">Agent Chat</h2>
      <p class="text-[13px] text-white/25">{{ isAdmin ? '选择左侧用户，再点击其历史会话查看' : '按 Ctrl+N 创建新对话' }}</p>
    </div>

    <!-- Chat content -->
    <template v-else>
    <!-- Header -->
    <div class="px-6 py-3 border-b border-white/[0.06] flex items-center justify-between">
      <h1 class="text-[13px] font-medium text-white/70">
        {{ convStore.conversations.find(c => c.id === convStore.activeId)?.title || 'Agent Chat' }}
      </h1>
      <button
        class="text-white/30 text-[12px] hover:text-white/60 transition-colors"
        @click="showPromptDialog = true"
      >System Prompt</button>
    </div>

    <!-- Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
      <template v-for="(msg, i) in displayMessages" :key="msg.id">
        <MessageBubble
          :message="msg"
          :siblings="getSiblingInfo(msg).siblings"
          :sibling-index="getSiblingInfo(msg).index"
          :is-last="i === displayMessages.length - 1 && msg.role === 'assistant'"
          :is-streaming="false"
          @switch-branch="(idx) => handleSwitchBranch(msg.id, msg.parent_id, idx)"
          @regenerate="handleRegenerate(msg.id)"
        />
      </template>
      <div v-if="msgStore.isStreaming && msgStore.streamingMessage" class="mr-auto">
        <MessageBubble
          :message="msgStore.streamingMessage"
          :siblings="[msgStore.streamingMessage]"
          :sibling-index="0"
          :is-last="true"
          :is-streaming="true"
        />
      </div>
    </div>

    <!-- Input -->
    <div v-if="showInput" class="border-t border-white/[0.06] p-6">
      <ChatInput :disabled="msgStore.isStreaming" @send="handleSend" />
    </div>

    <!-- System Prompt Dialog -->
    <div v-if="showPromptDialog" class="fixed inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center z-50">
      <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem]">
        <div class="bg-[#0A0A0A] rounded-[1.25rem] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] w-[480px]">
          <h2 class="text-[14px] font-medium text-white mb-4">System Prompt</h2>
          <textarea
            v-model="systemPrompt"
            class="w-full p-3 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg text-[13px] text-white/80 resize-none focus:ring-white/20 transition-all"
            rows="6"
            placeholder="设置此对话的系统提示词..."
          />
          <div class="flex justify-end gap-3 mt-4">
            <button
              class="px-4 py-1.5 ring-1 ring-white/[0.08] text-[13px] rounded-lg text-white/60 hover:bg-white/[0.06] transition-all"
              @click="showPromptDialog = false"
            >取消</button>
            <button
              class="px-4 py-1.5 bg-white/10 ring-1 ring-white/10 text-[13px] rounded-lg text-white hover:bg-white/[0.15] active:scale-[0.98] transition-all"
              @click="saveSystemPrompt"
            >保存</button>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: 验证编译**

Run: `cd client && npx vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatArea.vue
git commit -m "【视觉重设计】ChatArea 暗色 Glass 风格 + glass 弹窗"
```

---

### Task 9: 重写 ChatInput 为暗色 Glass 风格

**Files:**
- Modify: `client/src/components/ChatInput.vue`

- [ ] **Step 1: 替换 ChatInput.vue template**

```html
<template>
  <div class="flex gap-3 flex-1 items-end">
    <textarea
      ref="textareaRef"
      v-model="content"
      class="flex-1 p-3 h-20 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg text-[13px] text-white/80 resize-none overflow-y-auto focus:ring-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      placeholder="输入消息..."
      rows="3"
      :disabled="disabled"
      @keydown="handleKeydown"
    />
    <button
      class="shrink-0 h-10 px-5 bg-white/10 ring-1 ring-white/10 text-white text-[13px] rounded-lg hover:bg-white/[0.15] active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
      :disabled="!content.trim() || disabled"
      @click="send"
    >
      <svg v-if="disabled" class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span v-if="!disabled">发送</span>
    </button>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ChatInput.vue
git commit -m "【视觉重设计】ChatInput 暗色 Glass 风格"
```

---

### Task 10: 重写 MessageBubble 为暗色 Glass 风格

**Files:**
- Modify: `client/src/components/MessageBubble.vue`

- [ ] **Step 1: 替换 MessageBubble.vue template 部分**

```html
<template>
  <div class="group relative flex gap-2 w-[40%] min-w-0" :class="message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'">
    <!-- Avatar -->
    <div class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ring-1 ring-white/[0.08]" :class="message.role === 'user' ? 'bg-white/[0.08]' : 'bg-white/[0.04]'">
      <template v-if="message.role === 'user'"><span class="text-white/60 text-xs">👤</span></template>
      <template v-else><span class="text-white/60 text-xs">🤖</span></template>
    </div>

    <div class="relative min-w-0 flex-1">
      <!-- Timestamp -->
      <span v-if="formattedTime" class="absolute -top-4 left-0 text-white/20 text-[11px] whitespace-nowrap">{{ formattedTime }}</span>

    <div
      class="px-4 py-3 rounded-lg min-w-0"
      :class="message.role === 'user'
        ? 'bg-white/[0.08] text-white/80'
        : 'bg-white/[0.03] ring-1 ring-white/[0.06] text-white/80'"
    >
      <!-- Thought process (assistant only) -->
      <div v-if="message.role === 'assistant' && message.thought_steps.length > 0" class="mb-2">
        <button
          class="flex items-center gap-1 text-white/30 text-[12px] hover:text-white/50 transition-colors"
          @click="showThoughts = !showThoughts"
        >
          <span :class="showThoughts ? 'rotate-90' : ''" class="inline-block transition-transform">&#9654;</span>
          思考过程 ({{ stepCount }}轮)
        </button>
        <div v-if="showThoughts" class="mt-2 space-y-1.5 pl-2">
          <ThoughtStep v-for="(step, i) in message.thought_steps" :key="i" :step="step" :is-last="i === message.thought_steps.length - 1" :is-streaming="isTyping" />
        </div>
        <div class="border-b border-white/[0.06] mt-2 mb-2" />
      </div>

      <!-- Content -->
      <div v-if="message.role === 'assistant'" class="markdown-body text-[13px] leading-normal break-words overflow-hidden" @click="copyCodeBlock">
        <template v-if="isTyping && !message.content">
          <svg class="inline-block w-4 h-4 align-middle text-white/30 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </template>
        <div v-else v-html="renderedContent" /><span v-if="isTyping" class="inline-block w-[2px] h-[14px] bg-white/60 ml-[1px] align-middle animate-blink" />
      </div>
      <div v-else class="whitespace-pre-wrap text-[13px] leading-normal break-words overflow-hidden">
        {{ message.content }}
      </div>

      <!-- Actions -->
      <div v-if="!isTyping" class="flex items-center gap-3 mt-2">
        <BranchNavigator
          :siblings="siblings"
          :current-index="siblingIndex"
          @prev="emit('switchBranch', siblingIndex - 1)"
          @next="emit('switchBranch', siblingIndex + 1)"
        />
        <button
          v-if="message.role === 'assistant' && isLast"
          class="text-white/30 text-[12px] hover:text-white/60 transition-colors"
          @click="emit('regenerate')"
        >重新生成</button>
      </div>
    </div>

    <!-- Copy button -->
    <button
      v-if="message.content && !isTyping"
      class="absolute bottom-1 right-2 p-1 rounded-md transition-all"
      :class="copied ? 'opacity-80' : 'opacity-0 group-hover:opacity-100 hover:!opacity-100'"
      :title="copied ? '已复制' : '复制'"
      @click="copyContent"
    >
      <svg v-if="!copied" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke-width="2" />
      </svg>
      <svg v-else class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/MessageBubble.vue
git commit -m "【视觉重设计】MessageBubble 暗色 Glass 风格"
```

---

### Task 11: 重写 ThoughtStep 和 BranchNavigator 为暗色风格

**Files:**
- Modify: `client/src/components/ThoughtStep.vue`
- Modify: `client/src/components/BranchNavigator.vue`

- [ ] **Step 1: 替换 ThoughtStep.vue template**

```html
<template>
  <div class="thought-step">
    <div v-if="step.type === 'thought'" class="text-white/30 italic text-[13px] leading-normal break-words overflow-hidden">
      {{ step.content }}<svg v-if="isLast && isStreaming" class="inline-block w-3 h-3 ml-1 align-middle text-white/30 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
    <div v-else-if="step.type === 'action'" class="flex items-center gap-2 text-[13px] leading-normal">
      <span class="bg-white/[0.08] text-white/60 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0">
        {{ step.tool_name }}
      </span>
      <span class="text-white/30 break-words overflow-hidden">{{ step.content }}</span>
    </div>
    <div v-else-if="step.type === 'observation'" class="text-white/30 text-[13px] leading-normal pl-4 border-l-2 border-white/[0.08] break-words overflow-hidden">
      {{ step.content }}
    </div>
  </div>
</template>
```

- [ ] **Step 2: 替换 BranchNavigator.vue template**

```html
<template>
  <div v-if="siblings.length > 1" class="flex items-center gap-2 text-[13px] text-white/30 select-none">
    <button
      class="px-2 py-1 ring-1 ring-white/[0.08] rounded-md hover:bg-white/[0.08] hover:text-white/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === 0"
      @click="$emit('prev')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
    </button>
    <span class="text-[11px]">{{ currentIndex + 1 }}/{{ siblings.length }}</span>
    <button
      class="px-2 py-1 ring-1 ring-white/[0.08] rounded-md hover:bg-white/[0.08] hover:text-white/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === siblings.length - 1"
      @click="$emit('next')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
    </button>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ThoughtStep.vue client/src/components/BranchNavigator.vue
git commit -m "【视觉重设计】ThoughtStep + BranchNavigator 暗色 Glass 风格"
```

---

### Task 12: 重写 ProfileDialog 为 Double-Bezel Glass 风格

**Files:**
- Modify: `client/src/components/ProfileDialog.vue`

- [ ] **Step 1: 替换 ProfileDialog.vue**

```vue
<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, avatarSrc } from '../composables/useAvatar'

defineEmits<{
  close: []
  logout: []
}>()

const authStore = useAuthStore()

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 backdrop-blur-2xl flex items-center justify-center z-50" @click.self="$emit('close')">
    <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem]">
      <div class="bg-[#0A0A0A] rounded-[1.25rem] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] w-[340px]">
        <div class="flex flex-col items-center gap-4">
          <!-- Avatar with Double-Bezel -->
          <div class="bg-white/5 ring-1 ring-white/10 p-[3px] rounded-full">
            <div
              class="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
              :style="!isAvatarImagePath(authStore.user?.avatar || '') ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U') } : { backgroundColor: '#1a1a1a' }"
            >
              <img
                v-if="isAvatarImagePath(authStore.user?.avatar || '')"
                :src="avatarSrc(authStore.user?.avatar || '')"
                alt="avatar"
                class="w-full h-full object-cover"
              />
              <span v-else class="text-white text-lg font-medium">
                {{ getInitialLetter(authStore.user?.username || 'U') }}
              </span>
            </div>
          </div>

          <h2 class="text-[14px] font-medium text-white">{{ authStore.user?.username }}</h2>
          <span
            class="px-2.5 py-0.5 text-[10px] rounded-full tracking-wide"
            :class="authStore.user?.role === 'admin' ? 'bg-white/10 text-white/60 ring-1 ring-white/[0.08]' : 'bg-white/[0.04] text-white/30 ring-1 ring-white/[0.06]'"
          >{{ authStore.user?.role === 'admin' ? '管理员' : '普通用户' }}</span>
        </div>

        <div class="text-[11px] text-white/20 text-center mt-4">
          注册于 {{ authStore.user?.created_at ? formatDate(authStore.user.created_at) : '-' }}
        </div>

        <div class="border-t border-white/[0.06] mt-5 pt-4">
          <button
            class="w-full py-2.5 text-[13px] text-red-400/70 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/[0.08] active:scale-[0.98] transition-all"
            @click="$emit('logout')"
          >退出登录</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ProfileDialog.vue
git commit -m "【视觉重设计】ProfileDialog Double-Bezel Glass 风格"
```

---

### Task 13: 更新 SettingsDialog 主题选项

**Files:**
- Modify: `client/src/components/SettingsDialog.vue`

- [ ] **Step 1: 在 SettingsDialog.vue 中修改 themes 数组**

找到：
```typescript
const themes: { value: 'light' | 'dark' | 'auto'; label: string; icon: string }[] = [
  { value: 'light', label: '亮色', icon: '☀' },
  { value: 'dark', label: '暗色', icon: '☾' },
  { value: 'auto', label: '系统', icon: '◐' },
]
```

替换为：
```typescript
const themes: { value: 'dark' | 'auto'; label: string; icon: string }[] = [
  { value: 'dark', label: '暗色', icon: '☾' },
  { value: 'auto', label: '系统', icon: '◐' },
]
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/SettingsDialog.vue
git commit -m "【视觉重设计】SettingsDialog 主题选项移除亮色"
```

---

### Task 14: 重写 AdminSidebar 为暗色 Glass 风格

**Files:**
- Modify: `client/src/components/AdminSidebar.vue`

- [ ] **Step 1: 替换 AdminSidebar.vue template**

```html
<template>
  <aside class="w-60 bg-sidebar text-white flex flex-col h-full shrink-0 border-r border-white/[0.06]">
    <!-- Header -->
    <div class="p-4 border-b border-white/[0.06]">
      <template v-if="adminView === 'users'">
        <h2 class="text-[13px] font-medium text-white/70">用户管理</h2>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <button
            class="text-white/30 hover:text-white/60 transition-colors"
            @click="backToUsers"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <span class="text-[13px] font-medium text-white/70 truncate">{{ selectedUsername }}</span>
        </div>
      </template>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <template v-if="adminView === 'users'">
        <div
          v-for="user in users"
          :key="user.id"
          class="px-4 py-3 cursor-pointer text-[13px] truncate transition-all hover:bg-white/[0.03] border-l-2 border-l-transparent text-white/60"
          @click="selectUser(user)"
        >
          <div class="flex items-center gap-2">
            <span class="text-base">{{ user.avatar }}</span>
            <span class="truncate">{{ user.username }}</span>
            <span v-if="user.role === 'admin'" class="text-[10px] text-white/15 ml-auto shrink-0">管理员</span>
          </div>
        </div>
      </template>
      <template v-else>
        <div
          v-for="conv in convStore.conversations"
          :key="conv.id"
          class="px-4 py-3 cursor-pointer text-[13px] truncate transition-all border-l-2 text-white/60"
          :class="conv.id === convStore.activeId ? 'bg-white/[0.06] border-l-white' : 'border-l-transparent hover:bg-white/[0.03]'"
          @click="selectConversation(conv.id)"
        >
          <span class="truncate">{{ conv.title }}</span>
        </div>
      </template>
    </div>

    <SidebarFooter />
  </aside>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AdminSidebar.vue
git commit -m "【视觉重设计】AdminSidebar 暗色 Glass 风格"
```

---

### Task 15: 全量回归测试

**Files:**
- None (verification only)

- [ ] **Step 1: 运行所有测试**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 2: 前端构建验证**

Run: `cd client && npx vite build`
Expected: Build succeeds

- [ ] **Step 3: 手动冒烟测试**

1. 启动 `cd server && npm run dev` + `cd client && npm run dev`
2. 打开 `http://localhost:5173`
3. 验证：登录页暗色 glass 风格、聊天区暗色、侧边栏可收起、消息气泡暗色、设置弹窗 glass 风格
