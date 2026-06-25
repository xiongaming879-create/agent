import { Router } from 'express'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { authMiddleware } from '../middleware/auth'
import { getUserById, getUserRowById, updateUserSettings, updateUserPassword } from '../db/user'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AVATAR_DIR = path.resolve(__dirname, '../../data/avatars')

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req, _file, cb) => cb(null, `${req.user!.userId}.jpg`),
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('仅支持图片文件'))
    }
  },
})

const router = Router()

router.use(authMiddleware)

router.patch('/settings', (req, res) => {
  const { avatar, theme, font_size } = req.body as {
    avatar?: string
    theme?: 'light' | 'dark' | 'auto'
    font_size?: number
  }

  if (theme && !['light', 'dark', 'auto'].includes(theme)) {
    res.status(400).json({ error: '无效的主题' })
    return
  }

  if (font_size !== undefined && (font_size < 12 || font_size > 20)) {
    res.status(400).json({ error: '字号范围12-20' })
    return
  }

  updateUserSettings(req.user!.userId, { avatar, theme, font_size })
  const user = getUserById(req.user!.userId)
  res.json(user)
})

router.post('/avatar', (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: '文件大小不能超过2MB' })
        return
      }
      res.status(400).json({ error: err.message })
      return
    }
    if (err) {
      res.status(400).json({ error: err.message })
      return
    }
    next()
  })
}, (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '请选择图片文件' })
    return
  }
  const avatarPath = `/avatars/${req.user!.userId}.jpg`
  updateUserSettings(req.user!.userId, { avatar: avatarPath })
  const user = getUserById(req.user!.userId)
  res.json(user)
})

router.patch('/password', async (req, res) => {
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string }

  if (!old_password || !new_password) {
    res.status(400).json({ error: '请输入旧密码和新密码' })
    return
  }

  if (new_password.length < 6) {
    res.status(400).json({ error: '新密码至少6位' })
    return
  }

  const userRow = getUserRowById(req.user!.userId)
  if (!userRow) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const valid = await bcrypt.compare(old_password, userRow.password_hash)
  if (!valid) {
    res.status(401).json({ error: '旧密码错误' })
    return
  }

  const hash = await bcrypt.hash(new_password, 10)
  updateUserPassword(req.user!.userId, hash)
  res.json({ message: '密码修改成功' })
})

export default router
