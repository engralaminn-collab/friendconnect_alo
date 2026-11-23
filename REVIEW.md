# FriendConnect — Code Review: Highest-Value Improvements

Reviewed branch `arena/4f5b1aba-friendconnect-alo` (base `a92dd5f`).

Scope: 398 tracked files — Next.js 16 App Router (`src/`), 114 API routes, a separate
Socket.IO server (`socket-server.js`), a hand-written SQLite data layer (`src/lib/db-runtime.js`),
three Prisma schemas, and PM2/Caddy/Docker deploy tooling.

> Note: I did not install dependencies or run the test suite. `tsc`/`eslint` verdicts below come
> from static reading, not execution. No files were changed apart from adding this review.

---

## P0 — Security & correctness (fix before any further feature work)

### 1. Password verification is never awaited — auth bypass in `/api/auth/login`
**Files:** `src/app/api/auth/login/route.ts:28`, `src/lib/auth.ts` (`verifyPassword`)

`verifyPassword` is declared `async`, but the login route calls it without `await`:

```ts
if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
  return errorJson('Invalid username/email or password', 401)
}
```

An un-awaited async function returns a **pending Promise**, which is always truthy, so
`!verifyPassword(...)` is always `false`. The password is never compared.

I confirmed the semantics with a minimal reproduction: a wrong password is accepted.

```js
if (!user || !user.passwordHash || !verifyPassword('WRONG', 'correct')) { reject } else { ACCEPTED }
// -> ACCEPTED (password never compared)
```

**Why it matters:** anyone who knows a valid username or email can log in as that account —
including the seeded `aria` account, which `/api/setup` promotes to `admin`. This is a total
authentication bypass, and it silently defeats the bcrypt hashing of (2) below.

The same missing-`await` pattern appears in:
- `src/app/api/auth/login/route.ts:46` — `hashPassword(password)` stored un-awaited writes the
  literal string `[object Promise]` as the new password hash during rehash.
- `src/app/api/auth/reset-password/route.ts:24` — password reset stores `[object Promise]` as the hash.
  Combined with (1) this is not currently exploitable, but it permanently corrupts the account's
  password; fixing (1) alone will start rejecting every reset user.
- `src/app/api/2fa/verify/route.ts:23` — `hashPassword()` un-awaited inside `map()`, so **backup codes
  are stored as `[object Promise],[object Promise],…`**.
- `src/app/api/2fa/disable/route.ts:17` — same bug as login: `if (!verifyPassword(...))` is always
  false, so **2FA can be disabled with any garbage password** (full 2FA bypass).
- `src/app/api/setup/route.ts:32` — demo users are created with `[object Promise]` as their hash.
- `src/app/api/auth/token/route.ts` / `src/app/api/sessions/[id]/route.ts` work around this by using
  `getSessionUser()`, which is correct.

**Fix:** `await verifyPassword(...)`, `await hashPassword(...)` at every call site. Then add a
regression test that asserts a *wrong* password returns 401 (see item 12 — the current E2E suite
never tests a failed login).

---

### 2. TOTP verification is not awaited in the login route — 2FA bypassed entirely
**File:** `src/app/api/auth/login/route.ts:37`

```ts
const totpOk = user.twoFactorSecret ? verifyTotp(String(totp), user.twoFactorSecret) : false
if (!totpOk) { return errorJson('Invalid authenticator code', 401) }
```

`verifyTotp` is synchronous (`src/lib/totp.ts:66`), so this one is actually fine — but note the
inverse hazard: `verifyTotp` is *sync* while `verifyPassword` is *async*, and the codebase mixes
both calling conventions. Because of item 1, 2FA is bypassed anyway: with the correct password path
short-circuited, a caller who sends any `totp` value reaches account takeover. Once item 1 is fixed,
verify a bad TOTP is rejected.

Separately, **2FA is only enforced on `/api/auth/login`, but the UI authenticates through
NextAuth** (`src/lib/auth.ts` `CredentialsProvider.authorize`) — which contains **no `twoFactor`
check at all**. So a 2FA-enabled user logs in through the UI with password only. See item 4.

