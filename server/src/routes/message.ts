import { Router } from 'express'
import { getMessages, getMessagesByParent, createMessage, getMessage, getConversation, updateConversation } from '../db'
import { authMiddleware } from '../middleware/auth'
import { runAgent, type AgentOptions } from '../services/agent'
import { extractSessionMemories } from '../services/memory-extractor'
import { tools } from '../tools'
import type { AgentEvent, ThoughtStep } from '../types'

const router = Router()

router.use(authMiddleware)

function verifyOwnership(conversationId: string, userId: string, role: string): boolean {
  const conv = getConversation(conversationId)
  if (!conv) return false
  if (role === 'admin') return true
  if (conv.user_id === null) {
    updateConversation(conversationId, { user_id: userId })
    return true
  }
  return conv.user_id === userId
}

function processAgentStream(
  res: ReturnType<typeof Router>,
  contextMessages: { role: string; content: string }[],
  agentOptions: AgentOptions,
  onDone: (fullContent: string, thoughtSteps: ThoughtStep[]) => void
) {
  const thoughtSteps: ThoughtStep[] = []
  let fullContent = ''

  const sendSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  return (async () => {
    try {
      for await (const event of runAgent(contextMessages, tools, agentOptions) as AsyncGenerator<AgentEvent>) {
        sendSSE(event.type, event)

        if (event.type === 'thought_delta') {
          if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
            thoughtSteps[thoughtSteps.length - 1].content += event.content
          } else {
            thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
          }
        } else if (event.type === 'thought') {
          if (thoughtSteps.length > 0 && thoughtSteps[thoughtSteps.length - 1].type === 'thought') {
            thoughtSteps[thoughtSteps.length - 1].content = event.content
          } else {
            thoughtSteps.push({ type: 'thought', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
          }
        } else if (event.type === 'action') {
          thoughtSteps.push({ type: 'action', content: event.content, tool_name: event.tool_name, timestamp: new Date().toISOString() })
        } else if (event.type === 'observation') {
          thoughtSteps.push({ type: 'observation', content: event.content, tool_name: null, timestamp: new Date().toISOString() })
        } else if (event.type === 'content_delta') {
          fullContent += event.content
        } else if (event.type === 'content') {
          fullContent += event.content
        } else if (event.type === 'done') {
          onDone(fullContent, thoughtSteps)
        }
      }
    } catch (err: unknown) {
      console.error('[Agent stream error]:', err)
      sendSSE('error', { message: err instanceof Error ? err.message : 'Unknown error' })
    }
    res.end()
  })()
}

router.get('/:conversationId/messages', (req, res) => {
  try {
    if (!verifyOwnership(req.params.conversationId, req.user!.userId, req.user!.role)) {
      res.status(403).json({ error: '无权限访问' })
      return
    }
    const messages = getMessages(req.params.conversationId)
    res.json(messages)
  } catch (err: unknown) {
    console.error('[GET messages]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.post('/:conversationId/messages', async (req, res) => {
  if (!verifyOwnership(req.params.conversationId, req.user!.userId, req.user!.role)) {
    res.status(403).json({ error: '无权限访问' })
    return
  }

  const { content, parent_id } = req.body || {}
  if (!content) {
    res.status(400).json({ error: 'Content is required' })
    return
  }

  const userMsg = createMessage({
    conversation_id: req.params.conversationId,
    parent_id: parent_id || null,
    role: 'user',
    content,
  })

  const conv = getConversation(req.params.conversationId)
  if (conv && (conv.title === '新对话' || !conv.title)) {
    const title = content.length > 22 ? content.slice(0, 22) + '...' : content
    updateConversation(req.params.conversationId, { title })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const history = getMessages(req.params.conversationId)
  const contextMessages = history
    .filter(m => m.role !== 'system')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }))

  const agentOptions: AgentOptions = {
    systemPrompt: conv?.system_prompt || undefined,
  }

  await processAgentStream(res, contextMessages, agentOptions, (fullContent, thoughtSteps) => {
    createMessage({
      conversation_id: req.params.conversationId,
      parent_id: userMsg.id,
      role: 'assistant',
      content: fullContent,
      thought_steps: thoughtSteps,
    })
  })

  // Fire-and-forget memory extraction after SSE stream completes
  const allMessages = getMessages(req.params.conversationId)
  extractSessionMemories(
    req.params.conversationId,
    allMessages.map(m => ({ role: m.role, content: m.content }))
  ).catch(err => console.warn('[Memory] Extraction failed:', err))
})

router.patch('/:conversationId/messages/:messageId', (req, res) => {
  if (!verifyOwnership(req.params.conversationId, req.user!.userId, req.user!.role)) {
    res.status(403).json({ error: '无权限访问' })
    return
  }

  const { content } = req.body || {}
  if (!content) {
    res.status(400).json({ error: 'Content is required' })
    return
  }

  const original = getMessage(req.params.messageId)
  if (!original) {
    res.status(404).json({ error: 'Message not found' })
    return
  }

  const branched = createMessage({
    conversation_id: req.params.conversationId,
    parent_id: original.parent_id,
    role: 'user',
    content,
  })

  res.json(branched)
})

router.post('/:conversationId/messages/:messageId/regenerate', async (req, res) => {
  if (!verifyOwnership(req.params.conversationId, req.user!.userId, req.user!.role)) {
    res.status(403).json({ error: '无权限访问' })
    return
  }

  const original = getMessage(req.params.messageId)
  if (!original) {
    res.status(404).json({ error: 'Message not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const history = getMessages(req.params.conversationId)
  const originalIndex = history.findIndex(m => m.id === req.params.messageId)
  const contextMessages = history
    .slice(0, originalIndex)
    .filter(m => m.role !== 'system')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }))

  const conv = getConversation(req.params.conversationId)
  const agentOptions: AgentOptions = {
    systemPrompt: conv?.system_prompt || undefined,
  }

  await processAgentStream(res, contextMessages, agentOptions, (fullContent, thoughtSteps) => {
    createMessage({
      conversation_id: req.params.conversationId,
      parent_id: original.parent_id,
      role: 'assistant',
      content: fullContent,
      thought_steps: thoughtSteps,
    })
  })

  // Fire-and-forget memory extraction after SSE stream completes
  const allMessages = getMessages(req.params.conversationId)
  extractSessionMemories(
    req.params.conversationId,
    allMessages.map(m => ({ role: m.role, content: m.content }))
  ).catch(err => console.warn('[Memory] Extraction failed:', err))
})

export default router
