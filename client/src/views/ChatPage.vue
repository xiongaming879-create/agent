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
      <aside
        class="bg-sidebar text-white flex flex-col h-full shrink-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden border-r border-white/10"
        :class="sidebarCollapsed ? 'w-[60px]' : 'w-[280px]'"
      >
        <div class="p-3 border-b border-white/10 flex items-center" :class="sidebarCollapsed ? 'justify-center' : 'justify-between'">
          <button
            class="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-all active:scale-[0.95]"
            @click="toggleSidebar"
            :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          >
            <svg class="w-4 h-4 transition-transform duration-300" :class="sidebarCollapsed ? '' : 'rotate-180'" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
            </svg>
          </button>
          <button
            v-if="!sidebarCollapsed"
            class="px-3 py-1.5 ring-1 ring-white/10 rounded-lg text-[12px] text-white/50 hover:text-white/80 hover:bg-white/10 transition-all active:scale-[0.98]"
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
