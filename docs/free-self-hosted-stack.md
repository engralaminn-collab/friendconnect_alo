# FriendConnect — Free self-hosted alternative to MirrorFly

MirrorFly is a paid/enterprise chat SDK (pricing is "contact sales"). This document
maps every MirrorFly feature to its **free, open-source, self-hostable** equivalent
that ships with FriendConnect's `deploy/docker-compose.yml`.

## Stack comparison

| Component | MirrorFly (paid) | FriendConnect (free) |
|---|---|---|
| Chat SDK / server | Proprietary | Next.js + Socket.IO (BSD-2-Clause) |
| Database | Proprietary schema | PostgreSQL (PostgreSQL License) |
| Cache / presence | Proprietary | Redis (RSsv2v/SSPL — free for self-host) |
| Object storage | Proprietary or S3 | MinIO (AGPL-3.0 — free for self-host) |
| SMTP / email | Proprietary or paid provider | Mailpit (dev) / any SMTP (prod) |
| TURN/STUN (WebRTC) | Proprietary | coturn (BSD-3-Clause) |
| Auth | Proprietary or NextAuth | NextAuth.js (ISC) |
| Real-time transport | Proprietary | Socket.IO (MIT) |
| Frontend UI kit | Proprietary UI kits | shadcn/ui (MIT) + Tailwind (MIT) |
| Push notifications | Proprietary FCM/APNs bridge | Web Push (VAPID, free) + FCM/APNs (free tiers) |

## Feature parity matrix

### Chat / messaging
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| One-to-one chat | Built | Socket.IO + Prisma |
| Group chat | Built | Conversation model with members |
| Channels / communities | Roadmap | Conversation model already supports `type: "channel"` |
| Typing indicators | Built | Per-conversation timeout Map |
| Read receipts | Built | `MessageRead` model + socket events |
| Delivery receipts | Built | `reads` array on Message |
| Message reactions | Built | `MessageReaction` model |
| Reply / quote | Built | `replyToId` on Message |
| Edit / delete | Built | `editedAt`, `deletedForAll` |
| Starred messages | Built | `StarredMessage` model |
| Message search | Built | `/api/conversations/[id]/messages/search` |
| Attachments | Built | MinIO S3 + magic-byte validation |
| Scheduled messages | Roadmap | Outbox pattern, cron worker |
| Disappearing messages | Roadmap | TTL field + cleanup job |
| Mentions | Roadmap | Parse `@username` in content |
| Polls | Roadmap | New `Poll` model |

### Voice / video calls
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| One-to-one voice calls | Roadmap | WebRTC + coturn (TURN already in compose) |
| One-to-one video calls | Roadmap | WebRTC + coturn |
| Group calls | Roadmap | LiveKit OSS SFU (Apache-2.0) — add to compose |
| Screen sharing | Roadmap | WebRTC `getDisplayMedia` |
| Call recording | Roadmap | MediaRecorder API + MinIO storage |
| Call history | Roadmap | `Call` model already in original spec |

**To add calls:** add LiveKit to `docker-compose.yml` and wire up the WebRTC
flow. coturn is already configured for ICE traversal.

### Live streaming
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| RTMP ingest | Roadmap | MediaMTX (MIT) |
| HLS playback | Roadmap | hls.js (Apache-2.0) on the client |
| Live chat | Reusable | Existing Socket.IO infrastructure |
| Viewer counts | Roadmap | Redis sorted sets |

**To add streaming:** add MediaMTX to `docker-compose.yml`, ingest RTMP, serve HLS.

### Security
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| TLS / HTTPS | Bring your own | Reverse proxy + Let's Encrypt |
| AES-256 at rest | Roadmap | LUKS volumes or app-level encryption |
| End-to-end encryption | Roadmap | `signal-protocol` library (GPLv3) |
| Token authentication | Built | HMAC-signed WebSocket tokens |
| Blocked contacts | Built | `Block` model |
| User reporting | Built | `Report` model |
| MFA | Roadmap | Add `otplib` + `User.twoFactorEnabled` |
| SSO / LDAP | Roadmap | Add `next-auth-ldap` provider |
| Profanity filter | Roadmap | Add `bad-words` npm package |

