<script setup lang="ts">
import { ref, computed } from 'vue'
import { Marked } from 'marked'
import hljs from 'highlight.js'
import type { Message } from '../types'
import ThoughtStep from './ThoughtStep.vue'
import BranchNavigator from './BranchNavigator.vue'

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

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      const highlighted = hljs.highlight(text, { language }).value
      return `<pre class="hljs-pre"><code class="hljs language-${language}">${highlighted}</code></pre>`
    },
  },
})

const showThoughts = ref(false)

const isTyping = computed(() => props.isStreaming && props.message.role === 'assistant')

const stepCount = computed(() => {
  const actions = props.message.thought_steps.filter(s => s.type === 'action').length
  return actions > 0 ? actions : props.message.thought_steps.length
})

const renderedContent = computed(() => {
  if (!props.message.content) return ''
  return marked.parse(props.message.content) as string
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
  <div class="group relative flex gap-2 w-[40%] min-w-0" :class="message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'">
    <div class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm" :class="message.role === 'user' ? 'bg-neutral-700' : 'bg-neutral-800'">
      <template v-if="message.role === 'user'"><span class="text-white/70 text-xs">👤</span></template>
      <template v-else><span class="text-white/70 text-xs">🤖</span></template>
    </div>

    <div class="relative min-w-0 flex-1">
      <span v-if="formattedTime" class="absolute -top-4 left-0 text-neutral-400 text-[11px] whitespace-nowrap">{{ formattedTime }}</span>

    <div
      class="px-4 py-3 rounded-xl min-w-0"
      :class="message.role === 'user'
        ? 'bg-neutral-600 text-white'
        : 'bg-neutral-800 border border-neutral-700 text-neutral-200'"
    >
      <div v-if="message.role === 'assistant' && message.thought_steps.length > 0" class="mb-2">
        <button
          class="flex items-center gap-1 text-white/30 text-[12px] hover:text-white/50 transition-colors"
          @click="showThoughts = !showThoughts"
        >
          <svg class="w-3 h-3 transition-transform duration-200" :class="showThoughts ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
          思考过程 ({{ stepCount }}轮)
        </button>
        <div v-if="showThoughts" class="mt-2 space-y-1.5 pl-2">
          <ThoughtStep v-for="(step, i) in message.thought_steps" :key="i" :step="step" :is-last="i === message.thought_steps.length - 1" :is-streaming="isTyping" />
        </div>
        <div class="border-b border-white/10 mt-2 mb-2" />
      </div>

      <div v-if="message.role === 'assistant'" class="markdown-body text-[13px] leading-normal break-words overflow-hidden" @click="copyCodeBlock">
        <template v-if="isTyping && !message.content">
          <svg class="inline-block w-4 h-4 align-middle text-white/30 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </template>
        <div v-else v-html="renderedContent" /><span v-if="isTyping" class="inline-block w-[2px] h-[14px] bg-white/60 ml-[1px] align-middle animate-blink" />
      </div>
      <div v-else class="markdown-body text-[13px] leading-normal break-words overflow-hidden" v-html="renderedContent" />

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
