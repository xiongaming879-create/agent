import initSqlJs, { type Database } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { memoryMigrations } from './migrations-memory'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getMemoryDbPath(): string {
  return process.env.MEMORY_DB_PATH || path.resolve(__dirname, '../../data/memory.db')
}

let _db: Database | null = null

export function resetMemoryDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export async function initMemoryDb(): Promise<void> {
  if (_db) return
  const SQL = await initSqlJs()
  const dbPath = getMemoryDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    _db = new SQL.Database(buf)
  } else {
    _db = new SQL.Database()
  }

  _db.run('PRAGMA foreign_keys = ON')
  runMigrations()
  saveMemoryDb()
}

function runMigrations(): void {
  const db = getMemoryDb()
  for (const sql of memoryMigrations) {
    try {
      db.run(sql)
    } catch (e) {
      // ALTER TABLE ADD COLUMN 在列已存在时报 "duplicate column name"，安全跳过。
      // 这样新库（CREATE 时无 user_id）首次 ALTER 成功，重启后再 ALTER 也不会崩。
      if (!String(e).includes('duplicate column name')) throw e
    }
  }
  markMemoryDirty()
}

function saveMemoryDb(): void {
  if (!_db) return
  const data = _db.export()
  const dbPath = getMemoryDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(data))
}

export function getMemoryDb(): Database {
  if (!_db) throw new Error('Memory database not initialized. Call initMemoryDb() first.')
  return _db
}

function markMemoryDirty(): void {
  // For now, save synchronously on each write.
  // Can be optimized with a debounced write later.
  saveMemoryDb()
}

// --- Episode ---

export interface CreateEpisodeInput {
  conversation_id: string
  summary: string
  candidate_count?: number
  user_id?: string | null
}

export function createEpisode(input: CreateEpisodeInput): { id: string } {
  const db = getMemoryDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO memory_episodes (id, conversation_id, summary, candidate_count, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.conversation_id, input.summary, input.candidate_count ?? 0, now, input.user_id ?? null]
  )
  markMemoryDirty()
  return { id }
}

// --- Candidate ---

export interface CreateCandidateInput {
  conversation_id: string
  type: 'user_preference' | 'fact' | 'lesson'
  statement: string
  durable?: number
  user_id?: string | null
}

export function createCandidate(input: CreateCandidateInput): { id: string; promoted: number } {
  const db = getMemoryDb()
  const now = new Date().toISOString()

  // Compute next index for this conversation_id
  const countResult = db.exec(
    `SELECT COUNT(*) FROM memory_candidates WHERE conversation_id = ?`,
    [input.conversation_id]
  )
  const nextIndex = (countResult[0]?.values[0]?.[0] as number ?? 0) + 1
  const id = `${input.conversation_id}#${nextIndex}`

  db.run(
    `INSERT INTO memory_candidates (id, conversation_id, type, statement, durable, promoted, created_at, user_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, input.conversation_id, input.type, input.statement, input.durable ?? 0, now, input.user_id ?? null]
  )
  markMemoryDirty()
  return { id, promoted: 0 }
}

export interface Candidate {
  id: string
  conversation_id: string
  type: string
  statement: string
  durable: number
  promoted: number
  created_at: string
  user_id: string | null
}

function rowToCandidate(row: unknown[]): Candidate {
  return {
    id: row[0] as string,
    conversation_id: row[1] as string,
    type: row[2] as string,
    statement: row[3] as string,
    durable: row[4] as number,
    promoted: row[5] as number,
    created_at: row[6] as string,
    user_id: (row[7] as string | null) ?? null,
  }
}

const CANDIDATE_COLS = 'id, conversation_id, type, statement, durable, promoted, created_at, user_id'

export function getUnpromotedCandidates(userId?: string): Candidate[] {
  const db = getMemoryDb()
  const result = userId
    ? db.exec(
        `SELECT ${CANDIDATE_COLS} FROM memory_candidates WHERE promoted = 0 AND user_id = ? ORDER BY created_at ASC`,
        [userId]
      )
    : db.exec(
        `SELECT ${CANDIDATE_COLS} FROM memory_candidates WHERE promoted = 0 ORDER BY created_at ASC`
      )
  if (!result[0]) return []
  return result[0].values.map(rowToCandidate)
}

export function markCandidatePromoted(id: string): void {
  const db = getMemoryDb()
  db.run(`UPDATE memory_candidates SET promoted = 1 WHERE id = ?`, [id])
  markMemoryDirty()
}

// --- Rule ---

export interface CreateRuleInput {
  kind: 'user_preference_rule' | 'project_rule' | 'stable_fact'
  rule: string
  promotion_reason: 'cross_session' | 'failure_evidence' | 'explicit'
  supporting_conversations: string[]
  user_id?: string | null
}

export function createRule(input: CreateRuleInput): { id: string } {
  const db = getMemoryDb()
  const now = new Date().toISOString()

  // Compute next rule number
  const countResult = db.exec(`SELECT COUNT(*) FROM memory_rules`)
  const nextNum = (countResult[0]?.values[0]?.[0] as number ?? 0) + 1
  const id = `rule_${nextNum}`

  db.run(
    `INSERT INTO memory_rules (id, kind, rule, promotion_reason, supporting_conversations, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.rule, input.promotion_reason, JSON.stringify(input.supporting_conversations), now, now, input.user_id ?? null]
  )
  markMemoryDirty()
  return { id }
}

