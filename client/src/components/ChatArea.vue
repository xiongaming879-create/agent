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

// 流式消息按 conversationId 隔离,只渲染当前对话的
const streamingMessage = computed(() => msgStore.getStreamingMessage(convStore.activeId))

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
watch(() => convStore.activeId, async (id, oldId) => {
  // 中止旧对话的流式请求(分支选择保留在 store,按 conversationId 隔离)
  if (oldId) {
    msgStore.abortStreaming(oldId)
  }
  if (id) {
    await msgStore.fetchMessages(id)
    const conv = convStore.conversations.find(c => c.id === id)
    systemPrompt.value = conv?.system_prompt || ''
    await scrollToBottom()
  }
}, { immediate: true })

// Auto scroll on new messages or streaming content update
watch(() => msgStore.messages.length, async () => {
  await scrollToBottom()
})

watch(() => streamingMessage.value?.content, async () => {
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
  if (convStore.activeId) {
    msgStore.setBranchSelection(convStore.activeId, parentId, index)
  }
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
  const selectedIdx = msgStore.getBranchSelection(convStore.activeId, message.parent_id)
    ?? siblings.findIndex(s => s.id === message.id)
  return { siblings, index: selectedIdx }
}
</script>

<template>
  <div class="flex-1 min-w-0 flex flex-col h-full bg-chat-bg">
    <div v-if="!hasActiveConv" class="flex-1 flex flex-col items-center justify-center">
      <div class="relative mb-5">
        <div class="absolute inset-0 -m-6 rounded-full bg-accent/10 blur-2xl" />
        <div class="relative w-14 h-14 rounded-2xl bg-surface flex items-center justify-center">
          <svg class="w-7 h-7 text-accent/80" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
        </div>
      </div>
      <h2 class="text-[15px] font-medium text-main tracking-tight mb-1.5">Agent Chat</h2>
      <p class="text-[13px] text-mute">{{ isAdmin ? '选择左侧用户，再点击其历史会话查看' : '按 Ctrl+N 创建新对话' }}</p>
    </div>

    <template v-else>
    <div class="px-6 py-3 border-b border-glass-border flex items-center justify-between">
      <h1 class="text-[13px] font-medium text-soft truncate">
        {{ convStore.conversations.find(c => c.id === convStore.activeId)?.title || 'Agent Chat' }}
      </h1>
      <button
        class="text-mute text-[12px] hover:text-soft transition-colors shrink-0"
        @click="showPromptDialog = true"
      >System Prompt</button>
    </div>

    <div ref="chatContainer" class="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4">
      <div class="[zoom:var(--chat-zoom,1)]">
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
        <div v-if="streamingMessage" class="mr-auto">
          <MessageBubble
            :message="streamingMessage"
            :siblings="[streamingMessage]"
            :sibling-index="0"
            :is-last="true"
            :is-streaming="true"
          />
        </div>
      </div>
    </div>

    <div v-if="showInput" class="border-t border-glass-border p-6">
      <ChatInput
        :disabled="msgStore.isConversationStreaming(convStore.activeId)"
        @send="handleSend"
        @update:complexity="handleComplexityChange"
      />
    </div>

    <div v-if="showPromptDialog" class="fixed inset-0 bg-overlay backdrop-blur-xl flex items-center justify-center z-50">
      <div class="bg-surface rounded-[1.25rem] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.35)] w-[480px]">
          <h2 class="text-[14px] font-medium text-main mb-4">System Prompt</h2>
          <textarea
            v-model="systemPrompt"
            class="w-full p-3 bg-glass-fill rounded-lg text-[13px] text-main resize-none focus:ring-accent/50 ring-1 ring-glass-border focus:shadow-[0_0_0_3px_rgba(124,140,248,0.12)] transition-all"
            rows="6"
            placeholder="设置此对话的系统提示词..."
          />
          <div class="flex justify-end gap-3 mt-4">
            <button
              class="px-4 py-1.5 text-[13px] rounded-lg text-soft hover:bg-glass-fill transition-all"
              @click="showPromptDialog = false"
            >取消</button>
            <button
              class="px-4 py-1.5 bg-accent text-[13px] rounded-lg text-white hover:bg-accent-hover active:scale-[0.98] transition-all"
              @click="saveSystemPrompt"
            >保存</button>
          </div>
      </div>
    </div>
    </template>
  </div>
</template>
