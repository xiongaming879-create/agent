import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 前端流式状态隔离测试:streamingMessages Map + AbortController + branchSelections 入 store

vi.mock('../../../client/src/utils/fetch', () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from '../../../client/src/utils/fetch'
import { useMessageStore } from '../../../client/src/stores/message'

const authFetchMock = vi.mocked(authFetch)

interface PostConfig {
  chunks: Uint8Array[]
  hang: boolean
}

function sseChunk(events: unknown[]): Uint8Array {
  return new TextEncoder().encode(
    events.map(e => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n'
  )
}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

function streamResponse(config: PostConfig, signal?: AbortSignal): Response {
  let i = 0
  return {
    body: {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (i < config.chunks.length) {
            return Promise.resolve({ done: false, value: config.chunks[i++] })
          }
          if (config.hang) {
            return new Promise((_resolve, reject) => {
              if (signal?.aborted) return reject(abortError())
              signal?.addEventListener('abort', () => reject(abortError()))
            })
          }
          return Promise.resolve({ done: true, value: undefined })
        },
      }),
    },
  } as unknown as Response
}

function jsonResponse(data: unknown): Response {
  return { json: async () => data } as unknown as Response
}

let postConfigs: Map<string, PostConfig>
let calls: Array<{ url: string; options: RequestInit }>

beforeEach(() => {
  setActivePinia(createPinia())
  postConfigs = new Map()
  calls = []
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
    calls.push({ url, options })
    if (options.method === 'POST') {
      const config = postConfigs.get(url)
      return streamResponse(config || { chunks: [], hang: false }, options.signal)
    }
    return jsonResponse([])
  })
})

function tick(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('流式状态隔离 - streamingMessages Map', () => {
  it('两个对话同时流式输出,互不干扰', async () => {
    postConfigs.set('/api/conversations/a/messages', {
      chunks: [sseChunk([{ type: 'thought', content: 'A的思考' }])],
      hang: true,
    })
    postConfigs.set('/api/conversations/b/messages', {
      chunks: [sseChunk([{ type: 'thought', content: 'B的思考' }])],
      hang: true,
    })

    const store = useMessageStore()
    const pA = store.sendMessage('a', '问A')
    const pB = store.sendMessage('b', '问B')
    await tick()

    const msgA = store.getStreamingMessage('a')
    const msgB = store.getStreamingMessage('b')
    expect(msgA?.thought_steps.map(s => s.content)).toEqual(['A的思考'])
    expect(msgB?.thought_steps.map(s => s.content)).toEqual(['B的思考'])
    expect(store.isConversationStreaming('a')).toBe(true)
    expect(store.isConversationStreaming('b')).toBe(true)

    store.abortStreaming('a')
    store.abortStreaming('b')
    await Promise.all([pA, pB])
  })

  it('切换对话时旧对话 SSE 被 abort', async () => {
    postConfigs.set('/api/conversations/a/messages', { chunks: [], hang: true })

    const store = useMessageStore()
    const pA = store.sendMessage('a', '问A')
    await tick()

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.abortStreaming('a')
    await pA

    const postCall = calls.find(c => c.options.method === 'POST')
    expect((postCall!.options.signal as AbortSignal).aborted).toBe(true)
    expect(store.getStreamingMessage('a')).toBeNull()
    expect(store.isConversationStreaming('a')).toBe(false)
    // abort 不算错误
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('abort 后迟到的 SSE 事件不再追加内容', async () => {
    postConfigs.set('/api/conversations/a/messages', {
      chunks: [sseChunk([{ type: 'thought', content: 'A的思考' }])],
      hang: true,
    })

    const store = useMessageStore()
    const pA = store.sendMessage('a', '问A')
    await tick()

    store.abortStreaming('a')
    await pA

    // 模拟 abort 后网络层仍在推事件
    expect(() =>
      store.handleSSEEvent('a', { type: 'thought', content: '迟到事件' }, [])
    ).not.toThrow()
    expect(store.getStreamingMessage('a')).toBeNull()
  })

  it('sendMessage 期间切到新对话,新对话请求正常完成', async () => {
    postConfigs.set('/api/conversations/a/messages', { chunks: [], hang: true })
    postConfigs.set('/api/conversations/b/messages', {
      chunks: [sseChunk([{ type: 'content_delta', content: 'B的回答' }, { type: 'done' }])],
      hang: false,
    })

    const store = useMessageStore()
    const pA = store.sendMessage('a', '问A')
    await tick()

    await store.sendMessage('b', '问B')

    expect(store.getStreamingMessage('b')).toBeNull()
    expect(store.isConversationStreaming('b')).toBe(false)
    // 完成后拉取了 b 的持久化消息
    expect(calls.some(c => c.url === '/api/conversations/b/messages' && !c.options.method)).toBe(true)

    store.abortStreaming('a')
    await pA
  })

  it('sendMessage 完成后清理流式状态', async () => {
    postConfigs.set('/api/conversations/a/messages', {
      chunks: [sseChunk([{ type: 'content_delta', content: '答' }, { type: 'done' }])],
      hang: false,
    })

    const store = useMessageStore()
    await store.sendMessage('a', '问')

    expect(store.getStreamingMessage('a')).toBeNull()
    expect(store.isConversationStreaming('a')).toBe(false)
    // 临时 user 消息被清理(fetchMessages 替换为服务端返回的空列表)
    expect(store.messages).toEqual([])
  })
})

describe('流式状态隔离 - branchSelections 入 store', () => {
  it('分支选择按对话隔离,切换对话后保留', () => {
    const store = useMessageStore()

    store.setBranchSelection('a', 'm1', 1)
    store.setBranchSelection('b', 'm1', 0)

    expect(store.getBranchSelection('a', 'm1')).toBe(1)
    expect(store.getBranchSelection('b', 'm1')).toBe(0)

    // "切换对话"不清理:选择跨对话保留(按 conversationId 隔离已足够)
    expect(store.getBranchSelection('a', 'm1')).toBe(1)
  })

  it('根节点的分支选择用 __root__ 键', () => {
    const store = useMessageStore()
    store.setBranchSelection('a', null, 2)
    expect(store.getBranchSelection('a', null)).toBe(2)
  })

  it('clearBranchSelections 只清理指定对话', () => {
    const store = useMessageStore()
    store.setBranchSelection('a', 'm1', 1)
    store.setBranchSelection('b', 'm1', 0)

    store.clearBranchSelections('b')

    expect(store.getBranchSelection('a', 'm1')).toBe(1)
    expect(store.getBranchSelection('b', 'm1')).toBeUndefined()
  })
})