export interface Rule {
  id: string
  kind: string
  rule: string
  promotion_reason: string
  supporting_conversations: string[]
  created_at: string
  updated_at: string
  user_id: string | null
}

function rowToRule(row: unknown[]): Rule {
  return {
    id: row[0] as string,
    kind: row[1] as string,
    rule: row[2] as string,
    promotion_reason: row[3] as string,
    supporting_conversations: JSON.parse(row[4] as string),
    created_at: row[5] as string,
    updated_at: row[6] as string,
    user_id: (row[7] as string | null) ?? null,
  }
}

const RULE_COLS = 'id, kind, rule, promotion_reason, supporting_conversations, created_at, updated_at, user_id'

export function getAllRules(userId?: string): Rule[] {
  const db = getMemoryDb()
  const result = userId
    ? db.exec(`SELECT ${RULE_COLS} FROM memory_rules WHERE user_id = ? ORDER BY created_at ASC`, [userId])
    : db.exec(`SELECT ${RULE_COLS} FROM memory_rules ORDER BY created_at ASC`)
  if (!result[0]) return []
  return result[0].values.map(rowToRule)
}

// --- 用户隔离：回填老数据的 user_id ---

/**
 * 回填 user_id 为 NULL 的记录。lookupUserId 回调把 conversation_id 映射到 userId
 * （由调用方基于 agent.db 的 conversations 表提供）。rules 没有 conversation_id，
 * 通过 supporting_conversations 的第一个 conversation_id 关联。
 * 回填不了的记录（conversation 已删除 / supporting_conversations 为空）保持 NULL，
 * 按 userId 过滤查询时不会返回，避免跨用户污染。
 */
export function backfillMemoryUserIds(
  lookupUserId: (conversationId: string) => string | null
): { episodes: number; candidates: number; rules: number } {
  const db = getMemoryDb()
  let episodes = 0
  let candidates = 0
  let rules = 0

  const eps = db.exec(`SELECT id, conversation_id FROM memory_episodes WHERE user_id IS NULL`)
  if (eps[0]) {
    for (const row of eps[0].values) {
      const uid = lookupUserId(row[1] as string)
      if (uid) {
        db.run(`UPDATE memory_episodes SET user_id = ? WHERE id = ?`, [uid, row[0]])
        episodes++
      }
    }
  }

  const cands = db.exec(`SELECT id, conversation_id FROM memory_candidates WHERE user_id IS NULL`)
  if (cands[0]) {
    for (const row of cands[0].values) {
      const uid = lookupUserId(row[1] as string)
      if (uid) {
        db.run(`UPDATE memory_candidates SET user_id = ? WHERE id = ?`, [uid, row[0]])
        candidates++
      }
    }
  }

  const rls = db.exec(`SELECT id, supporting_conversations FROM memory_rules WHERE user_id IS NULL`)
  if (rls[0]) {
    for (const row of rls[0].values) {
      let convIds: string[] = []
      try {
        convIds = JSON.parse(row[1] as string) as string[]
      } catch {
        convIds = []
      }
      const uid = convIds[0] ? lookupUserId(convIds[0]) : null
      if (uid) {
        db.run(`UPDATE memory_rules SET user_id = ? WHERE id = ?`, [uid, row[0]])
        rules++
      }
    }
  }

  if (episodes + candidates + rules > 0) markMemoryDirty()
  return { episodes, candidates, rules }
}
