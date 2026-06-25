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
  <div class="flex items-center justify-center h-screen w-screen bg-[#050505]">
    <div class="bg-white/5 ring-1 ring-white/10 p-1.5 rounded-[1.5rem] w-[380px]">
      <div class="bg-[#0A0A0A] rounded-[1.25rem] p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
        <h1 class="text-[17px] font-semibold text-white tracking-tight text-center mb-6">Agent Chat</h1>
        <div class="flex gap-1 bg-white/5 ring-1 ring-white/10 rounded-lg p-1 mb-6">
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="!isRegister ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-white/40 hover:text-white/60'"
            @click="isRegister = false"
          >登录</button>
          <button
            class="flex-1 py-2 text-[13px] rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="isRegister ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-white/40 hover:text-white/60'"
            @click="isRegister = true"
          >注册</button>
        </div>
        <form class="space-y-4" @submit.prevent="submit">
          <input
            v-model="username"
            type="text"
            placeholder="用户名"
            autocomplete="username"
            class="w-full px-4 py-2.5 bg-white/5 ring-1 ring-white/10 rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <input
            v-model="password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            class="w-full px-4 py-2.5 bg-white/5 ring-1 ring-white/10 rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <input
            v-if="isRegister"
            v-model="confirmPassword"
            type="password"
            placeholder="确认密码"
            autocomplete="new-password"
            class="w-full px-4 py-2.5 bg-white/5 ring-1 ring-white/10 rounded-lg text-[13px] text-white/80 focus:ring-white/20 transition-all"
          />
          <p v-if="error" class="text-red-400/80 text-[12px]">{{ error }}</p>
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 bg-white/10 ring-1 ring-white/10 text-white text-[13px] rounded-lg hover:bg-white/15 active:scale-[0.98] transition-all disabled:opacity-40"
          >{{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}</button>
        </form>
      </div>
    </div>
  </div>
</template>
