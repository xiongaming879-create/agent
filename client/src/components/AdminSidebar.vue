<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useConversationStore } from '../stores/conversation'
import { useMessageStore } from '../stores/message'
import { useAuthStore } from '../stores/auth'
import { authFetch } from '../utils/fetch'
import type { User } from '../types'
import SidebarFooter from './SidebarFooter.vue'

const convStore = useConversationStore()
const msgStore = useMessageStore()
const authStore = useAuthStore()

type AdminView = 'users' | 'conversations'
const adminView = ref<AdminView>('users')
const users = ref<User[]>([])
const selectedUserId = ref<string | null>(null)
const selectedUsername = ref<string | null>(null)

onMounted(async () => {
  await fetchUsers()
})

async function fetchUsers() {
  const res = await authFetch('/api/admin/users')
  if (res.ok) {
    users.value = await res.json()
  }
}

async function selectUser(user: User) {
  selectedUserId.value = user.id
  selectedUsername.value = user.username
  adminView.value = 'conversations'
  await convStore.fetchByUserId(user.id)
}

function backToUsers() {
  selectedUserId.value = null
  selectedUsername.value = null
  adminView.value = 'users'
  convStore.setActive(null)
  msgStore.messages = []
}

function selectConversation(id: string) {
  convStore.setActive(id)
}
</script>

<template>
  <aside class="w-60 bg-sidebar text-white flex flex-col h-full shrink-0 border-r border-white/10">
    <div class="p-4 border-b border-white/10">
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

    <div class="flex-1 overflow-y-auto">
      <template v-if="adminView === 'users'">
        <div
          v-for="user in users"
          :key="user.id"
          class="px-4 py-3 cursor-pointer text-[13px] truncate transition-all hover:bg-white/5 border-l-2 border-l-transparent text-white/60"
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
          :class="conv.id === convStore.activeId ? 'bg-white/10 border-l-white' : 'border-l-transparent hover:bg-white/5'"
          @click="selectConversation(conv.id)"
        >
          <span class="truncate">{{ conv.title }}</span>
        </div>
      </template>
    </div>

    <SidebarFooter />
  </aside>
</template>
