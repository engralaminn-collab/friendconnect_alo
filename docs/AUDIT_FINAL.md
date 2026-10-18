# FriendConnect — Post-fix verification (2026-10-18)

## Verified in this environment

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx eslint` (touched files) | PASS |
| Gateway `GET /api/health` | healthy: database, realtime, **redis, email**, push all `ok` |
| Redis 7.2.7 (`vendor/redis-server`) | PING PONG; socket.io redis adapter enabled |
| SMTP sink `:1025` | `POST /api/auth/forgot` wrote `logs/mail/*.eml` (reset code delivered locally) |
| Local TLS `https://127.0.0.1:3443/api/health` | PASS (`curl -k`, self-signed CN=localhost) |
| Login `aria@friendconnect.app` | PASS |
| `GET /api/users/search?q=dana` | PASS — `relation: "NONE"` |
| Socket.IO redis adapter | log: `[socket] redis adapter enabled` |
| `GET /api/webrtc/health` | healthy, `turn: ok`, `redis: ok`, `email: ok` |
| node-turn UDP 3478 | STUN Binding Success (earlier this session) |

## Product copy (welcome pillars)

- Find friends — Friends screen title + name/username search
- Private chat — lock banner (“encrypted-feel realtime”)
- Voice & video — Calls screen + overlay copy
- Auth + Home hero use the same private-space copy

## Still missing / not working / not verified

- **Docker image build** — no `docker` binary; Debian apt is blocked. Compose/Dockerfile exist, **image not built**.
- **Public TLS / Let's Encrypt** — only local self-signed on `:3443`. Caddy production file is present; no public domain in this sandbox.
- **Cross-network WebRTC** — TURN is `turn:127.0.0.1:3478` (UDP). Arena HTTP preview does not forward UDP. Production needs a public TURN IP in `TURN_SERVERS`.
- **Internet SMTP** — local sink only (`127.0.0.1:1025`), not Gmail/SES/SendGrid.
- **Prisma engines** — `binaries.prisma.sh` blocked; sqlite `db-runtime.js` is the live path.
- **E2E encryption** — UI says “encrypted-feel”; messages are **not** client-side E2E crypto.
- **AI agents** — none in this product.

Production-ready: **No** (public TURN, public TLS, Docker image, internet SMTP still outstanding).
