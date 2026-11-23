# Jara AI — Deployment & Rollback

**Date:** 2026-11-23  
**Scope:** Additive Jara Phase A/P0 changes on existing FriendConnect ALO. No destructive DB operations.

## Pre-Deployment Checklist

1. Verify correct repo/project/domain and current production deployment.
2. Inspect env vars without exposing values (`NEXTAUTH_SECRET`, DB, TURN, SMTP, VAPID, AI provider, future LiveKit/SMS/meeting creds).
3. Backup DB and uploads.
4. Review schema diff (`prisma/schema.prisma`) and generated migration SQL before production apply.
5. Confirm Prisma engines available in build/CI environment.
6. Run validation in a proper environment:

```bash
npm install
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm run build
# run project tests that actually exist
```

7. For **development DB only**, after backup/review: `npx prisma db push`.
8. For **production**, prefer reviewed Prisma migrations; do not run unreviewed `db push`.

## Deploy (existing stack)

- Use existing PM2/Caddy/Docker scripts as configured by the repo.
- Restart app/socket/turn services as needed: `pm2 restart friendconnect friendconnect-socket friendconnect-turn` (only if those processes are used in target env).
- Verify:
  - `GET /api/health`
  - `GET /api/jara/health`
  - `GET /api/jara/config`
  - Auth/login/session
  - Existing chat/call flows
  - WebSocket connectivity
  - Emergency disable endpoint (Super Admin only)

## Feature Flags / Safe Defaults

- `JaraConfig.isEnabled` defaults true but can be emergency-disabled.
- SMS/calls/meetings flags default conservative (`smsEnabled=false`, `meetingsEnabled=false`).
- No SMS provider delivery is active unless configured.
- No meeting integration is active unless configured.
- Avatar rendering is fallback canvas unless a real renderer worker is integrated.

## Rollback

### Application rollback
- Record previous stable commit/SHA before deploy.
- Revert to previous release/commit and rebuild/restart services.
- Keep user data intact.

### Database rollback
- Schema changes are additive. Prefer forward-fix.
- If reversal required, restore from backup or use reviewed reverse migration. Do not blindly drop columns/tables.
- Temporary presentation records can be expired/cancelled by authorized admin process.

### Emergency response
- Disable Jara via `POST /api/jara/emergency` (Super Admin, audited).
- Stop unsafe sessions/calls; preserve audit logs.
- Mark temporary `JaraCallPresentation` rows expired/cancelled through authorized process.

## Known Blockers Before Claiming "Real Digital Human"

- Real avatar renderer (MuseTalk/LivePortrait/LiveKit avatar) + GPU worker.
- Server-side Bangla ASR/TTS.
- LiveKit room/token/avatar video publishing.
- SMS provider webhooks/delivery.
- Authorized meeting integrations.
- Automated end-to-end tests for concurrent calls, lip-sync, voice quality.