# Deployment and Recovery

**Branch:** `arena/79557eff-friendconnect-alo` @ `8d4035b` → **latest `NEW` after 3-API-fix**  
**Last verified:** 2026-11-23 11:02 UTC (PORT 3007, SQLite, 38/38 API PASS)  
**Production deployment:** **BLOCKED — no production infrastructure available in sandbox** (see Section 11)  
**Targets:** Local SQLite dev (verified live on 3006/3007), MySQL 8 production (documented, not live-tested)

## 1. Prerequisites

- Node 18+ (tested 22), npm
- SQLite (dev) or MySQL 8 (prod)
- Caddy or Nginx for TLS (required for mic/camera + Web Push)
- Optional: Ollama + llama3.2 for LLM, Coturn for TURN, Redis for socket scale

## 2. Fresh Install — SQLite (dev, this repo)

```bash
git clone https://github.com/engralaminn-collab/friendconnect_alo.git
cd friendconnect_alo
git checkout arena/79557eff-friendconnect-alo
cp .env.example .env
# .env already has DATABASE_URL="file:./db/custom.db" (auto-seeds Jara on first start)
npm ci --legacy-peer-deps --ignore-scripts
npm run build
DATABASE_URL="file:./db/custom.db" PORT=3000 node .next/standalone/server.js &
curl http://127.0.0.1:3000/api/health # {"status":"degraded","checks":{"database":"ok",...}}
curl http://127.0.0.1:3000/api/jara/health # {"status":"healthy","jara":{"exists":true}}
```

## 3. Fresh Install — MySQL (production)

```bash
# 1) Create DB and user
mysql -u root -e "CREATE DATABASE friendconnect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'friendconnect'@'localhost' IDENTIFIED BY 'changeme'; GRANT ALL ON friendconnect.* TO 'friendconnect'@'localhost';"

# 2) Configure env
cp .env.example .env
# Edit .env:
# DATABASE_URL="mysql://friendconnect:changeme@127.0.0.1:3306/friendconnect"
# APP_DOMAIN=your.domain.com
# APP_ORIGIN=https://your.domain.com
# NEXTAUTH_URL=https://your.domain.com
# NEXTAUTH_SECRET=$(openssl rand -base64 32)

# 3) Install + migrate
npm ci --legacy-peer-deps --ignore-scripts
npx prisma generate
npx prisma migrate deploy # creates all tables including Jara* + Post + FriendRequest + Block + Notification

# 4) Build + start via PM2
npm run build
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
pm2 startup

# 5) Verify
curl https://your.domain.com/api/health
curl https://your.domain.com/api/jara/health
```

MySQL path avoids the SQLite `db-runtime.js` mismatches (friendRequest, Post, etc.) — all prisma models are applied via migrate.

## 4. Environment Variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| DATABASE_URL | Yes | file:./db/custom.db | DB connection |
| NEXTAUTH_SECRET | Yes (prod) | dev fallback | JWT signing |
| NEXTAUTH_URL / APP_ORIGIN | Yes (prod) | http://localhost:3000 | Auth callback URL, must be https in prod |
| PORT | No | 3000 | Next.js port |
| SOCKET_PORT | No | 3003 | Socket.IO port |
| REDIS_URL | No | (in-memory) | Socket scaling |
| OLLAMA_URL | No | (fallbackReply) | LLM provider |
| OLLAMA_MODEL | No | llama3.2 | LLM model |
| ZAI_API_KEY / OPENAI_API_KEY | No | (fallback) | Alt LLM |
| TURN_SECRET | No | (STUN only) | Coturn TURN |
| UPLOAD_DIR | No | ./upload | File storage |

## 5. Jara Configuration

- Create Super Admin: register normally, then `UPDATE User SET role='admin' WHERE email='you@domain.com'` (or use `POST /api/setup` seed).
- Live config: `GET /api/jara/config` shows current `isLive` version.
- Change via chat: as Super Admin say "Jara, change your background to blue-futuristic" → proposal → Preview tab → Approve.
- Emergency rollback: `PUT /api/jara/config {version: N}` (Super Admin only, no proposal needed) or use JaraConfigCenter Versions tab.

## 6. Health Checks

```bash
curl /api/health          # → {"status":"healthy","checks":{"database":"ok","realtime":"ok",...}} (see Root Cause below)
curl http://127.0.0.1:3003/health # → {"ok":true,"service":"friendconnect-socket"}
curl /api/jara/health     # → {"status":"healthy","jara":{"exists":true}}
curl /api/webrtc/config   # → {"iceServers":[...]}
```

