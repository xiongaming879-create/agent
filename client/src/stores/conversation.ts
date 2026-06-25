import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Conversation } from '../types'
import { authFetch } from '../utils/fetch'

const API = '/api/conversations'

export const useConversationStore = defineStore('conversation', () => {
  const conversations = ref<Conversation[]>([])
  const activeId = ref<string | null>(null)

  async function fetchAll() {
    const res = await authFetch(API)
    if (res.ok) {
      conversations.value = await res.json()
      if (activeId.value && !conversations.value.some(c => c.id === activeId.value)) {
        activeId.value = conversations.value[0]?.id || null
      }
    }
  }

  async function fetchByUserId(userId: string) {
    const res = await authFetch(`${API}?userId=${userId}`)
    if (res.ok) {
      conversations.value = await res.json()
      activeId.value = null
    }
  }

  async function create(title?: string, systemPrompt?: string) {
    const res = await authFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, system_prompt: systemPrompt }),
    })
    const conv: Conversation = await res.json()
    conversations.value.unshift(conv)
    activeId.value = conv.id
    return conv
  }

  async function update(id: string, data: Partial<Pick<Conversation, 'title' | 'system_prompt' | 'is_pinned'>>) {
    await authFetch(`${API}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const idx = conversations.value.findIndex(c => c.id === id)
    if (idx !== -1) {
      Object.assign(conversations.value[idx], data)
    }
  }

  async function remove(id: string) {
    await authFetch(`${API}/${id}`, { method: 'DELETE' })
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id || null
    }
  }

  async function togglePin(id: string, isPinned: boolean) {
    const res = await authFetch(`${API}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: isPinned }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '操作失败')
    }
    const idx = conversations.value.findIndex(c => c.id === id)
    if (idx !== -1) {
      const updated = await res.json()
      Object.assign(conversations.value[idx], updated)
      await fetchAll()
    }
  }

  function setActive(id: string | null) {
    activeId.value = id
  }

  return { conversations, activeId, fetchAll, fetchByUserId, create, update, remove, setActive, togglePin }
})
