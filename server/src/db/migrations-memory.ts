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
]
