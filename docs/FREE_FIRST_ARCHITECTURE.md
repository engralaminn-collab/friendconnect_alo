# Free-first architecture and cost classification

**Honesty statement.** Software licences can be free while the platform is not free to run. A server, bandwidth, storage, TURN relay traffic, SMS, telephone numbers, and AI inference each carry costs that this document does not eliminate. No component is "zero-cost" unless its operating cost was measured. None of the costs below were measured in this session.

## Classification used

- **Free and open source**: self-hostable under an OSI-approved (or equivalent) licence.
- **Free tier**: a provider offers limited no-cost usage that can change.
- **Paid**: usage or subscription requires payment.
- **Infrastructure cost**: needs a server, electricity, bandwidth, storage, or hardware.
- **Conditional**: free only under specific terms or quotas.
- **Unverified**: licence or cost not confirmed.

## Application dependencies (verified from `node_modules/*/package.json` on this branch)

Totals: 93 direct dependencies and dev dependencies. 74 MIT, 12 Apache-2.0, 3 ISC, 1 Unlicense, 1 MPL-2.0, 1 MIT-0, 1 BSD-3-Clause. Licence text was not reviewed line by line. No strong-copyleft package was found in the direct dependency set.

| Component | Licence (verified) | Classification | Self-hosted option | Notes |
|---|---|---|---|---|
| Next.js 16, React 19 | MIT | Free and open source | Yes | Build and standalone server |
| Prisma 6.19.3 (`prisma`, `@prisma/client`, adapters) | Apache-2.0 | Free and open source | Yes | Schema engine downloads from `binaries.prisma.sh` at install or generate time |
| better-sqlite3 | MIT | Free and open source | Yes | Default database for the Docker image (`file:./db/custom.db`) |
| socket.io, socket.io-client | MIT | Free and open source | Yes | Realtime server |
| @socket.io/redis-adapter, ioredis | MIT | Free and open source | Yes | Only if `REDIS_URL` is set |
| livekit-client, livekit-server-sdk, @livekit/components-react | Apache-2.0 | Free and open source (self-hosted server) | Yes (LiveKit server, Apache-2.0) | LiveKit Cloud is a separate paid service; not used |
| sharp | Apache-2.0 | Free and open source | Yes | Image re-encoding on upload |
| web-push | MPL-2.0 | Free and open source | Yes | Weak copyleft at file level |
| nodemailer | MIT | Free and open source | Yes | Mail is sent through an SMTP server the operator supplies |
| z-ai-web-dev-sdk | ISC | **Unverified** (licence is open; the service it calls is external) | No | Calls an external AI service. Not activated by default. Requires review before use. |
| bcryptjs, zod, zustand and the remaining direct dependencies | MIT, ISC, or other permissive licence (see totals above) | Free and open source | Yes | Full per-package list: run the licence extraction against `package.json` and `node_modules` |

## Infrastructure components in the repository

| Component | Where | Licence | Classification | Self-hosted | Free-tier availability | Operational risks |
|---|---|---|---|---|---|---|
| Caddy (reverse proxy, TLS) | `Caddyfile`, `docker-compose.yml` | Apache-2.0 (not fetched; verify) | Free and open source | Yes | n/a | Let's Encrypt rate limits; domain required |
| Redis | `docker-compose.yml` (`redis:7-alpine`) | **Unverified for current versions**: Redis 7.4+ moved away from BSD. Verify before relying on it. Valkey (BSD-3-Clause) is the usual open alternative. | Unverified | Yes | n/a | Required for multi-instance rate limits and socket fan-out |
| coturn (TURN) | `docker-compose.yml`, `deploy/docker-compose.yml`, `coturn/` | BSD-3-Clause (upstream; verify) | Free and open source | Yes | n/a | Relay bandwidth is the main cost. Needs public IP and UDP port range 49160–49200. |
| MySQL 8 | `deploy/docker-compose.yml`, `prisma/schema.mysql.prisma` | GPL-2.0 community edition (verify) | Free and open source (self-hosted) | Yes | n/a | Backups are the operator's responsibility. Not executed in this session. |
| SQLite | Default app database | Public domain | Free and open source | Yes | n/a | Single-writer; not for horizontal scaling |
| Docker / Docker Compose | `Dockerfile`, `deploy/` | Apache-2.0 (verify) | Free and open source | Yes | n/a | Image build not verified in this session (no container runtime) |
| GitHub Actions | `.github/workflows/ci.yml` | Service | Free tier (conditional on public-repository or plan minutes) | n/a | Limits and minute quotas apply; not verified for this repository | Quota exhaustion blocks CI |

## Providers that are NOT activated and must be approved before use

| Service | Use in FriendConnect | Classification | Limits and costs (not verified in this session) | Exit path |
|---|---|---|---|---|
| Twilio SMS (`src/lib/jara-sms.ts`, webhook) | Jara SMS | **Paid** | Per-message and per-number charges; sender and country rules | Provider adapter; disable in configuration |
| OpenAI, Anthropic, Google Gemini APIs | AI gateway (remote models) | **Paid or conditional** | Per-token charges; free quotas change | Local model first; per-user and per-organisation policy |
| Ollama (local models) | AI gateway (local) | Free and open source (MIT, verify) | Hardware-bound (CPU/GPU, RAM) | Default local route |
| SMTP provider | Email | Depends on operator | Varies | Operator-supplied |

## What is not claimed

- No measurement of bandwidth, relay traffic, storage growth, or CPU cost has been performed.
- No SMS, telephone-number, or PSTN service has been activated or tested.
- No external AI provider has been called from this environment.
- The platform is **not** described as zero-cost.
