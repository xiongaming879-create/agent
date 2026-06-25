export interface Migration {
  version: number
  name: string
  up: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_conversations',
    up: `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      system_prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 2,
    name: 'create_messages',
    up: `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL DEFAULT '',
      thought_steps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
  },
  {
    version: 3,
    name: 'create_messages_indexes',
    up: `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
  },
  {
    version: 4,
    name: 'create_messages_parent_index',
    up: `CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)`,
  },
  {
    version: 5,
    name: 'create_users',
    up: `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      avatar TEXT NOT NULL DEFAULT '👤',
      theme TEXT NOT NULL DEFAULT 'auto' CHECK(theme IN ('light', 'dark', 'auto')),
      font_size INTEGER NOT NULL DEFAULT 14,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 6,
    name: 'add_conversation_user_id',
    up: `ALTER TABLE conversations ADD COLUMN user_id TEXT`,
  },
  {
    version: 7,
    name: 'add_conversation_user_index',
    up: `CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id)`,
  },
  {
    version: 8,
    name: 'add_conversation_is_pinned',
    up: `ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT 0`,
  },
]
