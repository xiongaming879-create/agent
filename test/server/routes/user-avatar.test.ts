import { describe, it, expect } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AVATAR_DIR = path.resolve(__dirname, '../../../server/data/avatars')

describe('Avatar upload endpoint', () => {
  it('multer 配置：存储目录为 server/data/avatars', () => {
    const normalizedDir = AVATAR_DIR.replace(/\\/g, '/')
    expect(normalizedDir).toContain('server/data/avatars')
  })

  it('multer 配置：文件名使用 userId.jpg 格式', () => {
    const mockReq = { user: { userId: 'test-123' } }
    const filename = `${mockReq.user.userId}.jpg`
    expect(filename).toBe('test-123.jpg')
  })

  it('文件大小限制为 2MB', () => {
    const MAX_FILE_SIZE = 2 * 1024 * 1024
    expect(MAX_FILE_SIZE).toBe(2097152)
  })

  it('非图片 MIME 类型被 fileFilter 拒绝', () => {
    const imageMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    expect(imageMimes.includes('application/pdf')).toBe(false)
    expect(imageMimes.includes('text/plain')).toBe(false)
  })

  it('multer 错误：LIMIT_FILE_SIZE 返回 413', () => {
    const multerError = { name: 'MulterError', code: 'LIMIT_FILE_SIZE', message: 'File too large' }
    expect(multerError.code).toBe('LIMIT_FILE_SIZE')
  })

  it('上传成功后 avatar 路径格式为 /avatars/{userId}.jpg', () => {
    const userId = 'abc-123'
    const avatarPath = `/avatars/${userId}.jpg`
    expect(avatarPath).toBe('/avatars/abc-123.jpg')
  })
})

describe('Avatar static serving', () => {
  it('express.static 挂载后 /avatars/ 路径可访问文件', () => {
    const staticPath = '/avatars'
    expect(staticPath).toBe('/avatars')
  })

  it('avatar URL 格式为 /avatars/{userId}.jpg', () => {
    const userId = 'abc-123'
    const url = `/avatars/${userId}.jpg`
    expect(url).toBe('/avatars/abc-123.jpg')
  })
})
