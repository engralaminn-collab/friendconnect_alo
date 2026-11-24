/**
 * Additive migrations for the SQLite fallback runtime.
 *
 * `src/lib/sqlite-ddl.cjs` is generated from the Prisma schema and uses
 * `CREATE TABLE IF NOT EXISTS`, which brings a *new* database up to date but
 * never adds a column to an *existing* one. Databases created by older releases
 * therefore need an explicit, ordered upgrade path.
 *
 * Rules for every entry here:
 *   - additive only: CREATE TABLE / ADD COLUMN / CREATE INDEX
 *   - never destructive: no DROP, no data rewrite, no type change
 *   - idempotent: safe to run on every boot, and safe to re-run after a crash
 *   - every statement is covered by a test (tests/security/db-migrations.test.ts)
 *
 * The migration list is versioned by `PRAGMA user_version` so a fresh database
 * short-circuits and an upgraded one never repeats work.
 */

'use strict'

/** Bump when adding entries. Recorded in `PRAGMA user_version`. */
const SCHEMA_VERSION = 3

/**
 * Each migration: { version, description, statements: [string] }.
 * Statements are executed in order inside a single transaction per version.
 */
const MIGRATIONS = [
  {
    version: 1,
    description:
      'Baseline columns added after the original release: Session.token became ' +
      'the revocation authority, and Message/Call/Friendship/Story gained the ' +
      'fields the round-2..8 features write.',
    statements: [
      // Session: `token` is NOT NULL in current schemas. It is added nullable so
      // that existing rows survive; `src/lib/session.ts` ignores rows with a
      // NULL token and they age out via expiresAt.
      'ALTER TABLE "Session" ADD COLUMN token TEXT',
      'ALTER TABLE "Session" ADD COLUMN sessionToken TEXT',
      'ALTER TABLE "Call" ADD COLUMN answeredAt TEXT',
      'ALTER TABLE "Call" ADD COLUMN failureReason TEXT',
      'ALTER TABLE "Call" ADD COLUMN connectionType TEXT',
      'ALTER TABLE "Friendship" ADD COLUMN blockerId TEXT',
      'ALTER TABLE "Friendship" ADD COLUMN isCloseFriend INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE "Friendship" ADD COLUMN storiesMuted INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE "Message" ADD COLUMN edited INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE "Message" ADD COLUMN editedAt TEXT',
      'ALTER TABLE "Message" ADD COLUMN pinnedBy TEXT',
      'ALTER TABLE "Message" ADD COLUMN replyToId TEXT',
      'ALTER TABLE "Message" ADD COLUMN scheduledFor TEXT',
      'ALTER TABLE "Message" ADD COLUMN metadata TEXT',
      'ALTER TABLE "Message" ADD COLUMN conversationId TEXT',
      'ALTER TABLE "ChatPreference" ADD COLUMN folder TEXT',
      'ALTER TABLE "Story" ADD COLUMN isHighlight INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE "User" ADD COLUMN bio TEXT',
      'ALTER TABLE "User" ADD COLUMN status TEXT DEFAULT \'\'',
      'ALTER TABLE "User" ADD COLUMN avatarUrl TEXT',
      'ALTER TABLE "User" ADD COLUMN lastSeenAt TEXT',
      // Rows created before the column existed have NULL here, and every
      // presence read calls .getTime() on it.
      'UPDATE "User" SET lastSeenAt = COALESCE(createdAt, datetime(\'now\')) WHERE lastSeenAt IS NULL',
      'ALTER TABLE "User" ADD COLUMN publicKey TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")',
      // Older rows were created with only one of the two token columns filled.
      // Mirror whichever one exists so the UNIQUE index above is satisfiable and
      // the realtime server can authenticate the session.
      'UPDATE "Session" SET token = sessionToken WHERE token IS NULL AND sessionToken IS NOT NULL',
      'UPDATE "Session" SET sessionToken = token WHERE sessionToken IS NULL AND token IS NOT NULL',
    ],
  },
  {
    version: 2,
    description:
      'File download authorization moved from a Message-table scan to explicit ' +
      'grants (finding #10). Adds FileAccess and an indexed File.url lookups, ' +
      'and backfills grants for attachments that already exist.',
    statements: [
      'CREATE TABLE IF NOT EXISTS "FileAccess" (' +
        'id TEXT PRIMARY KEY, fileUrl TEXT NOT NULL, userId TEXT NOT NULL, source TEXT NOT NULL, ' +
        'messageId TEXT, createdAt TEXT NOT NULL, expiresAt TEXT, ' +
        'UNIQUE (fileUrl, userId), ' +
        'FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE, ' +
        'FOREIGN KEY (messageId) REFERENCES "Message"(id) ON DELETE CASCADE)',
      'CREATE INDEX IF NOT EXISTS "FileAccess_fileUrl_idx" ON "FileAccess"(fileUrl)',
      'CREATE INDEX IF NOT EXISTS "FileAccess_userId_idx" ON "FileAccess"(userId)',
      'CREATE INDEX IF NOT EXISTS "FileAccess_messageId_idx" ON "FileAccess"(messageId)',
      'CREATE INDEX IF NOT EXISTS "File_url_idx" ON "File"(url)',
      'CREATE INDEX IF NOT EXISTS "Message_fileUrl_idx" ON "Message"(fileUrl)',
      // Backfill: owner grant for every stored file.
      'INSERT OR IGNORE INTO "FileAccess" (id, fileUrl, userId, source, createdAt) ' +
        "SELECT 'fa-' || lower(hex(randomblob(8))), url, ownerId, 'owner', datetime('now') " +
        'FROM "File" WHERE url IS NOT NULL',
      // Backfill: both direct-message participants can read the file.
      'INSERT OR IGNORE INTO "FileAccess" (id, fileUrl, userId, source, messageId, createdAt) ' +
        "SELECT 'fa-' || lower(hex(randomblob(8))), fileUrl, receiverId, 'message_recipient', id, datetime('now') " +
        'FROM "Message" WHERE fileUrl IS NOT NULL AND receiverId IS NOT NULL',
      'INSERT OR IGNORE INTO "FileAccess" (id, fileUrl, userId, source, messageId, createdAt) ' +
        "SELECT 'fa-' || lower(hex(randomblob(8))), fileUrl, senderId, 'message_sender', id, datetime('now') " +
        'FROM "Message" WHERE fileUrl IS NOT NULL',
      // Backfill: current group members can read files shared in that group.
      'INSERT OR IGNORE INTO "FileAccess" (id, fileUrl, userId, source, messageId, createdAt) ' +
        "SELECT 'fa-' || lower(hex(randomblob(8))), m.fileUrl, gm.userId, 'group_member', m.id, datetime('now') " +
        'FROM "Message" m JOIN "GroupMember" gm ON gm.groupId = m.groupId ' +
        'WHERE m.fileUrl IS NOT NULL AND m.groupId IS NOT NULL',
    ],
  },
  {
    version: 3,
    description:
      'File gained optional `filename`/`thumbUrl` so upload routes that only ' +
      'supply name+url can persist, and File.url became the lookup key for ' +
      'download authorization.',
    statements: [
      'ALTER TABLE "File" ADD COLUMN filename TEXT',
      'ALTER TABLE "File" ADD COLUMN thumbUrl TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS "File_url_key" ON "File"(url)',
      'UPDATE "File" SET filename = name WHERE filename IS NULL',
    ],
  },
]

