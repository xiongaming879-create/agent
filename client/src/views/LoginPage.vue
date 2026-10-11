<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

const isRegister = ref(false)
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  if (isRegister.value) {
    if (password.value.length < 6) {
      error.value = '密码至少6位'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次密码不一致'
      return
    }
  }

  loading.value = true
  try {
    if (isRegister.value) {
      await authStore.register(username.value.trim(), password.value)
    } else {
      await authStore.login(username.value.trim(), password.value)
    }
    router.push({ name: 'chat' })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="relative flex items-center justify-center h-screen w-screen bg-chat-bg overflow-hidden">
    <div class="absolute -top-32 left-1/2 -translate-x-1/2 w-[560px] h-[320px] bg-accent/10 blur-[120px] rounded-full pointer-events-none" />
    <div class="bg-surface rounded-[1.5rem] p-8 w-[380px] shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
        <h1 class="text-[17px] font-semibold text-main tracking-tight text-center mb-6">Agent Chat</h1>        <div class="flex gap-1 bg-glass-fill rounded-lg p-1 mb-6">
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="!isRegister ? 'bg-surface text-main shadow-[0_1px_3px_rgba(0,0,0,0.15)]' : 'text-mute hover:text-soft'"
            @click="isRegister = false"
          >登录</button>
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="isRegister ? 'bg-surface text-main shadow-[0_1px_3px_rgba(0,0,0,0.15)]' : 'text-mute hover:text-soft'"
            @click="isRegister = true"
          >注册</button>
        </div>
        <form class="space-y-4" @submit.prevent="submit">
          <input
            v-model="username"
            type="text"
            placeholder="用户名"
            autocomplete="username"
            class="w-full px-4 py-2.5 bg-glass-fill rounded-lg text-[13px] text-main focus:ring-accent/50 ring-1 ring-glass-border transition-all"
          />
          <input
            v-model="password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            class="w-full px-4 py-2.5 bg-glass-fill rounded-lg text-[13px] text-main focus:ring-accent/50 ring-1 ring-glass-border transition-all"
          />
          <input
            v-if="isRegister"
            v-model="confirmPassword"
            type="password"
            placeholder="确认密码"
            autocomplete="new-password"
            class="w-full px-4 py-2.5 bg-glass-fill rounded-lg text-[13px] text-main focus:ring-accent/50 ring-1 ring-glass-border transition-all"
          />
          <p v-if="error" class="text-red-400/80 text-[12px]">{{ error }}</p>
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 bg-accent text-white text-[13px] font-medium rounded-lg hover:bg-accent-hover active:scale-[0.98] transition-all duration-200 disabled:opacity-40 shadow-[0_2px_8px_rgba(124,140,248,0.25)]"
          >{{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}</button>
        </form>
    </div>
  </div>
</template>
