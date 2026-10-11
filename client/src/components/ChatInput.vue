<script setup lang="ts">
import { ref } from 'vue'
import type { Complexity } from '../types'

defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, complexity: Complexity]
  'update:complexity': [complexity: Complexity]
}>()

const content = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const complexity = ref<Complexity>('medium')

const complexityOptions: Array<{ value: Complexity; label: string; hint: string }> = [
  { value: 'fast', label: '快速', hint: '轻量回答，不深度推理' },
  { value: 'medium', label: '标准', hint: '智能分类路由' },
  { value: 'deep', label: '深度', hint: '全工具 + 强模型' },
]

function setComplexity(value: Complexity) {
  complexity.value = value
  emit('update:complexity', value)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function send() {
  const text = content.value.trim()
  if (!text) return
  emit('send', text, complexity.value)
  content.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1">
      <button
        v-for="opt in complexityOptions"
        :key="opt.value"
        type="button"
        class="px-3 py-1 text-[12px] rounded-md ring-1 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]"
        :class="complexity === opt.value
          ? 'bg-accent/15 ring-accent/40 text-accent'
          : 'bg-transparent ring-glass-border text-mute hover:text-main hover:ring-accent/30'"
        :title="opt.hint"
        :disabled="disabled"
        @click="setComplexity(opt.value)"
      >{{ opt.label }}</button>
      <span class="ml-2 text-[11px] text-mute">{{ complexityOptions.find(o => o.value === complexity)?.hint }}</span>
    </div>
    <div class="flex gap-3 flex-1 items-end">
      <textarea
        ref="textareaRef"
        v-model="content"
        class="flex-1 p-3 h-20 bg-surface ring-1 ring-glass-border rounded-xl text-[13px] text-main placeholder:text-mute resize-none overflow-y-auto transition-shadow duration-200 focus:outline-none focus:ring-accent/50 focus:shadow-[0_0_0_3px_rgba(124,140,248,0.12)] disabled:opacity-30 disabled:cursor-not-allowed"
        placeholder="输入消息..."
        rows="3"
        :disabled="disabled"
        @keydown="handleKeydown"
      />
      <button
        class="shrink-0 h-10 px-5 bg-accent text-[13px] font-medium rounded-xl hover:bg-accent-hover active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 shadow-[0_2px_8px_rgba(124,140,248,0.25)] disabled:shadow-none"
        :disabled="!content.trim() || disabled"
        @click="send"
      >
        <svg v-if="disabled" class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="white" stroke-width="4" />
          <path class="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span v-if="!disabled">发送</span>
      </button>
    </div>
  </div>
</template>
