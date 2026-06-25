import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '../types'
import { authFetch } from '../utils/fetch'

const API = '/api/auth'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!token.value && !!user.value)

  function authHeaders(): Record<string, string> {
    return token.value ? { Authorization: `Bearer ${token.value}` } : {}
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '登录失败')
    }
    const data = await res.json()
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
  }

  async function register(username: string, password: string): Promise<void> {
    const res = await fetch(`${API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '注册失败')
    }
    const data = await res.json()
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
  }

  async function fetchMe(): Promise<void> {
    const res = await fetch(`${API}/me`, { headers: authHeaders() })
    if (!res.ok) {
      logout()
      return
    }
    user.value = await res.json()
    localStorage.setItem('user', JSON.stringify(user.value))
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  async function updateSettings(data: Partial<Pick<User, 'avatar' | 'theme' | 'font_size'>>): Promise<void> {
    const res = await authFetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('更新设置失败')
    user.value = await res.json()
    localStorage.setItem('user', JSON.stringify(user.value))
  }

  async function uploadAvatar(file: File): Promise<void> {
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await authFetch('/api/user/avatar', {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) throw new Error('头像上传失败')
    user.value = await res.json()
    localStorage.setItem('user', JSON.stringify(user.value))
  }

  // Initialize from localStorage on store creation
  function initFromStorage(): void {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try { user.value = JSON.parse(storedUser) } catch { /* skip */ }
    }
  }

  initFromStorage()

  return { token, user, isLoggedIn, authHeaders, login, register, fetchMe, logout, updateSettings, uploadAvatar }
})
