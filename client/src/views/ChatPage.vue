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

// 字号缩放只作用于消息区内容（ChatArea 内层 --chat-zoom），页面布局不动
watch(() => authStore.user?.font_size, (size) => {
  if (size) document.documentElement.style.setProperty('--chat-zoom', String(size / 14))
}, { immediate: true })
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-chat-bg">
    <template v-if="authStore.user?.role !== 'admin'">
      <aside
        class="bg-sidebar text-main flex flex-col h-full shrink-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden border-r border-glass-border"
        :class="sidebarCollapsed ? 'w-[60px]' : 'w-[280px]'"
      >
        <div class="p-3 border-b border-glass-border flex items-center" :class="sidebarCollapsed ? 'justify-center' : 'justify-between'">
          <button
            class="w-8 h-8 rounded-lg flex items-center justify-center text-mute hover:text-soft hover:bg-glass-fill transition-all active:scale-[0.95]"
            @click="toggleSidebar"
            :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          >
            <svg class="w-4 h-4 transition-transform duration-300" :class="sidebarCollapsed ? '' : 'rotate-180'" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
            </svg>
          </button>
          <button
            v-if="!sidebarCollapsed"
            class="px-3 py-1.5 rounded-lg text-[12px] text-mute hover:text-main hover:bg-glass-fill transition-all active:scale-[0.98]"
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
