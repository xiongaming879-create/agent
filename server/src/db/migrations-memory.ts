export const memoryMigrations: string[] = [
  `CREATE TABLE IF NOT EXISTS memory_episodes (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    candidate_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_candidates (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('user_preference', 'fact', 'lesson')),
    statement TEXT NOT NULL,
    durable INTEGER DEFAULT 0,
    promoted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_rules (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('user_preference_rule', 'project_rule', 'stable_fact')),
    rule TEXT NOT NULL,
    promotion_reason TEXT NOT NULL CHECK(promotion_reason IN ('cross_session', 'failure_evidence', 'explicit')),
    supporting_conversations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // 用户隔离：三张表补 user_id 列。老库 ALTER 增列；新库 CREATE 后再 ALTER 会报
  // "duplicate column name"，由 runMigrations 的 try-catch 安全忽略。遵守"禁止 DROP"原则。
  `ALTER TABLE memory_episodes ADD COLUMN user_id TEXT`,
  `ALTER TABLE memory_candidates ADD COLUMN user_id TEXT`,
  `ALTER TABLE memory_rules ADD COLUMN user_id TEXT`,
]
