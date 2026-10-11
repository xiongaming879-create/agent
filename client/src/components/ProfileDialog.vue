<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, avatarSrc } from '../composables/useAvatar'

defineEmits<{
  close: []
  logout: []
}>()

const authStore = useAuthStore()

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="fixed inset-0 bg-overlay backdrop-blur-2xl flex items-center justify-center z-50" @click.self="$emit('close')">
    <div class="bg-surface rounded-[1.25rem] p-7 shadow-[0_24px_64px_rgba(0,0,0,0.35)] w-[340px]">
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center ring-1 ring-glass-border"
            :style="!isAvatarImagePath(authStore.user?.avatar || '') ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U') } : { backgroundColor: 'var(--bg-surface-active)' }"
          >
            <img
              v-if="isAvatarImagePath(authStore.user?.avatar || '')"
              :src="avatarSrc(authStore.user?.avatar || '')"
              alt="avatar"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-white text-lg font-medium">
              {{ getInitialLetter(authStore.user?.username || 'U') }}
            </span>
          </div>
          <h2 class="text-[14px] font-medium text-main">{{ authStore.user?.username }}</h2>
          <span
            class="px-2.5 py-0.5 text-[10px] rounded-full tracking-wide bg-glass-fill"
            :class="authStore.user?.role === 'admin' ? 'text-soft' : 'text-mute'"
          >{{ authStore.user?.role === 'admin' ? '管理员' : '普通用户' }}</span>
        </div>
        <div class="text-[11px] text-mute text-center mt-4">
          注册于 {{ authStore.user?.created_at ? formatDate(authStore.user.created_at) : '-' }}
        </div>
        <div class="border-t border-glass-border mt-5 pt-4">
          <button
            class="w-full py-2.5 text-[13px] text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.08] active:scale-[0.98] transition-all rounded-lg"
            @click="$emit('logout')"
          >退出登录</button>
        </div>
      </div>
  </div>
</template>
