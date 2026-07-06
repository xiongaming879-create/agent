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
    db.run(sql)
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
}

export function createEpisode(input: CreateEpisodeInput): { id: string } {
  const db = getMemoryDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO memory_episodes (id, conversation_id, summary, candidate_count, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, input.conversation_id, input.summary, input.candidate_count ?? 0, now]
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
    `INSERT INTO memory_candidates (id, conversation_id, type, statement, durable, promoted, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [id, input.conversation_id, input.type, input.statement, input.durable ?? 0, now]
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
  }
}

const CANDIDATE_COLS = 'id, conversation_id, type, statement, durable, promoted, created_at'

export function getUnpromotedCandidates(): Candidate[] {
  const db = getMemoryDb()
  const result = db.exec(
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
}

export function createRule(input: CreateRuleInput): { id: string } {
  const db = getMemoryDb()
  const now = new Date().toISOString()

  // Compute next rule number
  const countResult = db.exec(`SELECT COUNT(*) FROM memory_rules`)
  const nextNum = (countResult[0]?.values[0]?.[0] as number ?? 0) + 1
  const id = `rule_${nextNum}`

  db.run(
    `INSERT INTO memory_rules (id, kind, rule, promotion_reason, supporting_conversations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.rule, input.promotion_reason, JSON.stringify(input.supporting_conversations), now, now]
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
  }
}

const RULE_COLS = 'id, kind, rule, promotion_reason, supporting_conversations, created_at, updated_at'

export function getAllRules(): Rule[] {
  const db = getMemoryDb()
  const result = db.exec(`SELECT ${RULE_COLS} FROM memory_rules ORDER BY created_at ASC`)
  if (!result[0]) return []
  return result[0].values.map(rowToRule)
}