---

### 3. Sessions are never created with a cookie, and `logout` never clears the real session
**Files:** `src/lib/session.ts:84-102`, `src/app/api/auth/logout/route.ts`, `src/app/api/sessions/route.ts:25`

`setSessionCookie()` and `clearSessionCookie()` are **empty stubs** that only contain a comment on
how cookies *would* be set. `createSession()` writes a row to `Session` but nothing ever sets the
`fc_session` cookie. Consequences:

- The custom auth flow (`/api/auth/login` → `fc_session` cookie) cannot actually log anyone in;
  `/api/auth/me`, `/api/auth/logout`, `/api/auth/token` and the socket server's `cookieToken()`
  all read a cookie that is never issued by this code path.
- `logout` does `db.session.deleteMany({ where: { token } })` where `token` comes from
  `getCurrentSessionToken()`. `sessions/route.ts:25` compares `s.token === currentToken`, but
  `createSession()` only populates `sessionToken`, never `token` (both exist in the schema —
  `prisma/schema.prisma:90` `token @unique`, `:98` `sessionToken String?`). So `isCurrent` is
  always false and the socket token lookup in `/api/auth/token` returns the wrong column.

**Why it matters:** there are two half-wired session systems — NextAuth JWT (used by the UI) and
this DB-session system (used by the socket server and several routes). Nobody owns the boundary.
Any "logout other devices" or "active sessions" UI is cosmetic. Consolidate on one, delete the
other's dead helpers.

---

### 4. Two parallel authentication systems with inconsistent policy
**Files:** `src/lib/auth.ts` (`authOptions`), `src/app/api/auth/login/route.ts`, `src/components/chat/AuthScreen.tsx`

- The mounted app logs in via `signIn('credentials')` → NextAuth (`src/components/chat/AuthScreen.tsx:31`),
  which only calls bcrypt compare in `authorize`.
- The custom `/api/auth/login` implements rate limiting, 2FA, audit logging, and password rehashing —
  **none of which run for UI logins.**
- Therefore: **no login rate limiting, no 2FA, and no audit trail on the path users actually take.**
  The `/api/auth/login` hardening is effectively dead code.
- `authOptions.secret` and `ws-token` both fall back to the literal
  `"friendconnect-dev-secret-change-in-production"`. In production without `NEXTAUTH_SECRET` set,
  anyone can forge NextAuth JWTs and WebSocket tokens. This should throw at boot in production
  rather than default.

**Fix:** move 2FA, rate limiting and audit into `authorize()` (or route everything through one
endpoint), and fail fast if `NEXTAUTH_SECRET` is unset in production.

---

### 5. `GET /api/me` leaks the user's 2FA secret and password-adjacent fields
**Files:** `src/app/api/me/route.ts:16`, `src/lib/session.ts:34-39`

`getCurrentUser()` selects `twoFactorSecret: true`, and `/api/me` returns `user: u` wholesale:

```ts
const u = await getCurrentUser()
return NextResponse.json({ user: u })   // includes twoFactorSecret
```

Any XSS, any browser extension, or any user who simply opens the endpoint gets the TOTP seed and
can clone the authenticator. `/api/auth/me` does the right thing (explicit `select`); `/api/me`
does not.

**Fix:** never put `twoFactorSecret` in the shared `CurrentUser` type. Add a narrow `select` for
any route that returns the session user.

---

### 6. `GET /api/metrics` is unauthenticated
**File:** `src/app/api/metrics/route.ts`

No session check (confirmed in the "routes without auth" sweep). It exposes user counts, message
counts, active sessions and file counts to anyone who can reach the port. `Caddyfile.production:41`
even routes `/api/metrics` explicitly, so it is intentionally public.

**Why it matters:** free reconnaissance — growth rate, activity, and session volume. Gate it behind
admin auth or a bearer token, or bind it to a metrics-only listener.

