# Test Results — 2026-11-23

Branch `arena/4f5b1aba-friendconnect-alo`. Everything below was executed in this environment.
Categories are kept separate; one is not claimed as another.

## 1. Static gates

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **PASS** — 0 errors |
| ESLint | `npx eslint .` | **PASS** — 0 problems |
| Build | `npx next build` | **PASS** — exit 0 (one expected warning: `@prisma/client` not generated) |
| Prisma validate | `npx prisma validate` | **BLOCKED** — engine download blocked |

## 2. API integration tests (real HTTP, production build, SQLite)

`19/19 pass, 0 fail`. Script: `api-test.sh` (unauthenticated + auth surface).

| Test | Expected | Observed |
|---|---|---|
| `GET /api/health` | 200 | 200 (`degraded` — realtime not started in that run) |
| register | 201 | 201 |
| duplicate register | 409 | 409 |
| Jara impersonation | 403 | 403 |
| weak password | 400 | 400 |
| login, correct password | 200 | 200 |
| **login, wrong password** | **401** | **401** (was 200 — bypass) |
| 10 protected routes, no session | 401 | 401 ×10 |
| `GET /api/metrics`, no auth | **401** | **401** (was 200 — open) |
| `GET /api/jara/health` | 200 | 200, `jara.exists:true` |
| `GET /api/jara/history`, no auth | 401 | 401 |
| `POST /api/setup` | 200 | 200 |

### Authenticated flows (NextAuth credential login)

| Flow | Result |
|---|---|
| `GET /api/auth/me` | 200, correct user |
| `GET /api/friends` | 200, seeded friendships |
| `POST /api/posts` → `GET /api/posts` | 201/200, persisted |
| `POST /api/groups` | 200, caller is OWNER |
| group message / direct message | 200, persisted |
| `GET /api/notifications`, `/api/quota`, `/api/sessions`, `/api/stories` | 200 |
| `GET /api/users/search?q=bilal` | 200 |

## 3. Security regressions (executed)

| Attack | Result |
|---|---|
| wrong password → login | **401** (bypass closed) |
| member removes group OWNER | **403**; member count stayed 2 (was 200, count → 1) |
| member removes self | 200 (correctly allowed) |
| `/api/me` returns TOTP seed | field absent; `hasTwoFactorSecret` only |
| `POST /api/setup` with `[object Promise]` hash | fixed → 200 |
| 2FA: password only | no session |
| 2FA: password + wrong TOTP | no session |
| 2FA: password + valid TOTP | session |
| production boot without `NEXTAUTH_SECRET` | `500` + `NEXTAUTH_SECRET is required in production` |

## 4. Realtime (Socket.IO)

| Step | Result |
|---|---|
| UI login creates Session row | 1 row (was 0) |
| `GET /api/auth/token` | 200 + token (was 404 "No session") |
| socket connect with that token | `auth:ok userId=…` |

Signaling/messaging over the socket behaves, but **media** was not exercised — see §6.

## 5. Jara AI

| Test | Result |
|---|---|
| `GET /api/jara/health` | 200, `jara.exists: true`, config v1 |
| `POST /api/jara/chat` | 200 — **but this was `fallbackReply`, a canned string** |
| `GET /api/ai/status` | `configured: false, provider: "none"` |

**Real inference: NOT VERIFIED.** No provider reachable from this environment.

## 6. Not run — with cause

| Category | Why |
|---|---|
| Browser E2E (Playwright) | Browsers cannot be downloaded (`playwright.azureedge.net` → `000`); none pre-installed |
| Audio/video calls | No browser, camera, mic, or reachable TURN/STUN |
| Bengali voice (STT/TTS) | Browser-native APIs; no browser. Self-hosted models are not present in the repo |
| MySQL | Prisma engine download blocked |
| Public smoke tests | No egress to `panel.alolabs.net` / `learn.aloeducation.com` |
