import type { User } from '../types'

export function isAvatarImagePath(avatar: string): boolean {
  return avatar.startsWith('/avatars/')
}

export function getInitialLetter(username: string): string {
  return username.charAt(0).toUpperCase()
}

export function getAvatarBgColor(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 40%, 45%)`
}

export function renderAvatar(user: User): { type: 'image'; src: string } | { type: 'initial'; letter: string; color: string } {
  if (isAvatarImagePath(user.avatar)) {
    return { type: 'image', src: user.avatar }
  }
  return {
    type: 'initial',
    letter: getInitialLetter(user.username),
    color: getAvatarBgColor(user.username),
  }
}

export function avatarSrc(avatar: string): string {
  if (!isAvatarImagePath(avatar)) return avatar
  const sep = avatar.includes('?') ? '&' : '?'
  return `${avatar}${sep}t=${Date.now()}`
}
