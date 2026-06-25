<script setup lang="ts">
import { ref } from 'vue'
import { useConversationStore } from '../stores/conversation'
import type { Conversation } from '../types'

defineProps<{
  embedded?: boolean
  collapsed?: boolean
}>()

const store = useConversationStore()

const showDeleteConfirm = ref(false)
const deleteTargetId = ref<string | null>(null)
const openMenu = ref<{ convId: string; x: number; y: number; isPinned: boolean } | null>(null)
const pinError = ref('')

function toggleMenu(e: MouseEvent, conv: Conversation) {
  e.stopPropagation()
  if (openMenu.value?.convId === conv.id) {
    openMenu.value = null
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu.value = { convId: conv.id, x: rect.left, y: rect.bottom + 4, isPinned: conv.is_pinned }
}

function closeMenu() {
  openMenu.value = null
}

async function handlePin(conv: Conversation) {
  closeMenu()
  try {
    await store.togglePin(conv.id, !conv.is_pinned)
  } catch (err: unknown) {
    pinError.value = err instanceof Error ? err.message : '操作失败'
    setTimeout(() => { pinError.value = '' }, 1500)
  }
}

function handleDelete(convId: string) {
  closeMenu()
  deleteTargetId.value = convId
  showDeleteConfirm.value = true
}

async function doDelete() {
  if (deleteTargetId.value) {
    await store.remove(deleteTargetId.value)
  }
  showDeleteConfirm.value = false
  deleteTargetId.value = null
}

async function createNew() {
  await store.create()
}
</script>

<template>
  <div class="flex flex-col h-full" @click="closeMenu">
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="conv in store.conversations"
        :key="conv.id"
        class="px-4 py-3 cursor-pointer text-[13px] transition-all duration-200 group border-l-2"
        :class="conv.id === store.activeId ? 'bg-white/10 border-l-white' : 'border-l-transparent hover:bg-white/5'"
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

    <div
      v-if="openMenu"
      class="fixed z-50 bg-[#0A0A0A] rounded-lg ring-1 ring-white/10 text-[13px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      :style="{ left: openMenu.x + 'px', top: openMenu.y + 'px' }"
      @click.stop
    >
      <button
        class="w-full px-6 py-2.5 text-center hover:bg-white/10 transition-colors"
        :class="openMenu.isPinned ? 'text-red-400/80' : 'text-emerald-400/80'"
        @click="handlePin(store.conversations.find(c => c.id === openMenu?.convId)!)"
      >{{ openMenu.isPinned ? '取消置顶' : '置顶对话' }}</button>
      <button
        class="w-full px-6 py-2.5 text-center text-white/50 hover:bg-white/10 transition-colors"
        @click="handleDelete(openMenu.convId)"
      >删除</button>
    </div>

    <div v-if="showDeleteConfirm" class="fixed inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center z-50">
      <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem]">
        <div class="bg-[#0A0A0A] rounded-[1.25rem] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] w-[340px]">
          <h2 class="text-[14px] font-medium text-white mb-2">确认删除</h2>
          <p class="text-[13px] text-white/40 mb-5">确定要删除此对话吗？删除后不可恢复。</p>
          <div class="flex justify-end gap-3">
            <button
              class="px-4 py-1.5 ring-1 ring-white/10 text-[13px] rounded-lg text-white/60 hover:bg-white/10 transition-all"
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

    <div
      v-if="pinError"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white/10 ring-1 ring-white/10 text-white/70 text-[13px] px-4 py-2 rounded-lg z-50"
    >{{ pinError }}</div>
  </div>
</template>
