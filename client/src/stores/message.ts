import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Message, AgentEvent, ThoughtStep, Complexity } from '../types'
import { authFetch } from '../utils/fetch'

const API = '/api/conversations'

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const TYPEWRITER_SPEED = 25

export const useMessageStore = defineStore('message', () => {
  const messages = ref<Message[]>([])
  const streamingMessage = ref<Message | null>(null)
  const isStreaming = ref(false)
  const branchSelections = ref<Record<string, number>>({})

  // Typewriter buffer
  let contentBuffer = ''
  let typewriterTimer: ReturnType<typeof setInterval> | null = null

  function startTypewriter(msg: { value: Message | null }) {
    if (typewriterTimer) return
    typewriterTimer = setInterval(() => {
      if (!msg.value) return
      if (contentBuffer.length === 0) return
      const chunkSize = Math.min(3, contentBuffer.length)
      msg.value.content += contentBuffer.slice(0, chunkSize)
      contentBuffer = contentBuffer.slice(chunkSize)
    }, TYPEWRITER_SPEED)
  }

  function stopTypewriter(msg: { value: Message | null }) {
    if (typewriterTimer) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
    // Flush remaining buffer
    if (msg.value && contentBuffer.length > 0) {
      msg.value.content += contentBuffer
      contentBuffer = ''
    }
  }

  async function fetchMessages(conversationId: string) {
    const res = await authFetch(`${API}/${conversationId}/messages`)
    const data = await res.json()
    messages.value = Array.isArray(data) ? data : []
  }

  function getActiveBranch(leafId: string | null): Message[] {
    if (!leafId) return []
    const branch: Message[] = []
    let current: Message | undefined = messages.value.find(m => m.id === leafId)
    while (current) {
      branch.unshift(current)
      current = current.parent_id
        ? messages.value.find(m => m.id === current!.parent_id)
        : undefined
    }
    return branch
  }

  function getSiblings(parentId: string | null): Message[] {
    return messages.value.filter(m => m.parent_id === parentId)
  }

  function handleSSEEvent(event: AgentEvent, thoughtSteps: ThoughtStep[], msg: { value: Message | null }) {
    if (!msg.value) return

    switch (event.type) {
      case 'thought_delta':
        if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
          thoughtSteps[thoughtSteps.length - 1].content += event.content
        } else {
          thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        }
        msg.value.thought_steps = [...thoughtSteps]
        break

      case 'thought':
        if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
          thoughtSteps[thoughtSteps.length - 1].content = event.content
        } else {
          thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        }
        msg.value.thought_steps = [...thoughtSteps]
        break

      case 'action':
        thoughtSteps.push({ type: 'action', content: event.content, tool_name: event.tool_name, timestamp: new Date().toISOString() })
        msg.value.thought_steps = [...thoughtSteps]
        break

      case 'observation':
        thoughtSteps.push({ type: 'observation', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        msg.value.thought_steps = [...thoughtSteps]
        break

      case 'content_delta':
        contentBuffer += event.content
        break

      case 'content':
        contentBuffer += event.content
        break

      case 'done':
        stopTypewriter(msg)
        break
    }
  }

  async function sendMessage(conversationId: string, content: string, parentId?: string | null, complexity?: Complexity) {
    isStreaming.value = true
    const thoughtSteps: ThoughtStep[] = []

    const userMsg: Message = {
      id: 'temp-' + uuid(),
      conversation_id: conversationId,
      parent_id: parentId || null,
      role: 'user',
      content,
      thought_steps: [],
      created_at: new Date().toISOString(),
    }
    messages.value.push(userMsg)

    streamingMessage.value = {
      id: 'streaming',
      conversation_id: conversationId,
      parent_id: userMsg.id,
      role: 'assistant',
      content: '',
      thought_steps: [],
      created_at: new Date().toISOString(),
    }

    try {
      const res = await authFetch(`${API}/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parent_id: parentId || null, complexity: complexity || 'medium' }),
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      startTypewriter(streamingMessage)

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event: AgentEvent = JSON.parse(line.slice(6))
            handleSSEEvent(event, thoughtSteps, streamingMessage)
          } catch {
            // skip malformed
          }
        }
      }

      if (streamingMessage.value) {
        streamingMessage.value.id = 'final-' + uuid()
      }
    } catch (err) {
      console.error('SSE error:', err)
    } finally {
      stopTypewriter(streamingMessage)
      isStreaming.value = false
      contentBuffer = ''
      messages.value = messages.value.filter(m => !m.id.startsWith('temp-'))
      await fetchMessages(conversationId)
      streamingMessage.value = null
    }
  }

  async function editMessage(conversationId: string, messageId: string, content: string) {
    const res = await authFetch(`${API}/${conversationId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const branched = await res.json()
    await fetchMessages(conversationId)
    return branched
  }

  async function regenerateMessage(conversationId: string, messageId: string, complexity?: Complexity) {
    isStreaming.value = true
    const thoughtSteps: ThoughtStep[] = []

    streamingMessage.value = {
      id: 'streaming',
      conversation_id: conversationId,
      parent_id: null,
      role: 'assistant',
      content: '',
      thought_steps: [],
      created_at: new Date().toISOString(),
    }

    try {
      const res = await authFetch(`${API}/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complexity: complexity || 'medium' }),
      })
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      startTypewriter(streamingMessage)

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event: AgentEvent = JSON.parse(line.slice(6))
            handleSSEEvent(event, thoughtSteps, streamingMessage)
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      console.error('Regenerate error:', err)
    } finally {
      stopTypewriter(streamingMessage)
      isStreaming.value = false
      contentBuffer = ''
      await fetchMessages(conversationId)
      streamingMessage.value = null
    }
  }

  return {
    messages, streamingMessage, isStreaming, branchSelections,
    fetchMessages, getActiveBranch, getSiblings,
    sendMessage, editMessage, regenerateMessage,
  }
})
