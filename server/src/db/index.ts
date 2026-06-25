import initSqlJs, { type Database } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { migrations } from './migrations'
import type { Conversation, Message, ThoughtStep } from '../types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/agent.db')

let _db: Database | null = null
let _autoSaveTimer: ReturnType<typeof setInterval> | null = null
let _dirty = false

export function resetDb(): void {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer)
    _autoSaveTimer = null
  }
  if (_db) {
    if (_dirty) saveDb()
    _db.close()
    _db = null
  }
  _dirty = false
}

export async function initDb(): Promise<void> {
  if (_db) return
  const SQL = await initSqlJs()
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH)
    _db = new SQL.Database(buf)
  } else {
    _db = new SQL.Database()
  }

  _db.run('PRAGMA foreign_keys = ON')
  runMigrations()
  saveDb()
  startAutoSave()
}

function runMigrations(): void {
  const db = getDb()
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    db.exec('SELECT version FROM schema_version')[0]?.values.map(r => r[0] as number) ?? []
  )

  // If no migrations recorded yet but tables already exist, mark all current migrations as applied
  if (applied.size === 0 && tableExists(db, 'conversations')) {
    for (const m of migrations) {
      db.run('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()])
    }
    markDirty()
    return
  }

  for (const m of migrations) {
    if (applied.has(m.version)) continue
    try {
      db.run(m.up)
    } catch (e) {
      // ALTER TABLE ADD COLUMN fails if column already exists — safe to skip
      if (!String(e).includes('duplicate column name')) throw e
    }
    db.run('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()])
  }

  markDirty()
}

function tableExists(db: Database, tableName: string): boolean {
  const result = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName])
  return !!(result[0] && result[0].values.length > 0)
}

function startAutoSave(): void {
  if (_autoSaveTimer) return
  _autoSaveTimer = setInterval(() => {
    if (_dirty && _db) {
      saveDb()
      _dirty = false
    }
  }, 5000)
}

export function stopAutoSave(): void {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer)
    _autoSaveTimer = null
  }
  if (_dirty) {
    saveDb()
    _dirty = false
  }
}

export function getDb(): Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.')
  return _db
}

function saveDb(): void {
  if (!_db) return
  const data = _db.export()
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

export function markDirty(): void {
  _dirty = true
}

function parseThoughtSteps(raw: string): ThoughtStep[] {
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

// --- Conversation ---

export function createConversation(title?: string, systemPrompt?: string, userId?: string): Conversation {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO conversations (id, title, system_prompt, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, title || '新对话', systemPrompt || null, userId || null, now, now]
  )
  markDirty()
  return { id, title: title || '新对话', system_prompt: systemPrompt || null, user_id: userId || null, is_pinned: false, created_at: now, updated_at: now }
}

const CONV_COLS = 'id, title, system_prompt, created_at, updated_at, user_id, is_pinned'

function rowToConversation(row: unknown[]): Conversation {
  return {
    id: row[0] as string,
    title: row[1] as string,
    system_prompt: row[2] as string | null,
    created_at: row[3] as string,
    updated_at: row[4] as string,
    user_id: (row[5] as string | null) ?? null,
    is_pinned: row[6] === 1,
  }
}

export function getConversations(): Conversation[] {
  const db = getDb()
  const result = db.exec(`SELECT ${CONV_COLS} FROM conversations ORDER BY is_pinned DESC, updated_at DESC`)
  if (!result[0]) return []
  return result[0].values.map(rowToConversation)
}

export function getConversationsByUserId(userId: string | null): Conversation[] {
  const db = getDb()
  const result = userId
    ? db.exec(`SELECT ${CONV_COLS} FROM conversations WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC`, [userId])
    : db.exec(`SELECT ${CONV_COLS} FROM conversations WHERE user_id IS NULL ORDER BY is_pinned DESC, updated_at DESC`)
  if (!result[0]) return []
  return result[0].values.map(rowToConversation)
}

export function getConversation(id: string): Conversation | null {
  const db = getDb()
  const result = db.exec(`SELECT ${CONV_COLS} FROM conversations WHERE id = ?`, [id])
  if (!result[0] || !result[0].values[0]) return null
  return rowToConversation(result[0].values[0])
}

export function updateConversation(id: string, data: Partial<Pick<Conversation, 'title' | 'system_prompt' | 'user_id' | 'is_pinned'>>): void {
  const db = getDb()
  const sets: string[] = []
  const values: unknown[] = []
  if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title) }
  if (data.system_prompt !== undefined) { sets.push('system_prompt = ?'); values.push(data.system_prompt) }
  if (data.user_id !== undefined) { sets.push('user_id = ?'); values.push(data.user_id) }
  if (data.is_pinned !== undefined) { sets.push('is_pinned = ?'); values.push(data.is_pinned ? 1 : 0) }
  if (sets.length === 0) return
  const now = new Date().toISOString()
  sets.push('updated_at = ?')
  values.push(now)
  values.push(id)
  db.run(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values)
  markDirty()
}

