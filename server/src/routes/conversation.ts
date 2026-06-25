import { Router } from 'express'
import {
  createConversation,
  getConversationsByUserId,
  getConversation,
  updateConversation,
  deleteConversation,
  getMessages,
  countPinnedConversations,
} from '../db'
import { authMiddleware } from '../middleware/auth'

const router = Router()

router.use(authMiddleware)

function checkOwnership(conv: { user_id: string | null }, userId: string, role: string): boolean {
  if (role === 'admin') return true
  if (conv.user_id === null) return true
  return conv.user_id === userId
}

function claimOrphan(conv: { id: string; user_id: string | null }, userId: string): void {
  if (conv.user_id === null) {
    updateConversation(conv.id, { user_id: userId })
  }
}

router.get('/', (req, res) => {
  try {
    if (req.user!.role === 'admin' && req.query.userId) {
      const conversations = getConversationsByUserId(req.query.userId as string)
      res.json(conversations)
      return
    }
    const conversations = getConversationsByUserId(req.user!.userId)
    const orphans = getConversationsByUserId(null)
    const seen = new Set(conversations.map(c => c.id))
    const merged = [...conversations, ...orphans.filter(c => !seen.has(c.id))]
    merged.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
    res.json(merged)
  } catch (err: unknown) {
    console.error('[GET conversations]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.post('/', (req, res) => {
  try {
    const { title, system_prompt } = req.body || {}
    const conv = createConversation(title, system_prompt, req.user!.userId)
    res.status(201).json(conv)
  } catch (err: unknown) {
    console.error('[POST conversations]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.get('/:id', (req, res) => {
  try {
    const conv = getConversation(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (!checkOwnership(conv, req.user!.userId, req.user!.role)) {
      res.status(403).json({ error: '无权限访问' })
      return
    }
    claimOrphan(conv, req.user!.userId)
    res.json(conv)
  } catch (err: unknown) {
    console.error('[GET conversation/:id]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.patch('/:id', (req, res) => {
  try {
    const conv = getConversation(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (!checkOwnership(conv, req.user!.userId, req.user!.role)) {
      res.status(403).json({ error: '无权限访问' })
      return
    }
    claimOrphan(conv, req.user!.userId)
    const { title, system_prompt, is_pinned } = req.body || {}
    if (is_pinned === true) {
      const pinnedCount = countPinnedConversations(req.user!.userId)
      if (pinnedCount >= 5) {
        res.status(400).json({ error: '最多置顶 5 个对话' })
        return
      }
    }
    updateConversation(req.params.id, { title, system_prompt, is_pinned })
    const updated = getConversation(req.params.id)
    res.json(updated)
  } catch (err: unknown) {
    console.error('[PATCH conversation/:id]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const conv = getConversation(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (!checkOwnership(conv, req.user!.userId, req.user!.role)) {
      res.status(403).json({ error: '无权限访问' })
      return
    }
    deleteConversation(req.params.id)
    res.status(204).end()
  } catch (err: unknown) {
    console.error('[DELETE conversation/:id]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

router.get('/:id/export', (req, res) => {
  try {
    const conv = getConversation(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (!checkOwnership(conv, req.user!.userId, req.user!.role)) {
      res.status(403).json({ error: '无权限访问' })
      return
    }
    claimOrphan(conv, req.user!.userId)
    const messages = getMessages(req.params.id)
    const format = req.query.format || 'json'

    if (format === 'md') {
      let md = `# ${conv.title}\n\n`
      if (conv.system_prompt) {
        md += `**System Prompt:** ${conv.system_prompt}\n\n`
      }
      for (const msg of messages) {
        const label = msg.role === 'user' ? '**User**' : msg.role === 'assistant' ? '**Agent**' : '**System**'
        md += `${label}: ${msg.content}\n\n`
        if (msg.thought_steps.length > 0) {
          md += `<details><summary>Thought Process (${msg.thought_steps.length} steps)</summary>\n\n`
          for (const step of msg.thought_steps) {
            const prefix = step.type === 'thought' ? '💭' : step.type === 'action' ? `[${step.tool_name}]` : '👁'
            md += `${prefix} ${step.content}\n\n`
          }
          md += `</details>\n\n`
        }
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.send(md)
    } else {
      res.json({ conversation: conv, messages })
    }
  } catch (err: unknown) {
    console.error('[GET conversation/:id/export]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

export default router
