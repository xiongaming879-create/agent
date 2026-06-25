import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { getUserByUsername, createUser, getUserById } from '../db/user'
import { signToken, authMiddleware } from '../middleware/auth'

const router = Router()

router.post('/register', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string }

  if (!username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' })
    return
  }

  if (username.length < 2 || username.length > 20) {
    res.status(400).json({ error: '用户名需2-20个字符' })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ error: '密码至少6位' })
    return
  }

  const existing = getUserByUsername(username)
  if (existing) {
    res.status(409).json({ error: '用户名已存在' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = createUser(username, passwordHash)
  const token = signToken({ userId: user.id, username: user.username, role: user.role })

  res.status(201).json({ token, user })
})

router.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string }

  if (!username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' })
    return
  }

  const userRow = getUserByUsername(username)
  if (!userRow) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }

  const valid = await bcrypt.compare(password, userRow.password_hash)
  if (!valid) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }

  const { password_hash: _, ...user } = userRow
  const token = signToken({ userId: user.id, username: user.username, role: user.role })

  res.json({ token, user })
})

router.get('/me', authMiddleware, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: '未登录' })
    return
  }

  const user = getUserById(req.user.userId)
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  res.json(user)
})

export default router
