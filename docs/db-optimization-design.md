# 数据库层优化设计文档

## 1. 现状问题

### 1.1 核心问题：SELECT * + 位置映射导致字段错位

**已发生的故障**：`conversations` 表通过 `ALTER TABLE ADD COLUMN` 追加 `user_id`，SQLite 将其排在最后一列，但 `SELECT *` + `row[3]` 映射为 `user_id`，实际 `row[3]` 是 `created_at`，导致三字段错位，引发 403。

**当前状态**：`db/index.ts` 已修复为显式列名（`CONV_COLS`/`MSG_COLS`），但 `db/user.ts` **仍在用 `SELECT *`**，存在同样的隐患。

### 1.2 迁移系统无版本控制

```ts
// 当前：线性数组 + catch 吞错
for (const sql of migrations) {
  try { _db.run(sql) } catch { /* 静默忽略所有错误 */ }
}
```

问题：
- **无版本追踪**：不知道哪些迁移已执行，每次启动都重跑全部
- **catch 吞掉所有错误**：不仅跳过 `ALTER TABLE` 的"列已存在"，也跳过真正的 SQL 错误
- **无法回滚**：只有 up 没有 down，出了问题只能手动修库
- **新增迁移时风险高**：每次加迁移都要保证对所有已有数据库状态幂等

### 1.3 user.ts 查询仍用 SELECT *

```ts
// db/user.ts — 所有函数都用 SELECT *
const result = db.exec(`SELECT * FROM users WHERE username = ?`, [username])
```

`rowToUser` 通过跳过 `row[2]`（password_hash）来映射，如果 users 表未来加列，同样的错位问题会重演。

### 1.4 日期生成不一致

| 场景 | 方式 |
|------|------|
| INSERT 的 `created_at` | JS: `new Date().toISOString()` |
| UPDATE 的 `updated_at` | SQL: `datetime('now')` |
| 表定义 DEFAULT | SQL: `datetime('now')` |

两种时间源可能有时区/精度差异。

### 1.5 其他问题

| 问题 | 严重性 | 说明 |
|------|--------|------|
| `seedAdmin` 硬编码用户名 | 中 | 写死了 `xwx1151365`，不够通用 |
| `deleteConversation` 冗余删除 | 低 | FK CASCADE 已处理，手动先删 messages 是多余的 |
| 无事务包装 | 低 | sql.js 单连接下问题不大，但多写操作间无原子性保证 |
| `updated_at` 用 SQL 函数 | 低 | `datetime('now')` 返回 UTC 无时区无毫秒，与 JS ISO 格式不一致 |

## 2. 优化方案

### 2.1 统一显式列名查询（user.ts 修复）

**原则**：所有 `SELECT *` 改为显式列名，与 `db/index.ts` 保持一致。

```ts
// 修复前
const result = db.exec(`SELECT * FROM users WHERE username = ?`, [username])

// 修复后
const USER_COLS = 'id, username, role, avatar, theme, font_size, created_at, updated_at'
const USER_ROW_COLS = 'id, username, password_hash, role, avatar, theme, font_size, created_at, updated_at'

const result = db.exec(`SELECT ${USER_ROW_COLS} FROM users WHERE username = ?`, [username])
```

`rowToUser` 和 `rowToUserRow` 各自用对应的列常量，索引与列顺序严格对应。

### 2.2 迁移版本控制

**方案**：新增 `schema_version` 表追踪已执行的迁移。

```ts
// migrations.ts 改造
export interface Migration {
  version: number
  name: string
  up: string
}

export const migrations: Migration[] = [
  { version: 1, name: 'create_conversations', up: `CREATE TABLE IF NOT EXISTS conversations (...)` },
  { version: 2, name: 'create_messages', up: `CREATE TABLE IF NOT EXISTS messages (...)` },
  { version: 3, name: 'create_messages_indexes', up: `CREATE INDEX IF NOT EXISTS ...` },
  { version: 4, name: 'create_users', up: `CREATE TABLE IF NOT EXISTS users (...)` },
  { version: 5, name: 'add_conversation_user_id', up: `ALTER TABLE conversations ADD COLUMN user_id TEXT` },
  { version: 6, name: 'add_conversation_user_index', up: `CREATE INDEX IF NOT EXISTS ...` },
]
```

```ts
// index.ts — initDb 中的迁移执行
function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
  const applied = new Set(
    db.exec('SELECT version FROM schema_version')[0]?.values.map(r => r[0] as number) ?? []
  )
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    db.run(m.up)
    db.run('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()])
  }
  markDirty()
}
```

