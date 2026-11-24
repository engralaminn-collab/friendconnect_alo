# FriendConnect — Initial Audit Report

Generated: 2026-10-17
Method: full repository inventory (every non-git file), source reading, import/config/schema/script review. No runtime verification yet (dependencies not installed at audit start).

## Inventory (pre-fix)

| Metric | Count | Notes |
|---|---|---|
| Total files (incl. .git, tool-results, backups) | 387 | `find -type f` |
| Total folders | 139 | `find -type d` |
| Source app routes (`src/app/api/**/route.ts`) | 71 | |
| Feature components (`src/components/fc/**`) | 17 TSX | plus shadcn UI kit |
| Prisma models | 20 | User through PushSubscription |
| Docker files | 0 | |
| README | 0 (root) | only coturn/download READMEs |
| `.env.example` | 0 | `.gitignore` also ignores `.env*` so even an example would not be committed |
| `mini-services/realtime` | 0 | documented in worklog, does not exist |
| AI agents | 0 | not in codebase |
| Background job worker | 0 | scheduled messages/reminders have APIs only |

## Empty files

- `/103.231.239.79` (empty junk)
- `/userId` (empty junk)

## Placeholder / junk / backup files

- `src/app/api/files/upload/route.ts.before-buffer-fix-*` (4)
- `src/app/api/friends/online/route.ts.before-array-fix-*` (4)
- `src/components/fc/chat/ChatView.tsx.before-scope-fix-*` (4)
- `src/components/fc/chat/ChatView.tsx.before-peerinfo-fix-*` (1)
- `socket-server.js.auth-fix-bak`
- `prisma/schema.prisma.backup.20260807-222748`
- `prisma/schema.prisma.sqlite.bak`
- `tool-results/` (~90 agent dump files)
- `src/app/api/route.ts` returns `{ message: "Hello, world!" }`
- Health/WebRTC health hardcode `realtime: 'ok'` / `signaling: 'ok'` without probing the process

## Missing files / folders

- Root `README.md`
- `.env.example` (and gitignore blocks `.env*`)
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- `prisma/migrations/migration_lock.toml`
- Real `prisma/migrations/20260807120000_init/migration.sql` (comments only — 5 lines, no DDL)
- `middleware.ts` (Next 16 has `src/proxy.ts` that is a no-op)
- `favicon.ico`
- `logs/`, `backups/` conventions (scripts assume them)
- `mini-services/realtime/` (worklog architecture)
- Ubuntu first-boot docs beyond `scripts/production-install.sh`
- SSL cert files (expected: Caddy auto-TLS — config present but domain placeholder)
- Dedicated monitoring stack (Prometheus/Grafana) — only `/api/metrics` text endpoint
- AI agent runtime
- Background job process (`scripts/restart.sh` references `friendconnect-worker` which is not in `ecosystem.config.cjs`)

## Broken / mismatched architecture

1. **Auth never hydrates.** `src/hooks/use-auth.tsx` has syntax-corrupt type fields (`email: string username: string`) and `useEffect` only calls `refresh()` when `user?.id` is already set. Initial user is always null → splash/login loop; session cookie is ignored.
2. **Password hashing split-brain.** `register`/`login` use SHA-256 (and login also accepts plaintext). `reset-password`, setup seed, and `src/lib/auth.ts` use scrypt `salt:hash`. Demo accounts from `/api/setup` cannot log in through the SHA-256 login route.
3. **Register does not create a session or Profile.** UI then `setView('home')` but `user` is still null.
4. **Login returns session token in JSON** and sets a second `fc_token` cookie. `setSessionCookie` (cookies() API) plus `NextResponse.json` cookie may not compose. No 2FA challenge despite `twoFactorEnabled`.
5. **Logout deletes ALL sessions** for the user (not the current device).
6. **Socket client ≠ socket server.** Frontend emits `message:send`, `call:invite`, `typing`, listens for `message:new`, `onlineUsers`. `socket-server.js` handles `chat:message`, `call:initiate`, emits `online:update`. **Realtime chat and calls cannot work.**
7. **Socket has no authentication.** `auth` event accepts any `userId`. CORS `origin: "*"`.
8. **`SocketProvider` does not accept `userId`**, but `page.tsx` passes it. CallOverlay expects WebRTC state (`callState`, `localStream`, `acceptCall`, …) that the hook does not provide → runtime crash on any call UI.
9. **Dual AuthProvider/SocketProvider** in `layout.tsx` and `page.tsx`.
10. **`.gitignore` ignores `socket-server.js*`** — the realtime server would not be committed/deployed.
11. **`.gitignore` ignores `.env*`** — `.env.example` cannot be committed.
12. **Port mismatch:** `ecosystem.config.cjs` uses 3014 / 3114; Caddy production proxies 3000 / 3003; `REALTIME_PORT = 3003`; `scripts/healthcheck.sh` restarts `friendconnect-app` / `friendconnect-realtime` (different PM2 names).
13. **Upload path hardcoded** to `/home/aloedu/storage/friendconnect` (not `./upload`, not env).
14. **Health check does not probe realtime.** Redis unconfigured marks overall health as degraded (200 vs 503 mix).
15. **`next.config.ts` sets `typescript.ignoreBuildErrors: true`** and `reactStrictMode: false`.
16. **User search is unauthenticated** and returns emails.
17. **`POST /api/setup` is unauthenticated** and creates admin + prints demo passwords.
18. **Forgot-password returns OTP in the JSON body** (and UI displays it). `generateOtp` uses `Math.random`.
19. **`eval('require')`** in `constants.ts`, `cache.ts`, `push.ts` (breaks Edge/bundling, TURN HMAC on client would leak `TURN_SECRET` if that module is imported client-side).
20. **`src/lib/constants.ts` `iceServers()` / `turnCredentials()` imported from client components** — TURN secret risk.
21. **Scheduled messages and reminders have no worker.** They never fire.
22. **Files GET is unauthenticated** (IDOR if IDs leak).
23. **CI runs `bun install --frozen-lockfile` then lint/tsc/build before `prisma generate`** — client may be missing; build uses ignoreBuildErrors.
24. **Worklog claims SQLite + mini-service on 3003;** schema is MySQL; socket is 3114.
25. **No Docker.** Ubuntu scripts assume `/home/aloedu/friendconnect`.
26. **Cookie `fc_session` missing `secure` flag.**
27. **Register auto-sets `emailVerified: true`.**
28. **CallOverlay / ChatView / CallsView** start calls via `fc:start-call` custom event; nothing listens.
29. **PM2 cwd hardcoded** `/home/aloedu/friendconnect`.
30. **Caddy production** only matches `?XTransformPort=3003`, not `/socket.io`.

