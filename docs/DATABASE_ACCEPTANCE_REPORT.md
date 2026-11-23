# Database Acceptance Report

**Verified:** 2026-11-23 · branch `arena/4f5b1aba-friendconnect-alo`

## Status by engine

| Engine | Status | What was actually executed |
|---|---|---|
| SQLite (`src/lib/db-runtime.js`, better-sqlite3) | **PASS (runtime), PARTIAL (migrations)** | Server started, schema auto-created, 33 tables, CRUD across users/sessions/groups/messages/posts verified over HTTP |
| MySQL 8 + Prisma Client | **BLOCKED** | `prisma generate` and `prisma validate` both fail: `binaries.prisma.sh` is unreachable from the sandbox. The MySQL path was **never executed**. |
| Migration history | **FAIL** | See below. |

> Do not read "database acceptance" as "MySQL accepted". MySQL was not testable here.

## Migration history does not reproduce the schema

Measured by comparing `CREATE TABLE` statements in `prisma/migrations/20260807120000_init/migration.sql`
against the `model` declarations in each schema:

| Schema | Models declared | Missing from init migration |
|---|---|---|
| `prisma/schema.mysql.prisma` | 28 | 5 (`JaraConfig`, `JaraProposal`, `JaraAuditLog`, `JaraMemory`, `JaraGroupConsent`) |
| `prisma/schema.prisma` | 40 | 17 (`Post`, `Poll`, `Conversation`, `ConversationMember`, `Block`, `Report`, `Attachment`, `FriendRequest`, `VerificationToken`, 5 × `Jara*`) |

`scripts/deploy.sh` runs `prisma migrate deploy`, which only replays existing files — so a **fresh**
MySQL database will be missing 17 tables that the application queries, and `migrate deploy` will
report success while doing so. `migration_lock.toml` also declares `provider = "mysql"` while
`prisma/schema.prisma` (the file `deploy.sh` passes to Prisma for MySQL) declares `provider = "sqlite"`.

**Consequence:** deploying to an existing MySQL database whose tables were created some other way
will appear to work; a greenfield MySQL deploy will not.

**Fix required before any MySQL deploy:** pick one canonical schema, regenerate the migration
history from it (`prisma migrate diff --from-empty --to-schema-datamodel … --script`), and add a CI
check so drift cannot reappear. This is deliberately **not** done blind here, because rewriting
migration history on a database that already contains production data is destructive if done wrong.

## Schema drift found and fixed (SQLite runtime)

`src/lib/db-runtime.js` created `Session` **without** `sessionToken`, while `schema.prisma` and
`src/lib/session.ts` both write it. The insert threw, and an empty `catch` swallowed the error, so
every UI login silently failed to create a session — which is why realtime auth never worked.

Fixed additively via `ensureColumns()` (`ALTER TABLE "Session" ADD COLUMN sessionToken TEXT`),
which is nullable and therefore safe for existing rows. `session.create` now writes only the
canonical `token` column.

## Backup / restore

`scripts/backup.sh` and `scripts/restore.sh` exist; neither was executed (no production host).
`docs/DEPLOYMENT_AND_RECOVERY.md` requires a backup and an integrity check before any production
migration — that requirement is unchanged and still unmet for production.
