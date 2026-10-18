# FriendConnect — Production notes

## Architecture

- **Frontend/API**: Next.js 16 App Router on port 3000
- **Database**: MySQL 8 via Prisma (`prisma/schema.prisma`)
- **Realtime**: `socket-server.js` on port 3003 (session-authenticated Socket.IO)
- **Calls**: WebRTC; ICE from `GET /api/webrtc/config` (TURN credentials never shipped in the client bundle)
- **Files**: `UPLOAD_DIR` (default `./upload`) or S3
- **Auth**: scrypt password hashes, httpOnly `fc_session` cookie, optional TOTP 2FA
- **Jobs**: scheduled messages + reminders run inside the socket process (30s interval)

## Security

- Rate limits on login / register / forgot / upload
- Setup seed disabled in production unless `ALLOW_SETUP=true`
- User search requires a session and does not return emails
- File download requires a session
- Socket.IO rejects connections without a valid session token
- Security headers via Next + Caddy

## Ops

See root `README.md`, `.env.example`, `docker-compose.yml`, `Caddyfile.production`, and `scripts/`.