/**
 * Apply pending migrations.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ log?: (msg: string) => void }} [options]
 * @returns {{ from: number, to: number, applied: number[] }}
 */
function runAdditiveMigrations(db, options = {}) {
  const log = options.log || (() => {})
  const current = Number(db.pragma('user_version', { simple: true }) || 0)
  const applied = []

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue

    const apply = db.transaction(() => {
      for (const statement of migration.statements) {
        try {
          db.exec(statement)
        } catch (error) {
          // ADD COLUMN on a column that already exists is the expected no-op
          // when a table was created by a newer DDL than the migration expects.
          if (/duplicate column name/i.test(error.message)) continue
          // CREATE INDEX/INSERT against a table that does not exist yet is not
          // a reason to abort: the table is created by INIT_SQL before we run.
          if (/no such table/i.test(error.message)) continue
          throw error
        }
      }
      db.pragma(`user_version = ${migration.version}`)
    })

    apply()
    applied.push(migration.version)
    log(`[db] applied migration ${migration.version}: ${migration.description}`)
  }

  return { from: current, to: SCHEMA_VERSION, applied }
}

/**
 * Verify that the live database actually has every column the generated schema
 * expects. Returns the list of `Table.column` pairs that are missing.
 *
 * This exists because `ALTER TABLE ... ADD COLUMN` is silently skipped by the
 * migration runner when a table is absent, which previously let
 * `PRAGMA user_version` advance while the schema stayed incomplete — the same
 * failure mode as the old best-effort `ensureColumns`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, { table: string, columns: string[] }>} expected
 * @returns {string[]}
 */
function findMissingColumns(db, expected) {
  const missing = []
  for (const model of Object.values(expected)) {
    let actual
    try {
      actual = db.prepare(`PRAGMA table_info("${model.table}")`).all().map((c) => c.name)
    } catch {
      missing.push(`${model.table} (table)`)
      continue
    }
    if (!actual.length) {
      missing.push(`${model.table} (table)`)
      continue
    }
    for (const column of model.columns) {
      if (!actual.includes(column)) missing.push(`${model.table}.${column}`)
    }
  }
  return missing
}

module.exports = { runAdditiveMigrations, findMissingColumns, MIGRATIONS, SCHEMA_VERSION }
