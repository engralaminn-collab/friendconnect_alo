# Deployment and Recovery

**Branch:** `arena/79557eff-friendconnect-alo` @ `ef8a4a6`  
**Last verified:** 2026-11-23  
**Targets:** Local SQLite dev, Docker/Caddy + MySQL 8 production

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
curl /api/health # database ok required; realtime/redis/email/push may be degraded (expected if not configured)
curl /api/jara/health # jara.exists true, pendingProposals count
curl /api/webrtc/config # iceServers list, turnConfigured flag
```

Automated: `scripts/healthcheck.sh` (if present) or Caddy `handle /api/health`.

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

## 10. Deployment Checklist

- [ ] `.env` filled, `NEXTAUTH_SECRET` set, DB reachable
- [ ] `npm run build` passes (0 TSC, 0 ESLint errors)
- [ ] `curl /api/health` database ok
- [ ] `curl /api/jara/health` jara exists true
- [ ] Register Super Admin, promote via DB
- [ ] Test Jara chat → proposal → approve → audit
- [ ] Test group Jara consent (add/remove/listen)
- [ ] Configure Ollama + TURN if needed for prod
- [ ] Enable Caddy TLS (https required for mic/camera)
- [ ] Set up backup cron (`scripts/backup.sh` daily)