export function countPinnedConversations(userId: string): number {
  const db = getDb()
  const result = db.exec(
    `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND is_pinned = 1`,
    [userId]
  )
  return (result[0]?.values[0]?.[0] as number) ?? 0
}

export function deleteConversation(id: string): void {
  const db = getDb()
  db.run(`DELETE FROM messages WHERE conversation_id = ?`, [id])
  db.run(`DELETE FROM conversations WHERE id = ?`, [id])
  markDirty()
}

// --- Message ---

export interface CreateMessageInput {
  conversation_id: string
  parent_id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  thought_steps?: ThoughtStep[]
}

export function createMessage(input: CreateMessageInput): Message {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const steps = input.thought_steps || []
  db.run(
    `INSERT INTO messages (id, conversation_id, parent_id, role, content, thought_steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.conversation_id, input.parent_id, input.role, input.content, JSON.stringify(steps), now]
  )
  db.run(`UPDATE conversations SET updated_at = ? WHERE id = ?`, [now, input.conversation_id])
  markDirty()
  return {
    id,
    conversation_id: input.conversation_id,
    parent_id: input.parent_id,
    role: input.role,
    content: input.content,
    thought_steps: steps,
    created_at: now,
  }
}

const MSG_COLS = 'id, conversation_id, parent_id, role, content, thought_steps, created_at'

function rowToMessage(row: unknown[]): Message {
  return {
    id: row[0] as string,
    conversation_id: row[1] as string,
    parent_id: row[2] as string | null,
    role: row[3] as Message['role'],
    content: row[4] as string,
    thought_steps: parseThoughtSteps(row[5] as string),
    created_at: row[6] as string,
  }
}

export function getMessages(conversationId: string): Message[] {
  const db = getDb()
  const result = db.exec(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`, [conversationId])
  if (!result[0]) return []
  return result[0].values.map(rowToMessage)
}

export function getMessagesByParent(conversationId: string, parentId: string | null): Message[] {
  const db = getDb()
  const result = parentId
    ? db.exec(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id = ? AND parent_id = ? ORDER BY created_at ASC`, [conversationId, parentId])
    : db.exec(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id = ? AND parent_id IS NULL ORDER BY created_at ASC`, [conversationId])
  if (!result[0]) return []
  return result[0].values.map(rowToMessage)
}

export function getMessage(id: string): Message | null {
  const db = getDb()
  const result = db.exec(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`, [id])
  if (!result[0] || !result[0].values[0]) return null
  return rowToMessage(result[0].values[0])
}

export function updateMessage(id: string, data: Partial<Pick<Message, 'content' | 'thought_steps'>>): void {
  const db = getDb()
  const sets: string[] = []
  const values: unknown[] = []
  if (data.content !== undefined) { sets.push('content = ?'); values.push(data.content) }
  if (data.thought_steps !== undefined) { sets.push('thought_steps = ?'); values.push(JSON.stringify(data.thought_steps)) }
  if (sets.length === 0) return
  values.push(id)
  db.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, values)
  markDirty()
}

export function deleteMessage(id: string): void {
  const db = getDb()
  db.run(`DELETE FROM messages WHERE id = ?`, [id])
  markDirty()
}
