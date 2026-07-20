<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useConversationStore } from '../stores/conversation'
import { useMessageStore } from '../stores/message'
import { useAuthStore } from '../stores/auth'
import type { Complexity } from '../types'
import MessageBubble from './MessageBubble.vue'
import ChatInput from './ChatInput.vue'

const convStore = useConversationStore()
const msgStore = useMessageStore()
const authStore = useAuthStore()

const isAdmin = computed(() => authStore.user?.role === 'admin')
const hasActiveConv = computed(() => !!convStore.activeId)
const chatContainer = ref<HTMLElement | null>(null)
const showPromptDialog = ref(false)
const systemPrompt = ref('')
const currentComplexity = ref<Complexity>('medium')

// Branch tracking: parent_id -> selected child index
const branchSelections = ref<Record<string, number>>({})

// Hide input when admin is viewing another user's conversation
const showInput = computed(() => {
  if (authStore.user?.role !== 'admin') return true
  return !authStore.user || convStore.conversations.some(c => c.id === convStore.activeId && c.user_id === authStore.user!.id)
})
// Build the display messages (active branch path)
const displayMessages = computed(() => {
  return msgStore.messages
})

// Load messages when conversation changes
watch(() => convStore.activeId, async (id) => {
  if (id) {
    // Clear streaming state from previous conversation
    if (msgStore.isStreaming) {
      msgStore.streamingConvId = null
      msgStore.streamingMessage = null
      msgStore.isStreaming = false
    }
    await msgStore.fetchMessages(id)
    branchSelections.value = {}
    const conv = convStore.conversations.find(c => c.id === id)
    systemPrompt.value = conv?.system_prompt || ''
    await scrollToBottom()
  }
}, { immediate: true })

// Auto scroll on new messages or streaming content update
watch(() => msgStore.messages.length, async () => {
  await scrollToBottom()
})

watch(() => msgStore.streamingMessage?.content, async () => {
  await scrollToBottom()
})

async function scrollToBottom() {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' })
  }
}

async function handleSend(content: string, complexity: Complexity) {
  if (!convStore.activeId) {
    await convStore.create()
  }
  // Auto-title: use first user message content (max 10 chars + ellipsis)
  const conv = convStore.conversations.find(c => c.id === convStore.activeId)
  if (conv && (conv.title === '新对话' || !conv.title)) {
    const title = content.length > 22 ? content.slice(0, 22) + '...' : content
    await convStore.update(conv.id, { title })
  }
  await msgStore.sendMessage(convStore.activeId!, content, undefined, complexity)
  await scrollToBottom()
}

async function handleRegenerate(messageId: string) {
  if (!convStore.activeId) return
  await msgStore.regenerateMessage(convStore.activeId, messageId, currentComplexity.value)
  await scrollToBottom()
}

function handleComplexityChange(complexity: Complexity) {
  currentComplexity.value = complexity
}

function handleSwitchBranch(messageId: string, parentId: string | null, index: number) {
  const key = parentId || '__root__'
  branchSelections.value[key] = index
}

async function saveSystemPrompt() {
  if (!convStore.activeId) return
  await convStore.update(convStore.activeId, {
    system_prompt: systemPrompt.value || null,
  })
  showPromptDialog.value = false
}

function getSiblingInfo(message: { id: string; parent_id: string | null }) {
  const siblings = msgStore.getSiblings(message.parent_id)
  const key = message.parent_id || '__root__'
  const selectedIdx = branchSelections.value[key] ?? siblings.findIndex(s => s.id === message.id)
  return { siblings, index: selectedIdx }
}
</script>

<template>
  <div class="flex-1 flex flex-col h-full bg-chat-bg">
    <div v-if="!hasActiveConv" class="flex-1 flex flex-col items-center justify-center text-white/30">
      <svg class="w-20 h-20 opacity-10 mb-4" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
      <h2 class="text-[15px] font-medium text-white/50 mb-1">Agent Chat</h2>
      <p class="text-[13px] text-white/25">{{ isAdmin ? '选择左侧用户，再点击其历史会话查看' : '按 Ctrl+N 创建新对话' }}</p>
    </div>

    <template v-else>
    <div class="px-6 py-3 border-b border-neutral-700 flex items-center justify-between">
      <h1 class="text-[13px] font-medium text-neutral-800">
        {{ convStore.conversations.find(c => c.id === convStore.activeId)?.title || 'Agent Chat' }}
      </h1>
      <button
        class="text-neutral-500 text-[12px] hover:text-neutral-300 transition-colors"
        @click="showPromptDialog = true"
      >System Prompt</button>
    </div>

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

    <div v-if="showInput" class="border-t border-white/10 p-6">
      <ChatInput
        :disabled="msgStore.isStreaming"
        @send="handleSend"
        @update:complexity="handleComplexityChange"
      />
    </div>

    <div v-if="showPromptDialog" class="fixed inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center z-50">
      <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem]">
        <div class="bg-[#0A0A0A] rounded-[1.25rem] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] w-[480px]">
          <h2 class="text-[14px] font-medium text-white mb-4">System Prompt</h2>
          <textarea
            v-model="systemPrompt"
            class="w-full p-3 bg-white/5 ring-1 ring-white/10 rounded-lg text-[13px] text-white/80 resize-none focus:ring-white/20 transition-all"
            rows="6"
            placeholder="设置此对话的系统提示词..."
          />
          <div class="flex justify-end gap-3 mt-4">
            <button
              class="px-4 py-1.5 ring-1 ring-white/10 text-[13px] rounded-lg text-white/60 hover:bg-white/10 transition-all"
              @click="showPromptDialog = false"
            >取消</button>
            <button
              class="px-4 py-1.5 bg-white/10 ring-1 ring-white/10 text-[13px] rounded-lg text-white hover:bg-white/15 active:scale-[0.98] transition-all"
              @click="saveSystemPrompt"
            >保存</button>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