---

### 7. Any group member can remove any other member (and themselves) from a group
**File:** `src/app/api/groups/[id]/members/route.ts` (`DELETE`)

```ts
const targetId = url.searchParams.get('userId') || me.id
await db.groupMember.deleteMany({ where: { groupId: id, userId: targetId } })
```

There is **no role check and no check that the caller is even a member**. Any authenticated user can
`DELETE /api/groups/<any-group-id>/members?userId=<any-user-id>` and eject the owner from a group
they are not in. (The `POST` sibling does check `OWNER`/`ADMIN`, which makes the asymmetry obvious.)

**Fix:** require caller membership; require `OWNER`/`ADMIN` to remove others; `OWNER` cannot be
removed; validate `targetId` is a member.

---

### 8. User search matches on email — account/identity enumeration
**File:** `src/app/api/users/search/route.ts`

```ts
OR: [{ username: { contains: lc } }, { name: { contains: lc } }, { email: { contains: lc } }]
```

Any logged-in user can search partial email substrings and get back matching accounts with
`username`, `name`, `lastSeenAt`. For a "private social platform" this is the single most
likely privacy complaint. Drop the `email` clause (or restrict it to an exact match for
"add by email" flows and never return it in the payload).

---

### 9. `/api/users/[id]` respects profile visibility but ignores blocking
**File:** `src/app/api/users/[id]/route.ts`

`canViewFull` is computed from `profileVisibility` and friendship, but a **blocked** relationship
still returns the full profile (bio, phone, location, birthday) as long as visibility is `PUBLIC`.
Blocking should at minimum suppress the profile, or return a 404-style stub.

---

### 10. Unauthenticated WebRTC/relay side effects in the socket server
**File:** `socket-server.js` (`message:seen`, `reaction:*`, `message:delete`)

`requireAuth()` returns `socket.data.userId`, set only in `bindUser`. That part is sound — but the
`io.use` middleware calls `next()` unconditionally, so **unauthenticated sockets stay connected**
and receive `online:update` / `presence` broadcasts for every user. Presence of the whole user base
is visible to any client that connects without a token.

Also note `message:seen` (`socket-server.js:255`) updates **any** message id with no check that the
caller is the receiver, so a caller can mark arbitrary messages seen.

**Fix:** reject the handshake when no valid token is present (`next(new Error('unauthorized'))`),
scope `presence`/`online:update` to friends, and authorize `message:seen` against `receiverId`.

---

## P1 — Data integrity & deployment

### 11. The SQLite data layer silently re-implements Prisma, and the MySQL path may not exist
**Files:** `src/lib/db-runtime.js` (~1,200 lines), `src/lib/db.ts`, `prisma/schema*.prisma`, `scripts/deploy.sh:38-50`

- `src/lib/db.ts` `require('@prisma/client')` and on **any** exception silently falls back to
  `db-runtime.js`. So a broken Prisma install / missing engine / bad `DATABASE_URL` degrades
  silently to SQLite instead of failing loudly. That is the kind of fallback that turns a config
  error into "why is my production data gone / why is nothing saving".
- `db-runtime.js` hand-emulates `findMany`/`findUnique`/`include`/`select`/`upsert` and does its own
  implicit migration via `ensureColumns()` (`ALTER TABLE … ADD COLUMN` at startup). This is a second
  ORM to maintain; every new field needs to be added in **three** places (3 schemas + the runtime).
- **`scripts/deploy.sh` generates and migrates MySQL against `prisma/schema.prisma`, which is the
  SQLite schema** (`provider = "sqlite"`), while `migration_lock.toml` says `provider = "mysql"` and
  the migration history is MySQL-flavoured (`CREATE TABLE \`User\``). `schema.mysql.prisma` is never
  referenced by the deploy script — only `production-install.sh:101` copies it over. So a clean
  MySQL deploy via `deploy.sh` is at best confusing and at worst broken.
