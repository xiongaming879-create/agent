<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Message } from '../types'
import ThoughtStep from './ThoughtStep.vue'
import BranchNavigator from './BranchNavigator.vue'
import { groupThoughtSteps } from '../utils/thoughtGroup'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  message: Message
  siblings: Array<{ id: string }>
  siblingIndex: number
  isLast: boolean
  isStreaming: boolean
}>()

const emit = defineEmits<{
  switchBranch: [index: number]
  regenerate: []
}>()

const showThoughts = ref(false)

const isTyping = computed(() => props.isStreaming && props.message.role === 'assistant')

const roundCount = computed(() => thoughtItems.value.filter(i => i.kind === 'round').length)

// 流式开始自动展开,最终回答开始输出后自动收起(主流交互)
watch(isTyping, (typing) => {
  if (typing) showThoughts.value = true
})
watch(() => props.message.content, (c) => {
  if (c && isTyping.value) showThoughts.value = false
})

const thoughtItems = computed(() => groupThoughtSteps(props.message.thought_steps))

const renderedContent = computed(() => {
  if (!props.message.content) return ''
  return renderMarkdown(props.message.content)
})

const copied = ref(false)
const copiedBlock = ref<string | null>(null)

const formattedTime = computed(() => {
  if (!props.message.created_at) return ''
  const d = new Date(props.message.created_at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

async function copyContent() {
  await copyToClipboard(props.message.content)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

function copyCodeBlock(event: MouseEvent) {
  const pre = (event.target as HTMLElement).closest('pre')
  if (!pre) return
  const code = pre.querySelector('code')
  if (!code) return
  const text = code.textContent || ''
  copyToClipboard(text)
  const key = pre.innerHTML
  copiedBlock.value = key
  setTimeout(() => { copiedBlock.value = null }, 1500)
}
</script>

<template>
  <div class="group relative flex gap-2.5 w-[45%] min-w-0" :class="message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'">
    <div
      class="shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center text-xs font-semibold select-none"
      :class="message.role === 'user'
        ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
        : 'bg-surface-active text-main ring-1 ring-glass-border'"
    >
      <template v-if="message.role === 'user'">U</template>
      <template v-else>
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
        </svg>
      </template>
    </div>

    <div class="relative min-w-0 flex-1">
      <span v-if="formattedTime" class="absolute -top-4 left-0 text-mute text-[11px] whitespace-nowrap tabular-nums">{{ formattedTime }}</span>

    <div
      class="px-4 py-3 rounded-bubble min-w-0 transition-shadow"
      :class="message.role === 'user'
        ? 'bg-accent/15 text-main ring-1 ring-accent/25'
        : 'bg-surface ring-1 ring-msg-border text-main shadow-[0_1px_2px_rgba(0,0,0,0.08)]'"
    >
      <div v-if="message.role === 'assistant' && message.thought_steps.length > 0" class="mb-2">
        <button
          class="flex items-center gap-1.5 text-mute text-[12px] hover:text-soft transition-colors"
          @click="showThoughts = !showThoughts"
        >
          <svg class="w-3 h-3 transition-transform duration-200" :class="showThoughts ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
          <template v-if="isTyping">
            <span>思考中</span>
            <span class="flex gap-0.5 items-end h-3">
              <span class="w-1 h-1 rounded-full bg-accent/60 animate-bounce [animation-delay:-0.3s]" />
              <span class="w-1 h-1 rounded-full bg-accent/60 animate-bounce [animation-delay:-0.15s]" />
              <span class="w-1 h-1 rounded-full bg-accent/60 animate-bounce" />
            </span>
          </template>
          <template v-else>已深度思考{{ roundCount > 0 ? ` · ${roundCount} 轮工具` : '' }}</template>
        </button>
        <div v-if="showThoughts" class="mt-2 pl-2">
          <ThoughtStep :items="thoughtItems" :is-streaming="isTyping" />
        </div>
        <div class="border-b border-glass-border mt-2 mb-2" />
      </div>

      <div v-if="message.role === 'assistant'" class="markdown-body text-[13px] leading-normal break-words overflow-hidden" @click="copyCodeBlock">
        <template v-if="isTyping && !message.content">
          <svg class="inline-block w-4 h-4 align-middle text-mute animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </template>
        <div v-else v-html="renderedContent" /><span v-if="isTyping" class="inline-block w-[2px] h-[14px] bg-accent ml-[1px] align-middle animate-blink" />
      </div>
      <div v-else class="markdown-body text-[13px] leading-normal break-words overflow-hidden" v-html="renderedContent" />

      <div v-if="message.warning" class="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-700 dark:text-yellow-400 text-[12px] leading-relaxed">
        ⚠️ {{ message.warning }}
      </div>

      <div v-if="!isTyping" class="flex items-center gap-3 mt-2">
        <BranchNavigator
          :siblings="siblings"
          :current-index="siblingIndex"
          @prev="emit('switchBranch', siblingIndex - 1)"
          @next="emit('switchBranch', siblingIndex + 1)"
        />
        <button
          v-if="message.role === 'assistant' && isLast"
          class="text-mute text-[12px] hover:text-soft transition-colors"
          @click="emit('regenerate')"
        >重新生成</button>
      </div>
    </div>

    <button
      v-if="message.content && !isTyping"
      class="absolute bottom-1 right-2 p-1 rounded-md transition-all"
      :class="copied ? 'opacity-80' : 'opacity-0 group-hover:opacity-100 hover:!opacity-100'"
      :title="copied ? '已复制' : '复制'"
      @click="copyContent"
    >
      <svg v-if="!copied" class="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke-width="2" />
      </svg>
      <svg v-else class="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </button>
    </div>
  </div>
</template>
