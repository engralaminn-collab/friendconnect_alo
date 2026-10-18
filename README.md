# FriendConnect

Private social platform: friends, chat, groups, stories, voice/video calls.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- Prisma + MySQL 8
- Socket.IO realtime (`socket-server.js`, port 3003)
- WebRTC (STUN + optional Coturn TURN)
- PM2 + Caddy (Let's Encrypt) or Docker Compose

## Quick start (development)

```bash
cp .env.example .env
npm install
npm run dev          # gateway :3000 → Next :3001 + Socket.IO :3003
```

Local database is SQLite (`DATABASE_URL=file:./db/custom.db`) using `better-sqlite3` — no Prisma engine download required. Production MySQL remains documented in `prisma/schema.mysql.prisma` for hosts that can run `npx prisma generate`.

Optional demo accounts (disabled in production unless `ALLOW_SETUP=true`):

```bash
curl -X POST http://localhost:3000/api/setup
# aria@friendconnect.app / password123 (admin)
```

## Production (Ubuntu)

```bash
sudo ./scripts/production-install.sh
# or, after .env is filled:
./scripts/install.sh
./scripts/deploy.sh
```

Services (PM2):

| Process | Port | Role |
|---|---|---|
| `friendconnect` | 3000 | Next.js |
| `friendconnect-socket` | 3003 | Realtime + scheduled jobs |

Caddy terminates TLS and reverse-proxies `/` → 3000 and `/socket.io` → 3003.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Environment

See `.env.example`. Required in production:

- `DATABASE_URL`
- `APP_DOMAIN` / `APP_ORIGIN`
- `TURN_SECRET` + `TURN_SERVERS` (calls across NATs)
- `VAPID_*` (web push)
- SMTP vars (email verification / password reset)

## Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy.sh` | install, build, migrate, PM2 reload, health |
| `scripts/backup.sh` / `restore.sh` | DB + uploads |
| `scripts/healthcheck.sh` | curl app + socket |
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
