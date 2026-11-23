# Security Audit — FriendConnect + Jara AI

**Last verified:** 2026-11-23 against a production build (`next build` → `.next/standalone/server.js`, SQLite runtime) on port 3007, plus a live `socket-server.js` on 3103.
**Branch:** `arena/4f5b1aba-friendconnect-alo`

> **This document describes what was measured, not what was intended.** An earlier
> revision rated Authentication "PASS (bcrypt 10 rounds, session guard on all routes)"
> while a full authentication bypass was live. Do not trust a status here without the
> evidence column.

## Status summary

| Area | Status | Evidence |
|---|---|---|
| Password auth (login) | **PASS** | Wrong password → `401`. Was: `200 {"success":true}` for any password. |
| Password hashing writes | **PASS** | `setup` → `200`; previously `500 SQLite3 can only bind…` from writing `[object Promise]` |
| 2FA on UI login path | **PASS** | password-only → no session; wrong TOTP → no session; valid TOTP → session |
| 2FA disable re-auth | **PASS** | requires correct password (was: any string worked) |
| NextAuth secret | **PASS** | production without `NEXTAUTH_SECRET` → `500` + explicit error (was: silent dev fallback) |
| Realtime (Socket.IO) auth | **PASS** | Session row created → `/api/auth/token` `200` → socket emits `auth:ok`. Was: `404 "No session"`, i.e. non-functional. |
| Group membership authz | **PASS** | member removing OWNER → `403`; self-leave → `200`. Was: `200`, owner ejected. |
| TOTP seed exposure | **PASS** | `/api/me` no longer returns `twoFactorSecret` |
| Metrics endpoint | **PASS** | no auth `401`, wrong bearer `401`, correct bearer `200` |
| User search PII | **PASS** | email removed from the `OR` clause (was an enumeration oracle) |
| Session cookie flags | **PARTIAL** | `httpOnly`, `sameSite=lax`, `Secure` in production now set; full session-management UI still JWT-only |
| E2EE | **NOT IMPLEMENTED** | `src/lib/e2ee.ts` exists but `useE2EE` is imported by nothing; messages are stored in plaintext. UI copy calling this "encrypted" is inaccurate. |
| TURN relay / cross-network calls | **UNVERIFIED** | `node-turn` is not in `package.json`; no browser/network available to test |
| MySQL / Prisma path | **UNVERIFIED** | Prisma engine download blocked in the build sandbox; only the SQLite runtime was executed |
| Migration history vs schema | **FAIL** | init migration creates 23 tables; `schema.prisma` declares 40. See DATABASE_ACCEPTANCE_REPORT.md |

## Reproduced exploit → fix → verification

### 1. Authentication bypass (critical)
`src/app/api/auth/login/route.ts` called the async `verifyPassword()` without `await`.
A pending Promise is always truthy, so `!verifyPassword(...)` was always `false`.

```
# before
POST /api/auth/login {"identifier":"alice","password":"WRONG-PASSWORD-xyz"}
→ 200 {"success":true,...}
# after
→ 401 {"error":"Invalid username/email or password"}
```

### 2. Group membership IDOR (high)
`DELETE /api/groups/[id]/members?userId=` had no membership and no role check.
A plain member removed the group OWNER (member count 2 → 1, response `200`).
Now: membership required, `OWNER`/`ADMIN` required to remove others, owner unremovable,
voluntary leave still permitted.

### 3. Realtime authentication non-functional (high, functional not just security)
A NextAuth login created **0** Session rows, so `/api/auth/token` returned `404 "No session"`;
the HMAC `ws-token` path was also dead because `socket-server.js` never verifies it.
Root cause of the silent failure: the SQLite `Session` table lacked `sessionToken`, the insert
threw, and an empty `catch` swallowed it.

```
# after
Session rows: 1
/api/auth/token → 200 {"token":"137716f8d3…"}
socket → auth:ok userId=cmwt83e3y7d6156ceea33fc78   # REALTIME AUTH WORKS
```

## Open items (not fixed — require product decisions)

- `/api/auth/login` and the NextAuth path still duplicate policy (rate limit + audit live only on the former). Consolidate.
- 55 routes return raw `e.message` to the client on 500.
- `upload/` contains two committed runtime PNGs.
- `mini-services/chat-service` duplicates `socket-server.js`; it is excluded from the app tsconfig but still ships in `deploy/docker-compose.yml`.
