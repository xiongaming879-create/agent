<script setup lang="ts">
defineProps<{
  siblings: Array<{ id: string }>
  currentIndex: number
}>()

defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <div v-if="siblings.length > 1" class="flex items-center gap-1.5 text-[13px] text-mute select-none">
    <button
      class="px-2 py-1 rounded-md hover:bg-glass-fill hover:text-soft transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === 0"
      @click="$emit('prev')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
    </button>
    <span class="text-[11px]">{{ currentIndex + 1 }}/{{ siblings.length }}</span>
    <button
      class="px-2 py-1 rounded-md hover:bg-glass-fill hover:text-soft transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === siblings.length - 1"
      @click="$emit('next')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
    </button>
  </div>
</template>