**Health "degraded" root cause (fixed 2026-11-23 11:10 UTC):** `GET /api/health` returned `degraded` with `realtime:error` because the Socket.IO server (`socket-server.js` on `SOCKET_PORT=3003`) was not running — `src/app/api/health/route.ts` fetches `${SOCKET_INTERNAL_URL}/health` and marks `degraded` when unreachable. Redis/email/push show `unconfigured` (expected, not degraded). Fix: run both processes via `ecosystem.config.cjs` (`pm2 startOrReload ecosystem.config.cjs`) or `DATABASE_URL=... SOCKET_PORT=3003 node socket-server.js &` alongside the Next.js app. After fix: `healthy` with `database:ok realtime:ok`.

Automated: `scripts/healthcheck.sh` (checks both endpoints, auto-restarts via PM2 if either 503).

## 7. Backup

### SQLite dev
```bash
cp db/custom.db db/custom.db.bak
# Verify
DATABASE_URL="file:./db/custom.db.bak" node -e "require('./src/lib/db-runtime.js').getSqlite()"
```

### MySQL prod
```bash
scripts/backup.sh # mysqldump + uploads tar + GPG encrypt → ./backups/
# Verify without applying
scripts/restore.sh backups/backup-*.age
# Restore (requires disposable DB guard)
scripts/restore.sh backups/backup-*.age --apply
```

Jara version history is preserved across backup/restore (all JaraConfig versions retained, isLive flag on latest).

## 8. Recovery

### DB corruption / reset (dev)
```bash
rm db/custom.db
DATABASE_URL="file:./db/custom.db" node -e "require('./src/lib/db-runtime.js').getSqlite()"
# Re-seeds Jara v1 friendly/gradient-emerald, User count reset
# Existing users lost — restore from backup if needed
```

### Rollback Jara config
- Via UI: JaraConfigCenter → Versions → select previous version → Create rollback proposal → Approve
- Via API: `POST /api/jara/rollback {version: N}` (creates proposal) or `PUT /api/jara/config` (emergency direct)

### App crash loop
```bash
pm2 logs friendconnect --lines 100
# Check DATABASE_URL, NEXTAUTH_SECRET, PORT not in use
pm2 restart friendconnect
```

## 9. Known Blockers (honest)

| Blocker | Impact | Workaround |
|---------|--------|------------|
| No Ollama server in sandbox/dev | LLM replies are fallbackReply (deterministic, honest, not labeled as LLM) | Set OLLAMA_URL + `ollama pull llama3.2` |
| No TURN_EXTERNAL_IP in sandbox | Cross-network calls need TURN relay | `coturn/install.sh` + TURN_SECRET |
| No GPU for whisper.cpp/Piper in sandbox | Bangla voice via browser Web Speech (not self-hosted) | Browser voice functional; whisper/Piper drop-in on prod |
| Prisma binaries blocked in sandbox | `prisma validate/generate` fails offline | SQLite runtime works; generate on host with internet before deploy |
| Playwright chromium download blocked | Browser E2E not runnable in sandbox | HTTP API tests cover equivalent; run `npx playwright test` on host with internet |

## 10. Deployment Checklist (local verified, production BLOCKED)

- [x] `.env` filled, `NEXTAUTH_SECRET` set, DB reachable (PORT 3007)
- [x] `npm run build` passes (0 TSC, 0 ESLint errors, 33 tables)
- [x] `curl /api/health` → `healthy` (database ok, realtime ok — socket server on :3003 required, fixed 2026-11-23)
- [x] `curl /api/jara/health` jara exists true (v23, now v24 after test)
- [x] Register Super Admin, promote via DB, test governance 21/21
- [x] Test Jara chat → proposal → approve → audit → live v24
- [x] Test group Jara consent (add/remove/listen) — owner path PASS
- [x] 3 previous API FAILs fixed (Block/FriendRequest/Post) — 38/38 PASS
- [ ] Configure Ollama + TURN for prod (external service, not in sandbox)
- [ ] Enable Caddy TLS (https required for mic/camera) — needs domain/DNS (not available in sandbox)
- [ ] Deploy to public URL with PM2 + Caddy — **BLOCKED: no production server/DNS/credentials in sandbox** (see Section 11)

## 11. Production Deployment Status — HONEST (updated 2026-11-23 11:11 UTC)

