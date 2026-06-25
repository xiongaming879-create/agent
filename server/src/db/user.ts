import type { User, UserRow } from '../types'
import { getDb, markDirty } from './index'

const USER_COLS = 'id, username, role, avatar, theme, font_size, created_at, updated_at'
const USER_ROW_COLS = 'id, username, password_hash, role, avatar, theme, font_size, created_at, updated_at'

function rowToUser(row: unknown[]): User {
  return {
    id: row[0] as string,
    username: row[1] as string,
    role: row[2] as 'user' | 'admin',
    avatar: row[3] as string,
    theme: row[4] as 'light' | 'dark' | 'auto',
    font_size: row[5] as number,
    created_at: row[6] as string,
    updated_at: row[7] as string,
  }
}

function rowToUserRow(row: unknown[]): UserRow {
  return {
    id: row[0] as string,
    username: row[1] as string,
    password_hash: row[2] as string,
    role: row[3] as 'user' | 'admin',
    avatar: row[4] as string,
    theme: row[5] as 'light' | 'dark' | 'auto',
    font_size: row[6] as number,
    created_at: row[7] as string,
    updated_at: row[8] as string,
  }
}

export function createUser(username: string, passwordHash: string): User {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO users (id, username, password_hash, role, avatar, theme, font_size, created_at, updated_at) VALUES (?, ?, ?, 'user', '👤', 'auto', 14, ?, ?)`,
    [id, username, passwordHash, now, now]
  )
  markDirty()
  return { id, username, role: 'user', avatar: '👤', theme: 'auto', font_size: 14, created_at: now, updated_at: now }
}

export function getUserByUsername(username: string): UserRow | null {
  const db = getDb()
  const result = db.exec(`SELECT ${USER_ROW_COLS} FROM users WHERE username = ?`, [username])
  if (!result[0] || !result[0].values[0]) return null
  return rowToUserRow(result[0].values[0])
}

export function getUserById(id: string): User | null {
  const db = getDb()
  const result = db.exec(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id])
  if (!result[0] || !result[0].values[0]) return null
  return rowToUser(result[0].values[0])
}

export function getUserRowById(id: string): UserRow | null {
  const db = getDb()
  const result = db.exec(`SELECT ${USER_ROW_COLS} FROM users WHERE id = ?`, [id])
  if (!result[0] || !result[0].values[0]) return null
  return rowToUserRow(result[0].values[0])
}

export function getAllUsers(): User[] {
  const db = getDb()
  const result = db.exec(`SELECT ${USER_COLS} FROM users ORDER BY created_at ASC`)
  if (!result[0]) return []
  return result[0].values.map(rowToUser)
}

export function updateUserSettings(id: string, data: Partial<Pick<User, 'avatar' | 'theme' | 'font_size'>>): void {
  const db = getDb()
  const sets: string[] = []
  const values: unknown[] = []
  if (data.avatar !== undefined) { sets.push('avatar = ?'); values.push(data.avatar) }
  if (data.theme !== undefined) { sets.push('theme = ?'); values.push(data.theme) }
  if (data.font_size !== undefined) { sets.push('font_size = ?'); values.push(data.font_size) }
  if (sets.length === 0) return
  const now = new Date().toISOString()
  sets.push('updated_at = ?')
  values.push(now)
  values.push(id)
  db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values)
  markDirty()
}

export function updateUserPassword(id: string, passwordHash: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [passwordHash, now, id])
  markDirty()
}

export function seedAdmin(passwordHash: string): void {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin'
  const db = getDb()
  const existing = db.exec(`SELECT id FROM users WHERE username = ?`, [adminUsername])
  if (existing[0] && existing[0].values.length > 0) return
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO users (id, username, password_hash, role, avatar, theme, font_size, created_at, updated_at) VALUES (?, ?, ?, 'admin', '👤', 'auto', 14, ?, ?)`,
    [id, adminUsername, passwordHash, now, now]
  )
  markDirty()
}

export function getUserCount(): number {
  const db = getDb()
  const result = db.exec(`SELECT COUNT(*) as cnt FROM users`)
  if (!result[0] || !result[0].values[0]) return 0
  return result[0].values[0][0] as number
}
