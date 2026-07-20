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
        class="px-3 py-1 text-[12px] rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        :class="complexity === opt.value
          ? 'bg-neutral-800 border-neutral-800 text-white'
          : 'bg-neutral-100 border-neutral-300 text-neutral-600 hover:border-neutral-400 hover:text-neutral-800'"
        :title="opt.hint"
        :disabled="disabled"
        @click="setComplexity(opt.value)"
      >{{ opt.label }}</button>
      <span class="ml-2 text-[11px] text-neutral-400">{{ complexityOptions.find(o => o.value === complexity)?.hint }}</span>
    </div>
    <div class="flex gap-3 flex-1 items-end">
      <textarea
        ref="textareaRef"
        v-model="content"
        class="flex-1 p-3 h-20 bg-neutral-200 border border-neutral-300 rounded-xl text-[13px] text-neutral-800 resize-none overflow-y-auto focus:outline-none focus:border-[#3485f8] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        placeholder="输入消息..."
        rows="3"
        :disabled="disabled"
        @keydown="handleKeydown"
      />
      <button
        class="shrink-0 h-10 px-5 bg-neutral-700 border border-neutral-600 text-white text-[13px] rounded-xl hover:bg-neutral-600 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
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
  </div>
</template>
