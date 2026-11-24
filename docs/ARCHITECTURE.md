# Architecture

How FriendConnect is put together, and why it is built this way. This document
describes the application **as it runs today**. Historical documents are in
[`archive/`](archive/README.md) and describe earlier states.

- [Process map](#process-map)
- [Request and authorization flow](#request-and-authorization-flow)
- [Database layer](#database-layer)
- [Schema pipeline](#schema-pipeline)
- [Files and attachments](#files-and-attachments)
- [Realtime and calls](#realtime-and-calls)
- [Authentication and sessions](#authentication-and-sessions)
- [Configuration and failure modes](#configuration-and-failure-modes)
- [Where things live](#where-things-live)

## Process map

Two Node processes serve the product, plus an optional TURN relay:

| Process | Entry point | Default port | Responsibility |
| --- | --- | --- | --- |
| `friendconnect` | `.next/standalone/server.js` | `PORT` (3000) | Next.js App Router: 133+ route handlers, server components, the UI |
| `friendconnect-socket` | `socket-server.js` | `SOCKET_PORT` (3003) | Socket.IO: messaging, presence, typing, calls, reactions |
| `friendconnect-turn` | bundled node-turn or Coturn | `TURN_PORT` (3478/udp) | WebRTC relay for calls across NATs |

Caddy (or the dev gateway in `scripts/dev-all.cjs`) terminates TLS and
reverse-proxies `/` to the app and `/socket.io` to the socket server, so the
browser sees a single origin. Both processes read the same `.env`
(`ecosystem.config.cjs` passes it to each), which is why the two must agree on
`NEXTAUTH_SECRET`, `DATABASE_URL` and `APP_ORIGIN`.

The design consequence worth knowing: the socket server is **not** a thin relay.
It can write messages, so anything it writes must be authorized exactly as the
REST routes authorize the same action. That sharing is what
[`src/lib/socket-security.cjs`](../src/lib/socket-security.cjs) exists for.

## Request and authorization flow

```
browser ──▶ Caddy ──▶ Next.js route handler ──▶ getCurrentUser() ──▶ session registry
                  │                                        │
                  │                                        └─▶ db (see Database layer)
                  └──▶ Socket.IO ──▶ createHandshakeMiddleware ──▶ session registry
```

1. **Establishing identity.** Route handlers call `getCurrentUser()`
   ([`src/lib/session.ts`](../src/lib/session.ts)). It accepts either a NextAuth
   JWT or the legacy `fc_session` cookie, but in both cases it resolves the
   claim back to a `Session` row through `findCurrentSession()`
   ([`src/lib/session-registry.cjs`](../src/lib/session-registry.cjs)). A JWT for
   a revoked row is not a session. The socket server uses the same registry in
   `createHandshakeMiddleware`, so revoking a session disconnects both surfaces.
2. **Deciding permission.** Any question of the form "may A act on B" goes
   through `canInteract(store, fromId, toId, permission)` /
   `isMessageParticipant(store, userId, message)`. Those helpers are also plain
   `.cjs` so both processes import the same implementation instead of two
   copies that drift. Order of precedence:
   - a `Block` row, or a stale `Friendship.status = 'BLOCKED'` row, denies
     unconditionally (a block beats a friendship);
   - an `ACCEPTED` friendship allows;
   - otherwise the recipient's `Profile.messagePermission` / `callPermission`
     must be `PUBLIC` or `EVERYONE`;
   - a missing profile denies.

   `tests/integration/authz-drift.test.cjs` enforces both halves: routes must
   import the shared helper, and the helper must return the expected answer for
   every relationship state.
3. **Shaping the response.** Routes return `json()` / `errorJson()` from
   [`src/lib/serialize.ts`](../src/lib/serialize.ts) and catch through
   `handleRouteError()` ([`src/lib/api-errors.ts`](../src/lib/api-errors.ts)),
   which maps a `RouteError` to its status and anything else to a generic
   `INTERNAL_ERROR` with a `requestId`. Internal messages (SQL, file paths,
   driver errors) are logged, never returned. See
   [failure modes](#configuration-and-failure-modes).

## Database layer

The handle is always `db` from [`src/lib/db.ts`](../src/lib/db.ts), a lazy proxy.
Selection happens once, in [`src/lib/db-backend.ts`](../src/lib/db-backend.ts):

| `DATABASE_URL` / env | Backend | Notes |
| --- | --- | --- |
| `mysql://…`, `mariadb://…` | Prisma Client + `@prisma/adapter-mariadb` | production path; needs `prisma generate` |
| `file:…` (default) | built-in SQLite runtime (`better-sqlite3`) | local/dev and small self-hosted installs |
| `file:…` + `DB_ENGINE=prisma` | Prisma + SQLite adapter | testing the Prisma path without MySQL |
| anything else | **throws at boot** | no silent choice is made |

There is deliberately no automatic fallback: the old code wrapped
`new PrismaClient()` in a try/catch and quietly swapped in the SQLite runtime,
which means two deployments with the same configuration could end up reading
*different databases*. `DB_ALLOW_SQLITE_FALLBACK=true` re-enables a logged
fallback for local development only and is ignored when `NODE_ENV=production`.

The SQLite runtime ([`src/lib/db-runtime.js`](../src/lib/db-runtime.js)) is a
Prisma-shaped facade over the tables in `src/lib/sqlite-ddl.cjs`. It is not a
database engine; it implements the query surface the app uses:

- `findUnique` / `findFirst` / `findMany` / `count` with `where`, `select`,
  `include` (to-one, to-many, nested), `orderBy`, `take`, `skip`;
- `create` / `createMany` / `update` / `updateMany` / `upsert` / `delete` /
  `deleteMany`, including Prisma **nested writes**
  (`{ members: { create: [...] } }`, `{ connect: … }`) which are materialised up
  front and committed in one transaction;
- `groupBy` and `aggregate` (poll tallies);
- `$transaction` in callback and array form.

Two invariants make this safe to rely on:

1. **Types are coerced, not guessed.** Columns declared `DateTime` in the schema
   come back as real `Date` objects; `Boolean` comes back as a boolean.
   (`findings`: `.getTime()` on a string used to 500 `/api/presence`.)
2. **Transactions never interleave.** `better-sqlite3` is synchronous, so an
   `await` inside an open `BEGIN` deadlocks the single writer. The callback form
   therefore runs against a *staging* client that records writes and materialises
   the rows (ids included). On success the recorded work is replayed inside one
   synchronous `db.transaction()`; on throw nothing is committed and the rows the
   callback already saw are discarded. Reads inside the callback see staged
   state, which is what "create then read the id" call sites need.

On boot the runtime proves the file matches the schema:
`findMissingColumns(schema, EXPECTED_COLUMNS)` refuses to start with

```
[db] SQLite database schema is incomplete (N missing column(s)/table(s)). Missing: … Restore this database…
```

rather than serving requests against a half-migrated database. Additive
migrations in [`src/lib/db-migrations.cjs`](../src/lib/db-migrations.cjs) run
first; if one fails its error is reported *inside* that message, because a raw
`no such column` from inside a migration is not a useful diagnostic.

`prisma/schema.prisma` is the single source of truth. `schema.sqlite.prisma`
and `schema.mysql.prisma` are generated.

## Schema pipeline

```
prisma/schema.prisma  (hand-edited, canonical)
        │
        ├─ scripts/generate-schema-variants.mjs → prisma/schema.sqlite.prisma, prisma/schema.mysql.prisma
        ├─ scripts/generate-schema-metadata.mjs → src/lib/schema-metadata.cjs   (models, relations, defaults, uniques)
        ├─ scripts/generate-sqlite-ddl.mjs      → src/lib/sqlite-ddl.cjs        (CREATE TABLE/INDEX)
        └─ scripts/generate-mysql-migration.mjs → prisma/migrations/…/migration.sql
        │
        └─ scripts/check-schema-drift.mjs  ── compares all five artefacts
```

`npm run schema:check` runs every generator in `--check` mode plus the drift
check and is the first stage of `scripts/deploy.sh`. If someone edits a
generated file or forgets to regenerate after changing the schema, the deploy
stops before touching a database. `npm run schema:generate` rewrites them.

The generators parse the schema textually (`scripts/lib/prisma-parse.mjs`)
because Prisma's own engine is not available in every build environment. Two
consequences worth remembering when editing the schema:

- every `@relation` pair is resolved by name where one is given, so two relations
  between the same models (`User.ownedGroups` and `User.groupMemberships`) stay
  distinct; a scalar back-reference is only inferred when the target has exactly
  one `«Model»Id` column;
- a column type the generators do not understand is a hard failure, not a
  default. See [`archive/WORKLOG_HISTORY.md`](archive/WORKLOG_HISTORY.md) for how
  the earlier hand-maintained metadata drifted (it silently lost relations, which
  broke every `include:` and the socket handshake at once).

## Files and attachments

Uploads go through `POST /api/files/upload`, which:

1. reads the bytes and rejects anything over the per-user quota;
2. sniffs the type by **magic bytes** (`detectUploadType` in
   [`src/lib/upload-security.cjs`](../src/lib/upload-security.cjs)) and matches it
   against an allow-list — the client's `Content-Type` is not trusted;
3. re-encodes raster images (`sanitizeRasterImage`) so an image cannot carry a
   script payload;
4. stores the file under `UPLOAD_DIR` and inserts a `File` row, then records an
   owner grant.

Downloads go through `GET /api/files/[id]`, which requires the id to match
`^[a-f0-9]{24,48}$`, then asks `canDownloadFile(userId, file)` before applying a
MIME allow-list and revalidating the bytes.

Authorization is a **grant table**, not a scan. `FileAccess(fileUrl, userId)`
rows are written when a file becomes reachable — upload, message send, story
post, forward — and removed when sharing stops. `canDownloadFile` resolves in
this order, cheapest first:

1. the caller owns the file (one indexed read);
2. an explicit, unexpired grant exists (one indexed read);
3. the URL is a public profile photo/avatar (public media only);
4. the URL is an approved Jara asset (public media only).

Steps 3–4 never inspect message contents, so they cannot widen access to chat
attachments. The implementation lives in
[`src/lib/file-access.cjs`](../src/lib/file-access.cjs) because `socket-server.js`
must issue the same grants as the REST routes; `src/lib/file-access.ts` is the
typed facade the app imports. `backfillFileAccess()` re-derives grants for data
written before the table existed and is exposed as
`npm run backfill:file-access`.

## Realtime and calls

`use-socket.tsx` connects with a token from `GET /api/auth/token`. The handshake
middleware validates it against the session registry, so a revoked session is
rejected at connect time, and a periodic check (plus a check on every event)
disconnects sockets whose session has gone away.

Events are namespaced by domain: `message:*`, `group:*`, `reaction:*`,
`typing`, and `call:*`. Each is authorized with the same helpers the REST routes
use; a socket event that would be refused over HTTP is refused here.
Rate limiting runs through Redis when `REDIS_URL` is set and falls back to a
process-local counter otherwise (logged once). The local limiter is only
process-wide, so **do not scale the socket server horizontally without Redis**,
for rate limits and for the Socket.IO adapter.

Calls are peer-to-peer WebRTC with the socket server relaying SDP/ICE. TURN is
required for peers behind different NATs; see the checklist in the
[README](../README.md#calls--images-not-working-checklist).

Scheduled messages and reminders are delivered by an interval in the socket
server, not by a Next.js cron route.

## Authentication and sessions

- NextAuth (credentials provider) plus a legacy cookie login route, both of which
  mint a `Session` row. Rows are the authority; tokens are only a claim about
  them. `Session.token` is what the socket looks up; `sessionToken` is the legacy
  column and both are written together because both are `NOT NULL`.
- Passwords are bcrypt with opportunistic rehashing on login.
- One-time codes (email verification, password reset) are stored **hashed** with
  an attempt counter and a resend throttle
  ([`src/lib/one-time-code.ts`](../src/lib/one-time-code.ts)); the reset
  credential is an opaque digest, never a token in a database column that a log
  could reveal.
- 2FA secrets are only trusted after confirmation, backup codes are single-use
  digests, and failed challenges are capped
  ([`src/lib/two-factor.ts`](../src/lib/two-factor.ts)). The NextAuth authorize
  path enforces 2FA too, not only `/api/auth/login`.

## Configuration and failure modes

| Variable | Missing → behaviour |
| --- | --- |
| `DATABASE_URL` | unsupported/absent URL throws at boot; no fallback |
| `NEXTAUTH_SECRET` | auth routes refuse to serve in production |
| `APP_ORIGIN` / `NEXTAUTH_URL` | CORS and cookie origin mismatch; set both |
| `REDIS_URL` | cache and rate limits fall back to per-process memory (logged) |
| `UPLOAD_DIR` | uploads land in the default directory; set it explicitly |

Failure policy, by layer:

- **Boot** — fail loudly (bad `DATABASE_URL`, incomplete schema, missing
  `NEXTAUTH_SECRET` in production).
- **Request** — a `RouteError` maps to its status; anything else becomes a
  generic 500 with a `requestId` that matches the server log line. Driver
  messages, SQL and file paths never reach the client.
- **Realtime** — an unauthorized event is refused or the socket is disconnected;
  it never falls back to an anonymous session.
- **Lazy dependencies** — Redis is optional by design and its absence is logged
  once. Optional integrations (S3, SMTP, web push) degrade with a logged warning,
  never silently.

Operational procedures — backups, migration, rollback, health checks — are in
[`DEPLOYMENT_AND_RECOVERY.md`](DEPLOYMENT_AND_RECOVERY.md) and
[`DEPLOY_LEARN_ALOEDUCATION.md`](DEPLOY_LEARN_ALOEDUCATION.md). Test strategy and
what each suite proves is in [`TESTING.md`](TESTING.md).