优势：
- **只执行新迁移**：已执行过的跳过
- **精确报错**：不再 catch 吞错，迁移失败直接抛出
- **可追溯**：`schema_version` 表记录了每个迁移的执行时间和名称
- **可扩展**：新增迁移只需在数组末尾追加，加版本号即可

### 2.3 日期统一为 JS 生成

所有 `created_at`/`updated_at` 统一用 JS `new Date().toISOString()` 生成，不再用 SQL `datetime('now')`。

```ts
// 修复前
sets.push("updated_at = datetime('now')")

// 修复后
const now = new Date().toISOString()
sets.push('updated_at = ?')
values.push(now)
```

理由：
- 格式一致（都是 ISO 8601 带毫秒和 Z 后缀）
- 时区一致（都是 UTC）
- 便于测试（可 mock `Date`）

### 2.4 清理冗余代码

- `seedAdmin` 硬编码用户名 → 改为从环境变量 `ADMIN_USERNAME` 读取（默认 `admin`）
- `seedAdmin` 密码 → 改为从环境变量 `ADMIN_PASSWORD` 读取（默认 `Xiongam-1314`）
- `deleteConversation` 保留手动删除 messages → sql.js 的 FK CASCADE 在某些场景（如 DB 重新加载后）不可靠，显式删除更稳妥

## 3. 可扩展性设计

### 3.1 新增字段的流程（优化后）

1. 在 `migrations.ts` 末尾追加新的 `Migration` 对象（版本号递增）
2. 更新对应的 `XX_COLS` 常量（如 `CONV_COLS`），在末尾追加列名
3. 更新 `rowToXxx` 映射函数，在末尾追加字段
4. 更新 `types.ts` 的接口定义

**不再有的风险**：新增列在 `XX_COLS` 末尾，`rowToXxx` 也在末尾追加，不会影响已有字段的索引位置。

### 3.2 未来可能的扩展场景

| 场景 | 新增表/字段 | 迁移方式 |
|------|------------|---------|
| 对话标签/分类 | `conversations.tags` (JSON) | ADD COLUMN + CONV_COLS 追加 |
| 消息收藏/点赞 | `messages.starred` (BOOL) | ADD COLUMN + MSG_COLS 追加 |
| 多模型支持 | `conversations.model` (TEXT) | ADD COLUMN + CONV_COLS 追加 |
| 对话分享 | 新表 `shared_links` | 新 Migration + 新 CRUD 函数 |
| 文件附件 | 新表 `attachments` + `messages.attachments` | 新 Migration + MSG_COLS 追加 |
| 操作审计 | 新表 `audit_logs` | 新 Migration |

**原则**：新增字段只在 `XX_COLS` 末尾追加，新增表用新 Migration，新增表用新的 `TABLE_COLS` 常量和 `rowToXxx` 函数。

### 3.3 是否需要 ORM？

当前项目规模（3 表、~15 个 CRUD 函数）不需要 ORM。手动 SQL + 映射函数在可控性和透明度上更优。如果未来表超过 10 个或关系复杂度上升，可考虑：

- **轻量方案**：抽象 `createRepository<T>(table, cols, mapper)` 泛型工厂函数
- **中量方案**：引入 Drizzle ORM（TypeScript-first，类型安全，不隐藏 SQL）
- **重量方案**：Prisma（功能全但引入构建步骤，与 sql.js WASM 兼容性需验证）

当前阶段建议保持手动方式，仅做映射函数的泛型化提取。

## 4. 修改文件清单

| 文件 | 变更 |
|------|------|
| `server/src/db/migrations.ts` | 引入 `Migration` 接口，为每条迁移加版本号和名称 |
| `server/src/db/index.ts` | 迁移执行逻辑改为版本控制；`updated_at` 改 JS 生成；新增 `resetDb()` 供测试使用 |
| `server/src/db/user.ts` | `SELECT *` 改显式列名；`updated_at` 改 JS 生成；`seedAdmin` 用户名/密码改环境变量 |
| `test/server/db/database.test.ts` | 新增迁移版本控制相关测试 |
| `test/server/db/database.md` | 更新文档 |

## 5. 验证方式

1. `npx vitest run` 全量测试通过
2. 启动后端，检查 `schema_version` 表是否正确记录迁移
3. 重启后端，确认已执行的迁移不会被重复执行
4. 创建对话/消息/用户，验证字段值正确（无错位）
5. 更新对话标题，验证 `updated_at` 格式为 ISO（非 SQL datetime 格式）
