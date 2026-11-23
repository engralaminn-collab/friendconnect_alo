# Database Acceptance Report

**Verified:** 2026-11-23 · branch `arena/4f5b1aba-friendconnect-alo` · commit `47ebb45`

## Status by engine

| Engine | Status | What was actually executed |
|---|---|---|
| SQLite (`src/lib/db-runtime.js`) | **PASS** | 40 tables created; CRUD verified over HTTP for users, sessions, conversations, conversation members, messages, stars, polls, votes, reports, posts, blocks |
| Migration SQL (new files) | **PASS (parse/execute)** | All three new migrations executed against a SQLite engine after mechanical MySQL→SQLite translation; produced all expected tables. **Not** a MySQL execution. |
| MySQL 8 + Prisma Client | **BLOCKED** | No `mysql`/`mysqld` binary, no Docker, and `prisma generate` cannot reach `binaries.prisma.sh`. Never executed. |
| Prisma `migrate deploy` end-to-end | **BLOCKED** | Requires the Prisma engine binary (same blocker) |

> MySQL acceptance is **BLOCKED**, not PASS. Nothing here was run against a real
> MySQL server.

## Reconciliation result (before → after)

The original report said "17 tables missing". The real state was worse: **four** sources
of truth disagreed.

| Source | Models/tables before | After |
|---|---|---|
| `prisma/schema.prisma` | 40 | 40 |
| `prisma/schema.mysql.prisma` | 28 | **40** |
| `src/lib/db-runtime.js` (SQLite runtime) | 33 | **40** |
| Tables created by migrations | 23 | **40** |

**Final:** 40 models → 40 tables, zero missing, verified by script.

### Runtime breakage this caused (reproduced)

Seven models the API calls were absent from the SQLite runtime entirely, so every
route touching them threw `TypeError: Cannot read properties of undefined (reading 'findMany')`:

| Route | Before | After |
|---|---|---|
| `GET /api/conversations` | 500 | 200 |
| `GET /api/reports` | 500 | 200 |
| `POST /api/messages/[id]/star` | 500 | 200 |
| `GET /api/messages/starred` | 500 | 200 |

`conversationMember` alone appears at 11 call sites — it is the membership check that
guards direct-message access in `/api/conversations/[id]/messages`. Ten further models
(`Block`, `FriendRequest`, `Post`, `PostComment`, `PostReaction`, `Poll`, `PollVote`,
`Report`, `Conversation`, `ConversationMember`) were missing from `schema.mysql.prisma`
altogether, so a MySQL deployment would have failed at **runtime**, not at migrate time —
`prisma migrate deploy` would have reported success.

### Duplicate table fixed

`messages/[id]/star` wrote to `db.starredMessage` while `messages/starred` read
`db.messageStar`, so a starred message was permanently invisible. Canonicalised on
`MessageStar` (the table the init migration already creates) and fixed the writer.
Verified: add → visible → remove → gone.

## New migrations

Forward-only and additive (`CREATE TABLE IF NOT EXISTS` only; no `ALTER`, `DROP`,
`RENAME`, or `DELETE`; no backfill; all FK targets pre-exist):

| Migration | Adds |
|---|---|
| `20261123000000_add_jara_governance_tables` | `JaraConfig`, `JaraProposal`, `JaraAuditLog`, `JaraMemory`, `JaraGroupConsent` |
| `20261123000100_add_social_conversation_tables` | `Block`, `FriendRequest`, `Post`, `PostComment`, `PostReaction`, `Report`, `Conversation`, `ConversationMember`, `Poll`, `PollVote` |
| `20261123000200_add_attachment_verificationtoken` | `Attachment`, `VerificationToken` |

Each file documents its own rollback (`DROP TABLE`) inline, commented out.

## Also fixed: deploy.sh used the wrong schema

`scripts/deploy.sh` ran `prisma generate` / `prisma migrate deploy` against
`prisma/schema.prisma`, which declares `provider = "sqlite"`. `production-install.sh`
copies `schema.mysql.prisma` over it first; `deploy.sh` did not. Fixed — it now performs
the same swap (backing up the previous file) so MySQL deploys migrate from the MySQL schema.

## Still required before MySQL can be called accepted

1. A real MySQL 8 instance (see `docs/DEPLOY_PANEL_ALOLABS.md`).
2. `npx prisma generate` with network access to `binaries.prisma.sh`.
3. `npx prisma migrate deploy` against a **disposable** database first.
4. `npx prisma migrate diff --from-migrations --to-schema-datamodel` → expect no drift.
5. Run `scripts/security-regression.cjs` against the MySQL-backed instance.
6. Only then run it against production, after `scripts/backup.sh` and a verified restore.

Do **not** use `prisma db push` for this; it bypasses migration history.