- Migrations are incomplete regardless: the init migration creates **23 tables**, `schema.mysql.prisma`
  declares **28** models (5 `Jara*` models missing), and `schema.prisma` declares **40** models
  (17 missing, incl. `Post`, `Poll`, `Conversation`, `ConversationMember`, `Block`, `Report`,
  `Attachment`). `prisma migrate deploy` on a fresh MySQL database will produce a schema that does
  not match the code — and `migrate deploy` will not tell you, because it only replays the files.

**Fix:** pick one schema as source of truth, generate migrations from it, remove the silent
fallback in `db.ts` (make the failure explicit), and add a CI check that the migration history
reproduces the schema (`prisma migrate diff --exit-code`).

### 12. Tests: the E2E suite exists but CI never runs it, and it tests none of the risks above
**Files:** `.github/workflows/ci.yml`, `package.json`, `playwright.config.ts`, `tests/e2e/*.spec.ts`

- `package.json` has **no `test` script** and no unit-test runner (no vitest/jest). The only tests are
  two Playwright specs — 4 tests total for a 114-route app.
- `ci.yml` never invokes Playwright. So `tests/e2e` can rot indefinitely without anyone noticing.
- `ci.yml` runs `typecheck` and `build` with `continue-on-error: true`, annotated
  `"pre-existing errors in 2fa/admin/profile routes"` and `"missing deps nodemailer/web-push/ioredis"`.
  **Lint is the only blocking gate**, and `eslint.config.mjs` disables 25+ rules including
  `no-unused-vars`, `prefer-const`, `react-hooks/exhaustive-deps` and every `no-*` sanity rule. Net
  effect: CI is close to a no-op.
- The existing specs wouldn't catch item 1: `01-auth.spec.ts` asserts *registration* succeeds and
  that a duplicate returns 409, but never asserts a **wrong password is rejected**.
- Three more Playwright problems would surface immediately once it does run: `baseURL`/`webServer`
  use port **3005** while `webServer.command` launches `.next/standalone` (which requires a prior
  build), and the specs hardcode absolute `http://127.0.0.1:3005` URLs instead of using `baseURL`,
  so they can't run against any other environment.

**Highest-leverage fix:** add `test:e2e` to `package.json`, run it in CI, and add 5 unit tests for
`verifyPassword`, `verifyTotp`, `rateLimit`, `hashPassword`, and `validatePassword`. Those five
would have caught items 1 and 2.

### 13. Two dependencies are imported but absent from `package.json`
**Files:** `scripts/turn-server.js:7` (`require('node-turn')`), `socket-server.js:54`
(`require('@socket.io/redis-adapter')`)

Neither appears in `package.json`, `package-lock.json`, or `bun.lock`. Yet `ecosystem.config.cjs`
starts `${NAME}-turn` unconditionally (`TURN_ENABLED !== 'false'`) — so **the TURN process crashes on
every deploy** in a stock install, and the Redis adapter silently degrades to a single-node adapter
(the `catch` only warns). TURN crashing means calls between networks hang on "Connecting…", which
`README.md` documents as a known symptom — the root cause is the missing dependency.

The `Dockerfile` does copy `node_modules/node-turn`, `crc`, `js-yaml`, `log4js` from the builder —
proving they were expected to be present, but they aren't declared, so `npm ci` won't install them.

**Fix:** `npm i node-turn @socket.io/redis-adapter`; if Redis is optional, make the adapter a
documented optional peer rather than a silent `catch`.

### 14. `upload/` is a committed runtime directory, contradicting `.gitignore`
**Files:** `upload/be9ee305d83989b42310cdfc.png`, `upload/FriendConnecte logo_ unity and communication.png`, `.gitignore`

`.gitignore` lists `/public/uploads/` but not `/upload/`, and two user-uploaded PNGs (plus the
storage-quota bookkeeping that goes with them) are tracked. `docker-compose.yml` mounts `uploads:`
as a volume, so this directory is runtime state. Tracked uploads will conflict with the volume on
first `docker compose up` and with `scripts/restore.sh`.