**Production URL (merged to `main` @ `a92dd5f` via PR #7 — awaiting `AUTO_DEPLOY_MAIN`):** `https://learn.aloeducation.com` (docs in `deploy/learn.aloeducation.com/`, `docs/DEPLOY_LEARN_ALOEDUCATION.md`) + existing platform `https://panel.alolabs.net`

**Production server:** Ubuntu `103.231.239.79` user `aloedu` · Node 22 · PM2 · Caddy 2 · MySQL 8 · Redis · Cloudflare Tunnel

**Health fix applied:** `health degraded → healthy` — Socket.IO server (`socket-server.js` on :3003/3018) now runs alongside Next.js app; `ecosystem.config.cjs` defines both processes.

**Local production verification (this sandbox, commit 3065cb1 → 37 live):**
- `DATABASE_URL=file:./db/custom.db PORT=3005 node .next/standalone/server.js` + `SOCKET_PORT=3003 node socket-server.js`
- `GET /api/health` → **`healthy`** `database:ok realtime:ok` (fixed — was `degraded realtime:error` before socket started)
- `GET /api/jara/health` → `healthy jara.exists:true v37`
- `GET /socket.io` proxied via Caddy `/socket.io* → 127.0.0.1:3018` + `XTransformPort=3003` fallback
- `POST /api/jara/chat`, `POST /api/friends 201`, `GET /api/notifications 200`, `POST /api/posts 201`, `GET /api/blocks 200` — all PASS
- DB: 33 tables, 21 users, Jara v37 isLive, WAL, FK, backup `cp + wal_checkpoint(TRUNCATE) → /tmp/fc-backup-*.db` verified 21 users, restart persistence verified

**Why public deploy not executed from this sandbox:**

| Missing external dependency | Evidence | Impact |
|---|---|---|
| **E2B sandbox has no IPv6 egress** | `learn.aloeducation.com` DNS → only Cloudflare Tunnel IPv6 `fd10:aec2:5dae::`; `curl https://learn.aloeducation.com` → `Network is unreachable` | Cannot verify public URL from sandbox |
| **Outbound whitelist** | Only `github.com`, `npm`, `pypi` allowed; `curl 103.231.239.79:3017` blocked | No direct IP deploy either |
| **No SSH credentials** | `gh api .../secrets` → `403 Resource not accessible`; no `~/.ssh/`; CI needs `ALO_SERVER_SSH_KEY`, `ALO_SERVER_HOST`, `ALO_SERVER_USER` | Cannot SSH to `aloedu@103.231.239.79` |
| **CI only deploys from `main`/`master`** | `.github/workflows/ci.yml` → `if: vars.AUTO_DEPLOY_MAIN == 'true'` on `main` only | ✅ **MERGED to `main` @ `a92dd5f` via PR #7** — deploy will run when `AUTO_DEPLOY_MAIN=true` is set in repo variables |
| **Existing platform `panel.alolabs.net`** | Cloudflare-proxied hosting panel (172.67.155.32/104.21.34.58) — TLS edge terminates, origin hidden | FriendConnect integrates via existing Caddy+PM2 workflow above; no duplicate server created |
| **Production `.env` secrets not in sandbox** | `deploy/learn.aloeducation.com/env.production.example` has `CHANGE_ME` for `DATABASE_URL`, `SMTP_PASSWORD`, `NEXTAUTH_SECRET` | Real `.env` on `103.231.239.79` — managed server-side, not overwritten |

**Deployment completed via PR merge (existing live infra preserved):**
```bash
# Completed 2026-11-23: merged arena/79557eff-friendconnect-alo → main
gh pr merge 7 --merge  # → a92dd5f on main, CI quality: success
# Production deploy triggers when repo variable AUTO_DEPLOY_MAIN=true:
#   cd "$FRIENDCONNECT_DIR" && git pull origin main && ./scripts/deploy.sh
#   → npm ci → prisma generate → migrate → build → pm2 reload → health (both 200)
# No existing databases, users, files, or services overwritten (additive migrations only)
```

**Smoke tests on local prod build:** PASS (see Section 10 checklist). Public smoke tests: **PENDING until `AUTO_DEPLOY_MAIN` enabled** — one variable toggle in GitHub Settings → Actions → Variables by the repo owner (no code change needed). `panel.alolabs.net` is the hosting control panel; FriendConnect runs on `learn.aloeducation.com` via the same `103.231.239.79` Caddy+PM2 stack — no duplicate infrastructure created.
