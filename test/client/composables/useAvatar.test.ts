import { describe, it, expect } from 'vitest'
import { isAvatarImagePath, getInitialLetter, getAvatarBgColor, renderAvatar, avatarSrc } from '../../../client/src/composables/useAvatar'
import type { User } from '../../../client/src/types'

describe('useAvatar composable', () => {
  it('avatar 为文件路径时返回 img 标签用的 src', () => {
    expect(isAvatarImagePath('/avatars/user-123.jpg')).toBe(true)
  })

  it('avatar 为空或 emoji 时返回 false（使用首字母头像）', () => {
    expect(isAvatarImagePath('👤')).toBe(false)
    expect(isAvatarImagePath('')).toBe(false)
  })

  it('首字母背景色根据 username hash 生成', () => {
    const color = getAvatarBgColor('alice')
    expect(color).toMatch(/^hsl\(\d+, 40%, 45%\)$/)
  })

  it('首字母取 username 第一个字符并大写', () => {
    expect(getInitialLetter('alice')).toBe('A')
    expect(getInitialLetter('Bob')).toBe('B')
  })

  it('renderAvatar: 图片路径用户返回 image 类型', () => {
    const user: User = {
      id: '1', username: 'alice', role: 'user',
      avatar: '/avatars/1.jpg', theme: 'auto', font_size: 14,
      created_at: '', updated_at: '',
    }
    const result = renderAvatar(user)
    expect(result.type).toBe('image')
    if (result.type === 'image') expect(result.src).toBe('/avatars/1.jpg')
  })

  it('renderAvatar: emoji 用户返回 initial 类型', () => {
    const user: User = {
      id: '1', username: 'bob', role: 'user',
      avatar: '👤', theme: 'auto', font_size: 14,
      created_at: '', updated_at: '',
    }
    const result = renderAvatar(user)
    expect(result.type).toBe('initial')
    if (result.type === 'initial') {
      expect(result.letter).toBe('B')
      expect(result.color).toMatch(/^hsl\(/)
    }
  })

  it('avatarSrc: 图片路径追加时间戳参数', () => {
    const result = avatarSrc('/avatars/1.jpg')
    expect(result).toMatch(/^\/avatars\/1\.jpg\?t=\d+$/)
  })

  it('avatarSrc: 非 avatar 路径原样返回', () => {
    expect(avatarSrc('👤')).toBe('👤')
    expect(avatarSrc('')).toBe('')
  })

  it('avatarSrc: 已有查询参数时用 & 连接', () => {
    const result = avatarSrc('/avatars/1.jpg?foo=bar')
    expect(result).toMatch(/^\/avatars\/1\.jpg\?foo=bar&t=\d+$/)
  })
})