**Fix:** add `/upload/*` to `.gitignore` (keep `.gitkeep`), `git rm --cached` the two PNGs.

### 15. 55 routes return raw exception text to the client
**Files:** 55 occurrences of `errorJson(e?.message || 'Server error', 500)` under `src/app/api/`

Database errors, SQLite constraint messages, file paths from `readFileSync`, and internal stack
details are sent straight to the browser. Combined with `logger` having no redaction, this is a
steady leak of internals. Add a shared `handleRouteError(e)` that logs the real error and returns a
generic message + correlation id.

---

## P2 — Documentation & developer experience

### 16. `README.md`, `worklog.md` and `docs/SECURITY_AUDIT.md` contradict each other and the code
- `README.md` says "npm install / npm run dev # gateway :3000 → Next :3001 + Socket.IO :3003", but
  `package.json` `dev` is `next dev -p 3000` — **no gateway, and Next occupies 3000**, which is the
  port the README says the gateway uses. `scripts/gateway.cjs` exists but no npm script calls it.
- `README` says Prisma + MySQL 8; the actual default is the hand-rolled SQLite runtime (item 11).
- `worklog.md:13` says "**Password hashing: scrypt (no bcrypt)**" and "sessions in httpOnly cookie
  `fc_session`" — the code uses bcryptjs and never sets that cookie (item 3).