## Missing dependencies / packages

- `@types/node` not listed (used: `crypto`, `fs`, `path`)
- `bcryptjs` used by `seed-fc.cjs` but not in package.json; seed also writes `isVerified` which is not a schema field
- Unused deps: `next-auth`, `next-intl`, `z-ai-web-dev-sdk`, `@mdxeditor/editor`, `@dnd-kit/*`, `react-markdown`, `react-syntax-highlighter`
- `node_modules` not present at audit time — install not verified

## Missing environment variables (referenced in code, no example)

`DATABASE_URL`, `NODE_ENV`, `PORT`, `HOSTNAME`, `SOCKET_PORT`, `NEXT_PUBLIC_SOCKET_URL`, `REDIS_URL`, `LOG_LEVEL`, `STUN_SERVERS`/`STUN_SERVER`, `TURN_SERVERS`/`TURN_SERVER`, `TURN_USERNAME`, `TURN_PASSWORD`, `TURN_SECRET`, `TURN_REALM`, `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `NEXTAUTH_URL`, `APP_DOMAIN`, `UPLOAD_DIR`, `ALLOW_SETUP`

## Missing configuration

- Env example, Docker, migration lock, real SQL migration, Next security headers, cookie secure, CORS allowlist, rate limits on auth, CSRF beyond SameSite=lax

## Missing APIs / backend routes (claimed vs present)

Present: auth, 2fa, admin, broadcasts, calls, email, files, friends, groups, health, messages*, metrics, notifications, push, quota, sessions, setup, stories, users, verify, webrtc.

Missing relative to docs/scripts:
- No `/api/jobs` or worker
- No authenticated file ACL
- No 2FA login completion route
- Socket events documented in worklog are not implemented on the server

## Missing frontend pages

SPA on `/` only. No `/admin` route — AdminView is a component. No dedicated legal/privacy pages. No offline page besides SW fallback to `/`.

## Database

- 20 models in `schema.prisma` (MySQL)
- Migration SQL empty → `prisma migrate deploy` applies nothing
- Local `db/custom.db` is SQLite leftover; schema is MySQL
- `schema.sqlite.prisma` lags (missing `User.phone`)

## Auth / authorization / validation / security

| Area | Status |
|---|---|
| Session cookie httpOnly | Partial (`fc_session` yes, login also sets `fc_token`) |
| Secure cookie | Missing |
| Password policy | 6 chars only |
| Rate limiting helper exists | Not applied to login/register/forgot |
| 2FA login gate | Missing |
| Admin checks | Present on analytics/audit |
| User search | No auth |
| Setup seed | No auth |
| OTP in response | Yes (insecure) |
| CORS on socket | `*` |
| Socket auth | None |
| File IDOR | Yes |
| CSP | Only in Caddyfile.production, not in Next |
| XSS | React default; `dangerouslySetInnerHTML` for SW script |
| SQL | Prisma parameterized |
| TURN secret on client bundle | Risk |

## Deployment / Docker / Ubuntu / PM2 / Caddy / SSL

- Scripts exist under `scripts/` and `coturn/`
- No Docker
- PM2 names disagree across files
- Caddy production has Let's Encrypt via site address; domain placeholder `friendconnect.example.com`
- Backup script exists; restore exists; worker missing
- CI deploy SSH on main only

## Monitoring / logging

- `src/lib/logger.ts` JSON logs
- `/api/metrics` Prometheus text
- `/api/health` incomplete
- No log rotation config beyond PM2 files
- Healthcheck restarts wrong process names

## Documentation

- `docs/ENTERPRISE.md` outdated (SQLite, port 3003 mini-service)
- `docs/CALL_TEST_PROCEDURE.md`, `REAL_PHONE_CALL_TEST.md`
- No root README
- `worklog.md` ~279KB handover, contradicts current tree

## Errors (static; not yet executed)

- TypeScript: `use-auth.tsx` invalid syntax; CallOverlay extra hook fields; SocketProvider extra prop
- ESLint: not run (node_modules missing)
- Build: `ignoreBuildErrors: true` hides failures
- Runtime: auth hydration, hashing, sockets, calls
- Database: empty migration
- Docker/Ubuntu/PM2/Caddy: unverified; config internally inconsistent

## Production-ready?

**No.** Core login, registration session, realtime messaging, and WebRTC signaling are not connected end-to-end. Migrations are empty. Secrets/env/Docker/README missing. Do not deploy as-is.

---

Fixes in this session start after this report.