### AI features
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| Chat AI assistant | Roadmap | Self-host Ollama (MIT) — add to compose |
| Speech-to-text | Roadmap | Whisper.cpp (MIT) |
| Translation | Roadmap | LibreTranslate (AGPL — free for self-host) |
| AI moderation | Roadmap | Ollama + prompt + flag pipeline |

**To add AI:** add Ollama to `docker-compose.yml`, expose `/api/ai/*` endpoints.

### Analytics / admin
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| Admin dashboard | Roadmap | New `/admin/*` routes with role-based access |
| Active users metric | Roadmap | Query `User.lastSeenAt` |
| Message count metric | Roadmap | `COUNT(*)` on `Message` |
| Audit logs | Roadmap | `AuditLog` model |
| Webhooks | Roadmap | `WebhookEndpoint` + signed delivery |

### SDKs
| MirrorFly feature | FriendConnect status | How |
|---|---|---|
| JavaScript SDK | Roadmap | Extract `src/lib/socket.ts` into a package |
| React SDK | Roadmap | Extract hooks into a package |
| Flutter SDK | Roadmap | `socket_io_client` + REST client |
| React Native | Roadmap | Same as JS SDK |
| Android (Kotlin) | Roadmap | socket.io-java |
| iOS (Swift) | Roadmap | socket.io-swift |

## Total cost of ownership

- **MirrorFly**: paid license (contact sales, typically $$$/month) + your hosting.
- **FriendConnect**: $0 license + your hosting (any VPS with 2GB RAM runs the full stack).

## Recommended hosting (all have free tiers)

- **Hetzner Cloud** — $4.5/month for a 2GB VPS (best value, EU/US)
- **DigitalOcean** — $6/month for a 1GB VPS
- **AWS Lightsail** — $5/month for a 1GB VPS
- **Oracle Cloud Free Tier** — Always Free: 4 ARM cores + 24GB RAM (best free option)
- **Fly.io** — Free tier includes small VMs
- **Railway** — Free tier with usage limits

## Backup strategy (all free)

- **Database**: `pg_dump` cron + upload to MinIO bucket
- **Object storage**: MinIO bucket replication or `mc mirror` to another MinIO
- **Config**: Keep `.env` in a password manager (Bitwarden — free)

## Monitoring (all free)

- **Uptime**: UptimeRobot (free tier, 50 monitors)
- **Metrics**: Prometheus + Grafana (both OSS, add to compose)
- **Logs**: Loki (OSS, add to compose) or just `docker logs`
- **Error tracking**: Sentry (free tier, 5K events/month)

## What's ready NOW vs roadmap

**Ready in this PR:**
- Auth (register, login, profile, friends, blocks)
- Real-time 1:1 and group chat
- Message persistence, edit, delete, reactions, replies, star
- File attachments with MIME validation
- Online presence + typing indicators
- Notifications panel
- Dark mode, responsive UI

**Roadmap (each is a separate PR):**
- Voice/video calls (WebRTC + LiveKit)
- Live streaming (MediaMTX + HLS)
- E2EE (signal-protocol)
- AI assistant (Ollama)
- Admin dashboard
- SDKs (JS, React, Flutter, RN, native)
- MFA, SSO/LDAP
- Webhooks

The `docker-compose.yml` already provisions Redis, MinIO, coturn, and Mailpit
so the infrastructure is ready for the roadmap items — the application code
just needs to wire them up.

## Quick start

```bash
cd deploy
cp .env.example .env
# Edit .env: set NEXTAUTH_SECRET (openssl rand -base64 32),
#           set POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
docker compose up -d
# Apply DB schema
docker compose run --rm app bun run db:push
# Open http://localhost:3000
```
