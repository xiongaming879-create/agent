import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
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

interface TypewriterState {
  buffer: string
  timer: ReturnType<typeof setInterval> | null
}

export const useMessageStore = defineStore('message', () => {
  const messages = ref<Message[]>([])
  // 流式状态按 conversationId 隔离,切换对话互不干扰
  const streamingMessages = ref<Map<string, Message>>(new Map())
  // 分支选择按 conversationId 隔离(convId -> parentKey -> index),切换对话后保留
  const branchSelections = ref<Record<string, Record<string, number>>>({})

  const abortControllers = new Map<string, AbortController>()
  const typewriters = new Map<string, TypewriterState>()

  // 任一对话在流式中即为 true(全局状态,如路由切换确认等场景)
  const isStreaming = computed(() => streamingMessages.value.size > 0)

  function getStreamingMessage(convId: string | null): Message | null {
    if (!convId) return null
    return streamingMessages.value.get(convId) ?? null
  }

  function isConversationStreaming(convId: string | null): boolean {
    if (!convId) return false
    return streamingMessages.value.has(convId)
  }

  function startTypewriter(convId: string) {
    if (typewriters.has(convId)) return
    const state: TypewriterState = { buffer: '', timer: null }
    state.timer = setInterval(() => {
      if (state.buffer.length === 0) return
      const msg = streamingMessages.value.get(convId)
      if (!msg) return
      const chunkSize = Math.min(3, state.buffer.length)
      msg.content += state.buffer.slice(0, chunkSize)
      state.buffer = state.buffer.slice(chunkSize)
    }, TYPEWRITER_SPEED)
    typewriters.set(convId, state)
  }

  function stopTypewriter(convId: string) {
    const state = typewriters.get(convId)
    if (!state) return
    if (state.timer) clearInterval(state.timer)
    typewriters.delete(convId)
    // Flush remaining buffer
    const msg = streamingMessages.value.get(convId)
    if (msg && state.buffer.length > 0) {
      msg.content += state.buffer
    }
  }

  /** 中止指定对话的流式请求并清理其流式状态 */
  function abortStreaming(convId: string) {
    const controller = abortControllers.get(convId)
    abortControllers.delete(convId)
    stopTypewriter(convId)
    streamingMessages.value.delete(convId)
    controller?.abort()
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

  function handleSSEEvent(convId: string, event: AgentEvent, thoughtSteps: ThoughtStep[]) {
    const msg = streamingMessages.value.get(convId)
    if (!msg) return

    switch (event.type) {
      case 'thought_delta':
        if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
          thoughtSteps[thoughtSteps.length - 1].content += event.content
        } else {
          thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        }
        msg.thought_steps = [...thoughtSteps]
        break

      case 'thought':
        if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
          thoughtSteps[thoughtSteps.length - 1].content = event.content
        } else {
          thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        }
        msg.thought_steps = [...thoughtSteps]
        break

      case 'action':
        thoughtSteps.push({ type: 'action', content: event.content, tool_name: event.tool_name, timestamp: new Date().toISOString() })
        msg.thought_steps = [...thoughtSteps]
        break

      case 'observation':
        thoughtSteps.push({ type: 'observation', content: event.content, tool_name: null, timestamp: new Date().toISOString(), duration_ms: event.duration_ms, success: event.success })
        msg.thought_steps = [...thoughtSteps]
        break

      case 'content_delta':
      case 'content': {
        const state = typewriters.get(convId)
        if (state) state.buffer += event.content
        break
      }

      case 'warning':
        msg.warning = event.content
        break

      case 'done':
        stopTypewriter(convId)
        break
    }
  }

  async function readSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    conversationId: string,
    thoughtSteps: ThoughtStep[]
  ) {
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
          handleSSEEvent(conversationId, event, thoughtSteps)
        } catch {
          // skip malformed
        }
      }
    }
  }

  async function sendMessage(conversationId: string, content: string, parentId?: string | null, complexity?: Complexity) {
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

    const streaming: Message = {
      id: 'streaming',
      conversation_id: conversationId,
      parent_id: userMsg.id,
      role: 'assistant',
      content: '',
      thought_steps: [],
      created_at: new Date().toISOString(),
    }
    streamingMessages.value.set(conversationId, streaming)

    const controller = new AbortController()
    abortControllers.set(conversationId, controller)

    try {
      const res = await authFetch(`${API}/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parent_id: parentId || null, complexity: complexity || 'medium' }),
        signal: controller.signal,
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      startTypewriter(conversationId)
      await readSSEStream(reader, conversationId, thoughtSteps)

      const msg = streamingMessages.value.get(conversationId)
      if (msg) {
        msg.id = 'final-' + uuid()
      }
    } catch (err) {
      // abort(切换对话)不算错误
      if (!controller.signal.aborted) {
        console.error('SSE error:', err)
      }
    } finally {
      stopTypewriter(conversationId)
      abortControllers.delete(conversationId)
      streamingMessages.value.delete(conversationId)
      messages.value = messages.value.filter(m => !m.id.startsWith('temp-'))
      // 被中止时跳过拉取:切换后的对话由 ChatArea watch 拉取,切回时同样会拉取
      if (!controller.signal.aborted) {
        await fetchMessages(conversationId)
      }
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
    const thoughtSteps: ThoughtStep[] = []

    const streaming: Message = {
      id: 'streaming',
      conversation_id: conversationId,
      parent_id: null,
      role: 'assistant',
      content: '',
      thought_steps: [],
      created_at: new Date().toISOString(),
    }
    streamingMessages.value.set(conversationId, streaming)

    const controller = new AbortController()
    abortControllers.set(conversationId, controller)

    try {
      const res = await authFetch(`${API}/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complexity: complexity || 'medium' }),
        signal: controller.signal,
      })
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      startTypewriter(conversationId)
      await readSSEStream(reader, conversationId, thoughtSteps)
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Regenerate error:', err)
      }
    } finally {
      stopTypewriter(conversationId)
      abortControllers.delete(conversationId)
      streamingMessages.value.delete(conversationId)
      if (!controller.signal.aborted) {
        await fetchMessages(conversationId)
      }
    }
  }

  function setBranchSelection(convId: string, parentId: string | null, index: number) {
    const key = parentId || '__root__'
    const convSel = { ...(branchSelections.value[convId] || {}) }
    convSel[key] = index
    branchSelections.value = { ...branchSelections.value, [convId]: convSel }
  }

  function getBranchSelection(convId: string | null, parentId: string | null): number | undefined {
    if (!convId) return undefined
    return branchSelections.value[convId]?.[parentId || '__root__']
  }

  function clearBranchSelections(convId: string) {
    const next = { ...branchSelections.value }
    delete next[convId]
    branchSelections.value = next
  }

  return {
    messages, streamingMessages, isStreaming, branchSelections,
    getStreamingMessage, isConversationStreaming,
    fetchMessages, getActiveBranch, getSiblings, handleSSEEvent,
    sendMessage, editMessage, regenerateMessage,
    abortStreaming, setBranchSelection, getBranchSelection, clearBranchSelections,
  }
})