- `docs/SECURITY_AUDIT.md` rates Authentication as **PASS** ("bcrypt 10 rounds, session guard on all
  routes") and Secrets as **PASS**. Both are contradicted by items 1–5. An audit document that says
  PASS on a bypass is worse than no audit, because it stops people looking.

**Fix:** collapse `docs/` (22 files, of which `AUDIT_INITIAL`, `AUDIT_FINAL`, `IMPLEMENTATION_AUDIT`,
`FINAL_DELIVERY_REPORT` all restate each other) into `README` + `docs/ARCHITECTURE.md` +
`docs/DEPLOY.md`, and mark or delete the stale audit reports. `worklog.md` is 276 KB of stream-of-
consciousness — it belongs in a wiki, not the repo root.

### 17. `arena-candidate/` is a second, unreferenced backend in the tree
**Directory:** `arena-candidate/server/` (~25 files, its own `package.json` + lockfile)

`IMPORT-STATUS.md` says it is "for technical review, production not replaced". It duplicates
auth/routes/services conceptually with `src/`, doubles lockfile surface, and will confuse anyone
grepping for `src/services/auth.js`. If it's a future migration, move it to its own branch or a
`proposals/` doc; if it's dead, delete it.

### 18. No `CONTRIBUTING.md`, no `.nvmrc`/engines, no lockfile policy
- Two lockfiles are committed (`package-lock.json` 619 KB and `bun.lock` 352 KB) and the README,
  `Dockerfile` and `deploy.sh` use `npm`/`npm ci` while `.zscripts/dev.sh` and `install.sh` use `bun`.
  This is why CI needs `bun install --frozen-lockfile || bun install || npm ci --ignore-scripts` —
  a three-way fallback that means the lockfile is never actually enforced. Pick one package manager,
  delete the other lockfile, and make CI use `--frozen-lockfile` for real.
- `Dockerfile` has `RUN npm ci --omit=dev` in `deps` then `RUN npm ci` again in `builder`, and the
  `--omit=dev` stage's `node_modules` is copied into `builder` and then overwritten — so the first
  line is dead work on every build.

### 19. `next.config.ts` has no security headers
**File:** `next.config.ts`

Headers live only in `Caddyfile.production`, so `npm run dev`, Docker-without-Caddy, and any
deployment that terminates TLS elsewhere get **no CSP, no HSTS, no `X-Frame-Options`, no
`nosniff`**. Move them into `next.config.ts` `headers()` so they apply everywhere, and keep Caddy's
copy as defence in depth. (Also worth noting: `Caddyfile` — the dev one — proxies
`XTransformPort` to an arbitrary `localhost:{query.XTransformPort}`, i.e. it will proxy to *any*
local port a visitor names. Dev-only, but it should be pinned to the realtime port.)

### 20. Feature flags that lie: E2EE and "encrypted" copy
**Files:** `src/lib/e2ee.ts`, `src/hooks/useE2EE.ts`, `src/components/fc/chat/ChatView.tsx:2863`, `src/components/fc/auth/AuthFlow.tsx:85`

There is a complete E2EE implementation (ECDH P-256 + AES-GCM, IndexedDB key storage, key
publish/fetch endpoints) — and **`useE2EE` is imported by nothing**. Meanwhile the UI says
"End-to-end encrypted feel" and "Only people in this conversation can see these messages" while
messages are stored in plaintext and `POST /api/messages` takes a plain `content` string.

**Why it matters:** this is a false security claim in a privacy-positioned product. Either wire it
up or remove the copy. Note the design also has no forward secrecy and no multi-device support
(documented honestly in the file header) — so decide whether that's acceptable before shipping the
word "encrypted".

### 21. `src/app/api/route.ts` is a leftover scaffold endpoint
Returns `{"message":"Hello, world!"}` at `/api`. Harmless but signals "template not cleaned up";
remove it or make it a real `/api` index.

---

## Suggested order

1. Items **1–2** (awaits) + a failing-password test. Ship this alone as a hotfix.
2. Items **4, 5** — unify auth, stop leaking `twoFactorSecret`, fail fast on missing secret.
3. Item **7** (group membership IDOR), **6** (metrics), **8** (email search), **9** (blocked profile).
4. Items **3, 10** — finish or delete the DB-session system; reject unauthenticated sockets.
5. Item **11** — one schema, real migrations, no silent fallback. This unblocks safe deploys.
6. Item **12** — make CI actually block. Without this, everything above regresses.
7. Items 13–15, then 16–21.

---

# Execution pass — 2026-11-23 (what was actually done and proven)

Commit `20512b3` on `arena/4f5b1aba-friendconnect-alo` (pushed, tree clean).

## Fixed and verified against a running production build

| # | Issue | Before (measured) | After (measured) |
|---|---|---|---|
| 1 | Auth bypass: un-awaited `verifyPassword` | wrong password → `200 {"success":true}` | wrong password → `401` |
| 2 | `hashPassword` un-awaited (login/reset/2fa/setup) | `[object Promise]` stored; setup → `500 SQLite3 can only bind…` | setup → `200`, logins work |
| 3 | 2FA disable: un-awaited `verifyPassword` | any password disabled 2FA | requires correct password |
| 4 | Group members `DELETE` IDOR | plain member removed group OWNER (2→1 members) | `403 Only owner/admin…`; self-leave still `200` |
| 5 | `/api/me` leaked `twoFactorSecret` | TOTP seed in response | stripped; `hasTwoFactorSecret` only |
| 6 | Orphaned `mini-services` broke build | `tsc` 1 error, `next build` fail | `tsc` 0 errors, build exit 0 |
| 7 | CI typecheck non-blocking | `continue-on-error: true` | blocking |

Gates: `tsc --noEmit` **0 errors**, `eslint .` **0 problems**, `next build` **exit 0**
(only warning is the expected "Prisma Client is not generated" in this sandbox), API suite **19/19 pass, 0 fail**.

## What is BLOCKED, and why (each independently verified)

| Blocker | Evidence |
|---|---|
| **No SSH credentials to production** | `ssh aloedu@103.231.239.79` → `Connection reset by peer`; no `~/.ssh`; `gh api .../actions/secrets` → `403 Resource not accessible by integration` |
| **`AUTO_DEPLOY_MAIN` not verifiable** | `gh api .../actions/variables` → `403` |
| **`panel.alolabs.net` unreachable from sandbox** | TLS `SSL_ERROR_SYSCALL` on 443, empty reply on 80 (egress allowlist). Cannot confirm it hosts FriendConnect at all — docs say it is a *hosting control panel* and the app is on `learn.aloeducation.com` |
| **Prisma engine download blocked** | `binaries.prisma.sh` unreachable → `prisma generate/validate` cannot run; app falls back to `db-runtime.js` (SQLite). MySQL path therefore **never executed** |
| **Playwright browsers cannot be downloaded** | `playwright.azureedge.net` / `cdn.playwright.dev` → `000`; none pre-installed. Browser E2E not runnable here |
| **No AI provider configured** | `/api/ai/status` → `configured:false, provider:none`; `/api/jara/chat` returned the **canned `fallbackReply`**, not inference. Real Jara inference unverified |
| **Voice / calling unverified** | No browser, no camera/mic, no STUN/TURN reachability, no Ollama/STT endpoints in sandbox |

## Still open (not attempted, needs scoping)

- 2FA is **still not enforced on the NextAuth path** (`src/lib/auth.ts authorize()`) — the UI's login route. Fixing this changes login UX for 2FA users, so it should be a deliberate change.
- `/api/metrics` still unauthenticated (verified returns data with no session).
- `users/search` still matches on email.
- Session cookie stubs (`setSessionCookie`/`clearSessionCookie`) and the `token` vs `sessionToken` mismatch are unchanged.
- Missing deps `node-turn` / `@socket.io/redis-adapter`.
- Migration history still does not reproduce the schema.
- Duplicate Socket.IO implementations (`socket-server.js` vs `mini-services/chat-service`) — only the build breakage was addressed, not the duplication.

---

# Execution pass 2 — 2026-11-23 (schema reconciliation)

## The "17 missing tables" figure understated it

Four sources of truth disagreed. Before → after (`47ebb45`):

| Source | Before | After |
|---|---|---|
| `prisma/schema.prisma` | 40 | 40 |
| `prisma/schema.mysql.prisma` | 28 | **40** |
| `src/lib/db-runtime.js` | 33 | **40** |
| tables created by migrations | 23 | **40** |

## Newly found, now fixed

1. **Seven models the API calls did not exist in the runtime at all** —
   `conversation`, `conversationMember`, `poll`, `pollVote`, `report`,
   `starredMessage`, `verificationToken`. Every route touching them threw
   `Cannot read properties of undefined`. Reproduced 500s on `/api/conversations`,
   `/api/reports`, `/api/messages/[id]/star`; now 200.
   `conversationMember` guards 11 call sites — including the DM membership check.
2. **Ten models were missing from `schema.mysql.prisma`** (`Block`, `FriendRequest`,
   `Post`, `PostComment`, `PostReaction`, `Poll`, `PollVote`, `Report`, `Conversation`,
   `ConversationMember`). A MySQL deploy would have failed at runtime, not at migrate
   time — `prisma migrate deploy` reports success regardless.
3. **Star was write-only.** `messages/[id]/star` wrote `db.starredMessage`;
   `messages/starred` read `db.messageStar`. Canonicalised on `MessageStar`.
4. **`deploy.sh` migrated from the wrong schema.** It passed
   `prisma/schema.prisma` (SQLite) to `prisma generate`/`migrate deploy` for MySQL;
   only `production-install.sh` performed the `schema.mysql.prisma` swap. Fixed.
5. **CI did not verify the SSH host key** and had no backup or dirty-tree guard.
   All three added.

## Still open

- MySQL acceptance: **BLOCKED** (no mysql, no docker, prisma engines unreachable).
  The migrations parse and execute against SQLite after translation, but have never
  touched MySQL. See `docs/DATABASE_ACCEPTANCE_REPORT.md`.
- Jara real inference: **BLOCKED** — `/api/ai/status` → `configured:false`;
  `/api/jara/chat` returns the canned `fallbackReply`. Confirmed again this pass:
  a request for `17*23` returned the fallback string, not a number.
- Production deploy, public verification, browser E2E: **BLOCKED** (no SSH/CI
  credentials, no browser downloads, no egress to the domain).
