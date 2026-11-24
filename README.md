# FriendConnect

Private social platform: friends, chat, groups, stories, voice/video calls.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | processes, request/authorization flow, database layer, schema pipeline, files, realtime |
| [`docs/TESTING.md`](docs/TESTING.md) | every test suite, what it proves, what is verified in CI only |
| [`docs/REMEDIATION_REPORT.md`](docs/REMEDIATION_REPORT.md) | the 17 review findings: what was wrong, what changed, how it is proven, residual risks |
| [`docs/DEPLOYMENT_AND_RECOVERY.md`](docs/DEPLOYMENT_AND_RECOVERY.md) | deploy, backup, restore, rollback |
| [`docs/archive/`](docs/archive/README.md) | superseded audits and build history — **not** current behaviour |

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- Prisma + MySQL 8
- Socket.IO realtime (`socket-server.js`, port 3003)
- WebRTC (STUN + optional Coturn TURN)
- PM2 + Caddy (Let's Encrypt) or Docker Compose

## Quick start (development)

```bash
cp .env.example .env
npm ci
npm run dev          # Next.js only, directly on http://localhost:3000
```

`npm run dev` does **not** start a gateway or Socket.IO server. For the full local stack,
run `npm run dev:all`: it starts Next.js on `:3001`, Socket.IO on `:3003`, and the same-origin
gateway on `:3000` (plus the repository's local mail sink and TURN helper). Use the gateway URL
for the app so browser requests and realtime traffic share one origin. `scripts/dev-all.cjs` is the
source of truth for this orchestration; stop it with Ctrl-C.

Local SQLite uses `DATABASE_URL` from `.env.example` and the runtime creates its local database
under `db/`. Keep development data isolated from any production database. The runtime initializes
SQLite tables on startup. If you intentionally change the local Prisma schema, back up your local
database first, then use `npx prisma db push --schema prisma/schema.prisma` against that local URL.
`npm run db:migrate` invokes Prisma's development migration workflow; use it only with a disposable
local database and after confirming the checked-in migration history matches the selected schema.
Never run either command against production as part of local setup.

Validation commands (use a disposable local database and a non-production secret; `npm test`
builds the app before its end-to-end security tests):

```bash
export DATABASE_URL='file:./db/security-test-build.db'
export NEXTAUTH_SECRET='local-only-test-secret-not-for-deployment'
npm test
npm run lint
npm run typecheck
node --check socket-server.js
```

`npm run test:integration` alone expects a completed standalone production build. Its HTTP/socket
regression tests create a separate temporary SQLite database and private upload directory, then
remove them when finished. Never use production database credentials or production services for
these checks.

Database is chosen by `DATABASE_URL`:

- `file:./db/custom.db` → SQLite via `better-sqlite3` (local/dev, no Prisma engine needed).
- `mysql://user:pass@127.0.0.1:3306/db` → MySQL 8 through Prisma Client + `@prisma/adapter-mariadb`
  (run `npx prisma generate` and `npx prisma migrate deploy` first; `scripts/deploy.sh` does both).
  Copy existing SQLite data with `node scripts/sqlite-to-mysql.cjs path/to/custom.db`.

Optional demo accounts (disabled in production unless `ALLOW_SETUP=true`):

```bash
curl -X POST http://localhost:3000/api/setup
# aria@friendconnect.app / password123 (admin)
```

## Production (Ubuntu)

Step-by-step guide for learn.aloeducation.com (MySQL, PM2, Caddy):
[docs/DEPLOY_LEARN_ALOEDUCATION.md](docs/DEPLOY_LEARN_ALOEDUCATION.md).

```bash
sudo ./scripts/production-install.sh
# or, after .env is filled:
./scripts/install.sh
./scripts/deploy.sh
```

Services (PM2):

| Process | Port | Role |
|---|---|---|
| `friendconnect` | `PORT` (3000) | Next.js |
| `friendconnect-socket` | `SOCKET_PORT` (3003) | Realtime + scheduled jobs |
| `friendconnect-turn` | `TURN_PORT` (3478/udp) | TURN relay for calls (`TURN_ENABLED=false` to skip) |

Ports and all settings come from `.env` (`ecosystem.config.cjs` passes it to every process).
Caddy terminates TLS and reverse-proxies `/` → `PORT` and `/socket.io` → `SOCKET_PORT`.
The provided PM2 configuration runs one socket-server process. Its local event limiter is only
process-wide; configure `REDIS_URL` when running multiple app/socket instances so both rate limits
and Socket.IO rooms are shared. Do not scale the realtime service horizontally without Redis.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## AI capabilities and limitations

The AI architecture, provider paths, memory status, agent boundaries, configuration variable names,
security observations, and development roadmap are documented in
[docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md). Current chat providers and browser voice fallbacks
must be configured and tested in the target environment; status metadata is not a provider health
check. Jara does not currently provide general-purpose model tool calling or autonomous task execution.

## Environment

See `.env.example`. Required in production:

- `DATABASE_URL`
- `NEXTAUTH_SECRET` — **the app will not serve auth routes in production without it**
  (`openssl rand -base64 32`). It signs both session JWTs and WebSocket tokens.
- `APP_DOMAIN` / `APP_ORIGIN` / `NEXTAUTH_URL`
- `TURN_SECRET` + `TURN_SERVERS` (calls across NATs)
- `VAPID_*` (web push)
- SMTP vars (email verification / password reset)
- `METRICS_TOKEN` (optional) — bearer token for scraping `/api/metrics`;
  without it the endpoint requires an admin session.

Deployment to the confirmed target, and the access it requires:
[docs/DEPLOY_PANEL_ALOLABS.md](docs/DEPLOY_PANEL_ALOLABS.md).

## Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy.sh` | install, build, migrate, PM2 reload, health |
| `scripts/backup.sh` / `restore.sh` | DB + uploads |
| `scripts/healthcheck.sh` | curl app + socket |
| `scripts/backfill-file-access.cjs` | re-derive `FileAccess` grants for existing data (idempotent) |
| `coturn/install.sh` | TURN server |

## Calls / images not working? Checklist

1. **Use HTTPS.** Browsers block the camera and microphone on `http://<ip>` pages, so calls and
   voice notes cannot work there. Point a domain at the server and use Caddy (`Caddyfile.production`).
   The app now shows a clear message instead of failing silently.
2. **TURN for different networks.** Calls between mobile data and WiFi need a relay. Set
   `TURN_EXTERNAL_IP=<server public ip>` (bundled node-turn) or install Coturn, and open UDP `3478`
   plus `49152-65535` in the firewall.
3. **Restart both processes after deploys:** `pm2 restart friendconnect friendconnect-socket friendconnect-turn`.
   Check `GET /api/webrtc/health` and `GET :3003/health`.

## Health

- `GET /api/health`
- `GET /api/metrics` (Prometheus)
- `GET /api/webrtc/health`
- `GET :3003/health`

## License

Private. All rights reserved.
