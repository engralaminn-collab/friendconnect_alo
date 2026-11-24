# Remediation report

**Date:** 2026-11-24
**Branch:** `arena/55e91fac-friendconnect-alo`
**Scope:** the 17 findings raised in review, plus the defects that surfaced while
fixing and testing them.
**Companion documents:** [`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the
system works now; [`TESTING.md`](TESTING.md) says exactly what is and is not
verified. Historical audits are in [`archive/`](archive/README.md) and describe
earlier states — do not read them as current behaviour.

## Status at a glance

| # | Finding | Status | Primary evidence |
|---|---|---|---|
| 1 | Friend-request contract (request → accept → friendship) | Fixed | `friends.test.cjs`, `authz-drift.test.cjs` |
| 2 | SQLite runtime returned DateTime columns as strings | Fixed | `db-runtime.test.cjs` (Date/Boolean coercion) |
| 3 | Message send bypassed block/permission; attachment ownership | Fixed | `socket-security` unit matrix + `session-api` integration |
| 4 | Reactions not restricted to participants | Fixed | `messages/[id]/reactions` uses `isMessageParticipant`; `authz-drift` |
| 5 | OTP / password-reset weaknesses (plaintext, no throttle) | Fixed | migrations v4; `one-time-code.ts`; unit tests |
| 6 | 2FA could not be disabled, secret leaked, backup codes unusable | Fixed | migration v5; `two-factor.ts`; login tests |
| 7 | Polls: no transaction, raw `groupBy`, no authorization | Fixed | `polls.test.cjs` (new) |
| 8 | Silent fallback between database engines | Fixed | `db-backend.ts`, boot throw; documented in ARCHITECTURE |
| 9 | Three divergent schemas maintained by hand | Fixed | `npm run schema:check` (5 stages); generators + drift check |
| 10 | File download authorization scanned 100 message rows | Fixed | `file-access.cjs` grant table; `file-access.test.ts` |
| 11 | Redis failure made rate limiting fail open silently | Fixed | `redis-failure.test.cjs`; `ResilientCache` |
| 12 | Hard-coded deploy paths, Bun lockfile + `package-lock.json` | Fixed | `scripts/deploy.sh`, `scripts/lib/db-url-env.mjs`, single lockfile |
| 13 | Playwright config/spec that never ran | Fixed (CI-only verification) | `playwright.config.ts`, `e2e/serve.cjs`, `tests/e2e/02-chat.spec.ts`, CI step |
| 14 | No route-level authorization tests | Fixed | `authz-drift.test.cjs`, `db-runtime.test.cjs`, `polls.test.cjs` |
| 15 | Error messages echoed internals to clients | Fixed | `handleRouteError`; assertions in `polls.test.cjs` |
| 16 | Repository hygiene (tracked uploads, dual lockfiles, stray dirs) | Fixed | `.gitignore`, history preserved under `docs/archive/` |
| 17 | Referenced documentation did not exist | Fixed | this file, `TESTING.md`, `ARCHITECTURE.md` |

Detail per finding — what was actually wrong, what changed, and how it is
proven — follows.

## 1. Friend-request contract

`POST /api/friends` created a request and `POST /api/friends/accept` completed it,
but the read side and the messaging gate disagreed about what a relationship was.
Messaging looked for `Friendship.status === 'BLOCKED'`, a state the request flow
never wrote, and compared `receiverId` with itself, so a blocked user could still
post over REST what the socket refused.

- One relationship is now read through one primitive: `ACCEPTED` allows,
  `PENDING` does not, `BLOCKED` (or a `Block` row) always denies.
- The request/accept/decline/cancel cycle is exercised end to end.
- Tests: `tests/integration/friends.test.cjs`, `tests/integration/authz-drift.test.cjs`.

## 2. Database runtime type coercion

`src/lib/db-runtime.js` returned raw SQLite values, so every `DateTime` column
was a string. `GET /api/presence` called `.getTime()` on it and answered 500;
comparisons like `expiresAt > now` silently did the wrong thing.

- Columns declared `DateTime` decode to real `Date` objects (nullable stays
  `null`); `Boolean` decodes to `true`/`false`.
- Tests: `tests/integration/db-runtime.test.cjs` — every model, both directions of
  the round trip, plus `$transaction`, `groupBy`, `aggregate` and `include`.

## 3. Message send authorization and attachments

Two separate problems:

1. **Authorization drift.** REST and socket decided permission differently (see
   finding 1). Both now call `canInteract(store, from, to, 'messagePermission')`.
2. **Attachment ownership.** `fileUrl`/`fileName`/`fileSize`/`mimeType` were
   accepted from the client without checking that the referenced file belonged
   to the sender, so a message could attach someone else's upload ID. Both send
   paths now require a `File` row with `ownerId === senderId` and matching URL,
   and the download route separately re-authorizes the recipient.

- Tests: `socket-security.test.cjs` (permission matrix), `session-api.test.cjs`
  (a stranger gets 403 on a private file; a message recipient gets 200).

## 4. Reaction participation

`POST /api/messages/[id]/reactions` accepted any authenticated user, so anyone
holding a message ID could react to a private conversation. It now requires
`isMessageParticipant` (sender, recipient, or — for group messages — a current
group member) and the same check guards removal.

## 5. One-time codes and password reset

- Codes were stored in plaintext; now hashed with an attempt counter and a
  resend throttle (migration v4).
- The reset credential is an opaque digest, not a token that a log line or a
  database dump could replay.
- Attempt counters are bounded, so a code cannot be brute-forced at leisure, and
  responses never reveal whether an address exists.

## 6. Two-factor authentication

- The secret was returned to the client outside the enrolment flow.
- There was no way to disable 2FA at all, and `disable` did not verify a factor.
- Backup codes were generated as comma-joined strings of password hashes that
  nothing ever checked, so a lost device locked the account out permanently.

Now: the secret is only trusted after confirmation (`twoFactorConfirmedSecret`),
disable requires a valid factor, backup codes are single-use digests
(`twoFactorBackupUsed`) accepted by both the login route and the NextAuth
`authorize` path, and failed challenges are capped (`MAX_TOTP_ATTEMPTS`).

## 7. Polls

The poll endpoints were the least protected write paths in the app:

| Problem | Before | After |
|---|---|---|
| Authorization | any signed-in user could vote in any poll | participant of the poll's message only (DM sender/recipient, group member, conversation member) |
| Atomicity | `findUnique` then `create`/`update` raced the unique constraint → 500 on a double tap | single `upsert`; concurrent votes collapse to one row |
| Validation | `optionIdx` only had to be a number | in-range non-negative integer |
| Expiry | `expiresAt` stored, never enforced | closed polls reject votes, keep their tally |
| Creation | accepted arbitrary option arrays; message used `messageType`, a column that exists in **no** schema, so creation always 500ed | validated question/options/expiry; message+poll written in one transaction with `type: 'poll'` |
| Response | raw provider-shaped `groupBy` | dense `tally` array + `totalVotes` + `myVote`, plus a participant-only GET |

The `messageType` column is worth calling out: it is the same class of defect as
the `starredBy`/`reads` drift in finding 16, and it means poll creation could not
have worked on any schema. The new integration test would have caught it.

- Tests: `tests/integration/polls.test.cjs` (new, covers every row above).

## 8. Silent database fallback

`new PrismaClient()` was wrapped in a try/catch that quietly swapped in the
hand-written SQLite runtime on *any* throw. Two deployments with the same
configuration could therefore read different databases, which is the worst
possible failure mode for a product whose job is storing messages.

Selection is now explicit and logged once (`src/lib/db-backend.ts`):
`mysql://`/`mariadb://` → Prisma MySQL; `DB_ENGINE=prisma` → Prisma SQLite;
`file:` → built-in runtime; anything else **throws**. If the chosen backend
cannot initialise, the process fails. `DB_ALLOW_SQLITE_FALLBACK` re-enables a
*logged* fallback for local development only and is ignored in production.

## 9. Schema drift between three files

`prisma/schema.prisma`, `schema.sqlite.prisma` and `schema.mysql.prisma` were
maintained by hand and had diverged; a hand-maintained metadata file had also
silently lost relation information, which left the runtime unable to resolve
`include:` at all.

Now only `prisma/schema.prisma` is edited. Generators produce the provider
variants, the runtime metadata, the SQLite DDL and the MySQL migration, and
`npm run schema:check` fails the build (and the first stage of `deploy.sh`) if any
generated artefact is stale or inconsistent. Five stages, all passing:
variants, metadata (52 models / 114 relation fields), DDL, MySQL migration,
drift.

The codegen bug behind the lost relations is documented in ARCHITECTURE: a
`String.replace` splice that silently no-op'd when its anchor moved. It now
asserts the anchor and exits non-zero instead.

## 10. File download authorization

Authorization was decided by scanning up to 100 `Message` rows for the same
`fileUrl` on **every** download. That is an unindexed full-table filter on the
hottest table; it silently gave up after 100 matches, so a file shared in a busy
thread could become unreachable; and it had to be re-derived per request.

Downloads are now an indexed `FileAccess(fileUrl, userId)` lookup. Grants are
written when a file becomes reachable (upload, message send, forward, story post)
and removed when sharing stops. `backfillFileAccess()` plus migration v2 cover
data written before the table existed, and `npm run backfill:file-access` makes
the backfill runnable on demand.

`revokeMessageGrants()` withdraws only the grants a specific message created, so
deleting one message never breaks the same upload in another thread.

- Tests: `tests/security/file-access.test.ts` (12 cases: owner, participant,
  group fan-out, story audience incl. muted/blocked friends, profile visibility,
  expiry, idempotency, precise revocation, and parity between the `.cjs` core and
  the typed facade).

## 11. Redis failure behaviour

Cache and rate limiting silently failed open — and threw into request paths — when
Redis was configured but unreachable. Now `ResilientCache`
(`src/lib/cache.ts`) applies a 2 s operation timeout, logs the failure, and falls
back to the in-process cache and limiter; rate limiting still answers "allowed"
only from a limiter that actually ran. The trade-off is documented rather than
hidden: a multi-instance deployment must configure Redis, because per-process
limits are not global.

- Tests: `tests/security/redis-failure.test.cjs`.

## 12. Deploy paths and lockfiles

- `scripts/deploy.sh` no longer copies a schema over `schema.prisma`; it runs
  `schema:check`, generates against the selected variant, takes a gzip backup
  (`backups/pre-migrate-<stamp>.sql.gz`) **before** `prisma migrate deploy`, then
  builds, reloads PM2 and checks `/api/health` and the socket `/health`.
  Database credentials are derived from `DATABASE_URL` by
  `scripts/lib/db-url-env.mjs` instead of being hard-coded.
- `bun.lock` is gone; `package-lock.json` (v3) is the only lockfile and CI
  asserts it matches the pinned Next/React/Prisma/Socket.IO versions.

## 13. Playwright

The config pointed at a `webServer` that did not exist and the specs asserted
nothing meaningful, so E2E was never actually executed (finding #13 asked for
exactly that).

- `playwright.config.ts` starts the standalone build through `e2e/serve.cjs`,
  which allocates ports, a temp SQLite file, a temp `UPLOAD_DIR` and a
  non-production secret.
- `tests/e2e/02-chat.spec.ts` registers two users and exchanges a message through
  the real UI; `data-testid` hooks were added to `AuthScreen.tsx`, `Sidebar.tsx`,
  `ChatView.tsx` and `Composer.tsx` — the components `app/page.tsx` mounts. (An
  earlier attempt put the sign-in ids on `fc/auth/AuthFlow.tsx`, a component this
  app never renders, so no spec could get past login.)
- CI installs Chromium and runs the suite; the report is uploaded on failure.

The chat spec drives the flow the way a user does: log in through the sign-in
form, send the friend request through the UI's API, open the conversation from the
sidebar (falling back to the **New chat** dialog), type into the composer, and
assert the message is delivered, survives a reload and is readable through the REST
contract. The realtime socket is not asserted: proving arrival without a reload
needs the separate socket server and is flaky at one worker, so the suite asserts
the persisted message both sides read instead of claiming a realtime guarantee. Its first version
navigated to `/?view=chat&user=<id>`; the app has no URL routing, so that
navigation stayed on the welcome screen and the spec could never have passed. The
rewrite added the `new-chat` / `new-chat-friend` test hooks and removed the
assumption.

**Honest limit:** the browsers cannot be downloaded in this development
environment (`cdn.playwright.dev`, `playwright.azureedge.net`, Chrome-for-Testing
and puppeteer's host are all unreachable, and there is no system browser), so the
suite has **not** been executed locally. It runs in CI. Do not read this branch as
"E2E verified" without CI output.

## 14. Route-level authorization tests

New integration tests exercise the routes themselves, not just the helpers:

- `authz-drift.test.cjs` — static (routes must import the shared primitive) and
  behavioural (the primitive's answer per relationship state).
- `db-runtime.test.cjs` — the runtime contract every route depends on, including
  boot refusal on a half-migrated database.
- `polls.test.cjs` — a full authorization/validation matrix over HTTP.

`session-api.test.cjs` was extended so the direct-message fixtures actually accept
a friendship first, because messaging is gated by `canInteract` rather than by a
`BLOCKED` row.

## 15. Error output

`handleRouteError()` maps a `RouteError` to its status and everything else to a
generic `INTERNAL_ERROR` with a `requestId` that matches the server log. Driver
messages, SQL text, file paths and stack traces never reach the client. Tests
assert both that a 400 stays a 400 and that the body does not contain a source
path.

## 16. Repository hygiene

- Tracked uploads removed from the index; runtime output is ignored by
  `.gitignore`.
- `worklog.md` and the imported `arena-candidate/` tree were **moved, not
  deleted** — to `docs/archive/WORKLOG_HISTORY.md` and
  `docs/archive/arena-backend-candidate/` — after confirming nothing imports
  them. `docs/archive/README.md` explains why they are there.
- Dead code annotated rather than silently kept: `mentions.ts`, `profanity.ts`
  and `storage.ts` are not wired up, and `src/lib/prisma.ts` was removed in favour
  of the single `db` handle.
- Query drift removed: `starredBy` (a relation that does not exist) 500ed
  `GET /api/messages`; the `reads` selects referenced a `MessageRead` model that
  exists in no schema and is never written. Both are gone, with a comment
  explaining where read state actually lives.

## 17. Documentation

The archive index referenced three documents that did not exist. They now do:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — processes, request/authorization flow,
  the database layer and its guarantees, the schema pipeline, files, realtime,
  sessions, configuration and failure policy.
- [`TESTING.md`](TESTING.md) — every suite, what it proves, what it deliberately
  does not, the environment contract, and current results.
- this report.

The superseded audits (`AUDIT_INITIAL.md`, `AUDIT_FINAL.md`,
`IMPLEMENTATION_AUDIT.md`, `E2E_TEST_RESULTS.md`, `DATABASE_ACCEPTANCE_REPORT.md`)
were moved to `docs/archive/` so the repository root only claims what is current.

## Defects found while remediating

These were not in the 17 but blocked or invalidated them. Each is fixed and
covered by a test:

| Defect | Impact | Fix |
|---|---|---|
| Schema codegen splice silently no-op'd | every `include:` returned nothing; the socket handshake rejected all users | generator asserts its anchor and fails loudly |
| Back-reference resolution matched "any unvisited opposite field" | `User.profile` skipped; `User`↔`Group` bound the wrong column with two relations | resolve by `@relation` name, allow scalar one-to-one, require a single `«model»Id` candidate otherwise |
| Resolved relations not written back to the runtime model map | back-reference-only relations were invisible at runtime | generator writes the resolved map onto `models[name].relations` |
| `EXPECTED_COLUMNS` keyed by model, `MODELS` by delegate | the boot check compared nothing | keyed consistently by delegate |
| Migrations threw before the column check | a half-migrated DB leaked `no such column` from inside a migration | migrations wrapped; the missing-column diagnostic always runs |
| `createSession` omitted `sessionToken` | credential login 500ed on a NOT NULL constraint | both columns written, as `ensureSessionRow` already did |
| Runtime ignored Prisma nested writes | `POST /api/conversations` — every conversation and group chat — 500ed on the built-in backend | nested `create`/`createMany`/`connect` supported, materialised then committed in one transaction; unsupported ops throw |
| Socket path never granted file access | attachment sent over the socket 403ed when the recipient opened it | grant logic moved to `file-access.cjs`, shared by both processes |
| Poll message used `messageType` | poll creation always 500ed | uses `type` |
| Generated MySQL schema widened indexed columns to `TEXT` | `prisma validate` rejected the variant in CI ("Native type `Text` cannot be unique in MySQL"), and the MySQL migration could not be applied | indexed columns kept at `VARCHAR(191)`; the generator now fails if a `WIDE_TEXT` column is indexed, and `tests/security/schema-variants.test.cjs` enforces it locally |

## Defects found while writing the tests (not in the original 17)

Neither of these was visible from reading the code, and both were found because the
end-to-end suite finally exercises the client and the server together.

### Messages sent from the UI were silently dropped

`ChatView` emits `message:send` with `{ conversationId, content }`; `socket-server.js`
only implemented the older `{ receiverId }` / `{ groupId }` handlers. The emit fell
through the `!data.receiverId` guard, was answered `{ ok: false, error: 'Unauthorized' }`,
and the client only surfaced `res.error` — which that path does not set, so nothing
was shown. The REST POST that *would* have stored the message was only a fallback
for when the socket was disconnected, i.e. exactly when it was not needed. The two
paths also disagreed on what a message is: the socket stored `receiverId` without
`conversationId`, and the thread renders from `conversationId`, so even a stored
message would never have appeared. Fixed server-side (`conversation:join`,
conversation-aware `message:send`, `typing:start`/`typing:stop`, `message:read`,
`message:react`, and member-wide `message:delete`), and the client now persists
through REST first, so a dropped broadcast costs the live update rather than the
message. Regression: `tests/integration/socket-conversation.test.cjs`.

### The built-in SQLite runtime ignored relation filters

The most serious finding in this pass. `db-runtime.js`'s `cond()` had no relation
support: a filter like `members: { some: { userId } }` reached `pushFilter()`, which
recognised no operator in the value and emitted nothing, so the condition silently
left the `WHERE` clause and the query matched **every row**. Every authorization
check expressed as a relation filter was a no-op. Concretely,
`GET /api/messages?userId=<peer>` — which needs the two users' shared direct
conversation to see conversation-shaped messages — returned other people's threads
to anyone. The runtime now implements `some`/`every`/`none` and nested to-one
filters as `EXISTS`/`NOT EXISTS` subqueries, and rejects any field it does not
recognise instead of ignoring it, so a filter can never quietly disappear again.
Regression: the relation-filter test in `tests/integration/db-runtime.test.cjs`
(fails against the previous runtime) and the third-party read assertion in
`tests/integration/security.test.cjs`.

This is a warning about the built-in backend generally: it is a hand-written
Prisma subset, and a *missing* feature there fails open rather than loud. The
unknown-field rejection added here is the general defence.

## Residual risks and open items

Stated plainly rather than buried:

1. **E2E is CI-only** (see 13). No local browser run exists on this branch.
2. **The MySQL path is validated as schema, not as a running system.** CI checks
   the generated schema and migration; no automated test runs the app against a
   live MySQL server. That remains a deploy-time verification.
3. **WebRTC media is not tested end to end.** Signaling authorization is covered;
   cross-NAT audio/video depends on TURN and two real networks.
4. **Horizontal scaling requires Redis.** Presence, the Socket.IO adapter and
   shared rate limits all depend on it; the per-process fallback is a single-node
   behaviour, by design.
5. **Outside the 17, still open** (unchanged by this branch, all pre-existing):
   `api/setup` grants an unauthenticated admin when `ALLOW_SETUP=true`;
   `useE2EE` is TOFU with no key-substitution defence; `POST /api/groups` accepts
   arbitrary `memberIds`; `api/verify` is unreachable from the UI;
   `use-socket.tsx` continues unauthenticated when token retrieval fails.
6. **Remaining schema name conflicts** carried deliberately for compatibility:
   `BroadcastMember.broadcastId` vs `broadcastListId`, and runtime-only
   `Profile.updatedAt` / `BroadcastList.updatedAt`. Renaming them would touch
   live data, so they are documented rather than changed in this pass.
