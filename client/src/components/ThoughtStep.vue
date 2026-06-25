<script setup lang="ts">
import type { ThoughtStep as ThoughtStepType } from '../types'

defineProps<{
  step: ThoughtStepType
  isLast: boolean
  isStreaming: boolean
}>()
</script>

<template>
  <div class="thought-step">
    <div v-if="step.type === 'thought'" class="text-neutral-400 italic text-[13px] leading-normal break-words overflow-hidden">
      {{ step.content }}<svg v-if="isLast && isStreaming" class="inline-block w-3 h-3 ml-1 align-middle text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
    <div v-else-if="step.type === 'action'" class="flex items-center gap-2 text-[13px] leading-normal">
      <span class="bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0">
        {{ step.tool_name }}
      </span>
      <span class="text-neutral-400 break-words overflow-hidden">{{ step.content }}</span>
    </div>
    <div v-else-if="step.type === 'observation'" class="text-neutral-400 text-[13px] leading-normal pl-4 border-l-2 border-neutral-600 break-words overflow-hidden">
      {{ step.content }}
    </div>
  </div>
</template>
