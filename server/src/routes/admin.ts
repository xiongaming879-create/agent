import { Router } from 'express'
import { authMiddleware, adminMiddleware } from '../middleware/auth'
import { getAllUsers } from '../db/user'
import { getConversationsByUserId } from '../db/index'

const router = Router()

router.use(authMiddleware, adminMiddleware)

router.get('/users', (_req, res) => {
  const users = getAllUsers()
  res.json(users)
})

router.get('/users/:userId/conversations', (req, res) => {
  const { userId } = req.params
  const conversations = getConversationsByUserId(userId)
  res.json(conversations)
})

export default router
