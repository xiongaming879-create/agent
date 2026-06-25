<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, avatarSrc } from '../composables/useAvatar'
import SettingsDialog from './SettingsDialog.vue'
import ProfileDialog from './ProfileDialog.vue'

defineProps<{
  collapsed?: boolean
}>()

const authStore = useAuthStore()
const router = useRouter()

const showSettings = ref(false)
const showProfile = ref(false)

function logout() {
  authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="border-t border-white/10 p-3">
    <div class="flex items-center gap-2" :class="collapsed ? 'justify-center' : ''">
      <button
        class="w-8 h-8 rounded-full flex items-center justify-center text-sm hover:bg-white/10 transition-colors shrink-0 overflow-hidden"
        :style="!isAvatarImagePath(authStore.user?.avatar || '') ? { backgroundColor: getAvatarBgColor(authStore.user?.username || 'U') } : { backgroundColor: 'rgba(255,255,255,0.05)' }"
        @click="showProfile = true"
        :title="authStore.user?.username"
      >
        <img
          v-if="isAvatarImagePath(authStore.user?.avatar || '')"
          :src="avatarSrc(authStore.user?.avatar || '')"
          alt="avatar"
          class="w-full h-full object-cover"
        />
        <span v-else class="text-white text-xs font-medium">
          {{ getInitialLetter(authStore.user?.username || 'U') }}
        </span>
      </button>
      <span v-if="!collapsed" class="text-[13px] text-white/50 truncate flex-1">{{ authStore.user?.username }}</span>
      <button
        v-if="!collapsed"
        class="text-white/30 hover:text-white/60 transition-colors p-1"
        @click="showSettings = true"
        title="设置"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </button>
    </div>
  </div>

  <SettingsDialog v-if="showSettings" @close="showSettings = false" />
  <ProfileDialog v-if="showProfile" @close="showProfile = false" @logout="logout" />
</template>
