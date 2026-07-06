import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetMessages = vi.fn()
const mockCreateMessage = vi.fn()
const mockGetConversation = vi.fn()
const mockUpdateConversation = vi.fn()
const mockGetMessage = vi.fn()
const mockRunAgent = vi.fn()
const mockExtractSessionMemories = vi.fn()

vi.mock('../../../server/src/db', () => ({
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
  getMessage: (...args: unknown[]) => mockGetMessage(...args),
}))

vi.mock('../../../server/src/services/agent', () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}))

vi.mock('../../../server/src/services/memory-extractor', () => ({
  extractSessionMemories: (...args: unknown[]) => mockExtractSessionMemories(...args),
}))

vi.mock('../../../server/src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user', role: 'admin' }
    next()
  },
}))

vi.mock('../../../server/src/tools', () => ({
  tools: [],
}))

// Import the module under test AFTER mocks are set up
import messageRouter from '../../../server/src/routes/message'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRequest(method: string, path: string, body?: unknown): any {
  const req = new EventEmitter() as any
  req.method = method
  req.url = path
  req.headers = { 'content-type': 'application/json' }
  req.body = body
  return req
}

function mockResponse(): any {
  const res = new EventEmitter() as any
  res.statusCode = 200
  res.headers = {} as Record<string, string>
  res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v })
  res.flushHeaders = vi.fn()
  res.write = vi.fn()
  res.end = vi.fn()
  res.status = vi.fn(function (this: any, c: number) { this.statusCode = c; return this })
  res.json = vi.fn()
  return res
}

function makeGenerator<T>(items: T[]): AsyncGenerator<T> {
  return (async function* () {
    for (const item of items) yield item
  })()
}

/** Agent generator that yields a couple of content deltas then done. */
function agentStreamGen(): AsyncGenerator<any> {
  return makeGenerator([
    { type: 'content_delta' as const, content: 'Hello!' },
    { type: 'done' as const },
  ])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Flow — Memory Extraction Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls extractSessionMemories with correct conversationId and messages after SSE done', async () => {
    // Setup DB mocks
    mockGetConversation.mockReturnValue({
      id: 'conv-1',
      title: 'New Conversation',
      system_prompt: null,
      user_id: null,
    })
    // First call from history context, second call from extraction hook
    mockGetMessages
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { role: 'user', content: 'Hello', id: 'm1', conversation_id: 'conv-1', parent_id: null, thought_steps: [], created_at: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hello!', id: 'm2', conversation_id: 'conv-1', parent_id: 'm1', thought_steps: [], created_at: '2025-01-01T00:00:01Z' },
      ])
    mockCreateMessage.mockReturnValue({ id: 'new-msg' })
    mockUpdateConversation.mockReturnValue(undefined)
    mockRunAgent.mockReturnValue(agentStreamGen())
    mockExtractSessionMemories.mockResolvedValue(undefined)

    const app = express()
    app.use('/api/conversations', messageRouter)

    const req = mockRequest('POST', '/api/conversations/conv-1/messages', { content: 'Hello' })
    const res = mockResponse()

    app.handle(req, res)

    // Wait for async processing to complete
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(mockExtractSessionMemories).toHaveBeenCalledTimes(1)
    expect(mockExtractSessionMemories).toHaveBeenCalledWith(
      'conv-1',
      [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello!' },
      ]
    )
  })

  it('does not throw when extractSessionMemories rejects', async () => {
    mockGetConversation.mockReturnValue({
      id: 'conv-2',
      title: 'New Conversation',
      system_prompt: null,
      user_id: null,
    })
    mockGetMessages
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { role: 'user', content: 'Hi', id: 'm1', conversation_id: 'conv-2' },
        { role: 'assistant', content: 'Hey', id: 'm2', conversation_id: 'conv-2' },
      ])
    mockCreateMessage.mockReturnValue({ id: 'new-msg' })
    mockUpdateConversation.mockReturnValue(undefined)
    mockRunAgent.mockReturnValue(agentStreamGen())
    // Simulate extraction failure
    mockExtractSessionMemories.mockRejectedValue(new Error('Extraction failed'))

    const app = express()
    app.use('/api/conversations', messageRouter)

    const req = mockRequest('POST', '/api/conversations/conv-2/messages', { content: 'Hi' })
    const res = mockResponse()

    let handlerError: unknown = null
    try {
      app.handle(req, res)
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (err) {
      handlerError = err
    }

    // The route handler should NOT throw even though extraction rejects
    expect(handlerError).toBeNull()
    // Response should have ended normally
    expect(res.end).toHaveBeenCalled()
    // The extraction should have been called (and rejected silently)
    expect(mockExtractSessionMemories).toHaveBeenCalled()
  })

  it('triggers extraction after SSE done, not blocking the response', async () => {
    mockGetConversation.mockReturnValue({
      id: 'conv-3',
      title: 'New Conversation',
      system_prompt: null,
      user_id: null,
    })
    mockGetMessages
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { role: 'user', content: 'Test', id: 'm1', conversation_id: 'conv-3' },
        { role: 'assistant', content: 'Response', id: 'm2', conversation_id: 'conv-3' },
      ])
    mockCreateMessage.mockReturnValue({ id: 'new-msg' })
    mockUpdateConversation.mockReturnValue(undefined)
    mockRunAgent.mockReturnValue(agentStreamGen())

    // Make extraction slow to verify it doesn't block the response
    let extractionResolved = false
    mockExtractSessionMemories.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 500))
      extractionResolved = true
    })

    const app = express()
    app.use('/api/conversations', messageRouter)

    const req = mockRequest('POST', '/api/conversations/conv-3/messages', { content: 'Test' })
    const res = mockResponse()

    app.handle(req, res)
    await new Promise(resolve => setTimeout(resolve, 100))

    // The response should have ended BEFORE extraction completes
    expect(res.end).toHaveBeenCalled()
    expect(extractionResolved).toBe(false)
  })
})
