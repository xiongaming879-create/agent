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
  <div v-if="siblings.length > 1" class="flex items-center gap-2 text-[13px] text-white/30 select-none">
    <button
      class="px-2 py-1 ring-1 ring-white/10 rounded-md hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === 0"
      @click="$emit('prev')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
    </button>
    <span class="text-[11px]">{{ currentIndex + 1 }}/{{ siblings.length }}</span>
    <button
      class="px-2 py-1 ring-1 ring-white/10 rounded-md hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="currentIndex === siblings.length - 1"
      @click="$emit('next')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
    </button>
  </div>
</template>
