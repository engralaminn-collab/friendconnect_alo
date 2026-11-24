# Jara deployment guide and readiness boundaries

**Status as of 2026-11-24:** documentation for a future controlled deployment; nothing deployed or restarted. No production access, credentials, schema changes, or provider calls were used.

## Current deployable product vs. gated capabilities

The repository can build the existing FriendConnect application and provides source-level text-completion adapters, browser-dependent Jara speech UI, LiveKit group-call UI/token path, administrative records and SMS webhook code. This does **not** establish any configured provider/service, two-way realtime Jara, camera perception, carrier SMS delivery, durable memory, semantic retrieval, or general tool agent. Do not advertise those as active until the deployment checklist below is passed.

## Topology boundaries for a future environment

- FriendConnect Next.js/API and its supported SQLite/MySQL database remain the identity and access-control authority.
- Existing realtime Socket.IO and direct/group call services are separate processes. LiveKit SFU and TURN are separate media infrastructure; LiveKit token secrets stay server-side.
- Any selected ASR/TTS/vision/agent/model endpoint is an independently authenticated service/provider, with a separate data-retention and network policy. Put workers on private service networks; do not publish administrative/model endpoints.
- Provider and SMS credentials belong in the target deployment's secret manager, not source control, browser bundles, docs, database plaintext fields, or chat. Rotate and scope them using provider guidance. Never copy example placeholder values as secrets.
- Do not add persistent memory until `JARA_MEMORY_PRIVACY_DESIGN.md` gates are approved and SQLite/MySQL runtime parity, controls and migrations are verified.

## Preflight checklist

1. **Environment:** record app version/commit, supported Node/Python versions, OS, CPU/RAM/GPU/VRAM, disk, concurrent sessions, region, expected monthly/peak provider usage, and model artifact sources.
2. **Database:** identify the actual schema/runtime used. Repository contains canonical `schema.prisma`, `schema.sqlite.prisma`, and `schema.mysql.prisma`, but they are not parity-equivalent. Current SQLite raw-runtime metadata/DDL also does not expose all canonical Jara models. Reconcile and validate parity in a disposable clone first; take verified encrypted backups and exercise restore. Do not run `db push`, destructive reset, or production migration from this guide.
3. **Authentication:** require production `NEXTAUTH_SECRET`, secure HTTPS cookies and exact proxy/origin configuration. Test session revocation, user/group authorization, LiveKit token expiry, and guest/role boundaries.
4. **Media:** provision LiveKit/SFU, TURN/STUN, certificates, bandwidth and firewall rules. Use short-lived room tokens and current-membership checks. Test NAT, browser permissions, mobile/background behavior, room cleanup and concurrent load. Do not enable agent subscriptions or recording by default.
5. **Consent/privacy:** obtain product/legal approval for notices, purpose, retention, provider transfer, deletion, subprocessors, group participants, camera/audio, SMS and jurisdictional requirements. Implement opt-in controls and revoke/stop behavior before activating any channel.
6. **Providers:** verify exact endpoint/model version, credentials/contract, health/readiness, timeouts, rate/cost budget, data residency/retention, supported modalities, Bengali/Banglish performance, cancellation and failure behavior using a separate test account.
7. **SMS:** obtain carrier/provider account, sender ID and required registrations; secure fixed HTTPS webhook URL and signature secret; test signature, replay/idempotency, inbound STOP, country restrictions, consent, human approval, delivery status and abuse/rate controls. No outbound sender exists in the app today.
8. **Observability:** establish prompt/transcript/media redaction, error classes, access control and retention. Avoid content logging. Alert on provider unavailability, queue growth, spend/rate limits and webhook verification failures.
9. **Security:** threat model workers, admin config, tool actions, SSRF, file uploads, provider callbacks, token leakage, cross-tenant retrieval and service-to-service authentication. Run independent security review and staging integration tests.
10. **Readiness:** define quality/latency/SLO/resource/cost thresholds and rollback owners; get explicit release approval. Production migration/restart/deployment is outside this task.

## Local verification in this sandbox

This sandbox is not a server deployment environment. Docker/Podman/GPU/PostgreSQL/Redis CLI were not found. Package installation without scripts succeeded, but the normal `npm ci` native `better-sqlite3` build attempted to fetch Node headers from `nodejs.org`, which is outside the available network hosts and failed. No production or external provider was contacted. The later successful build and tests are recorded in `JARA_TEST_REPORT.md`.

Prisma CLI validation/generation/migration checks require the Prisma schema engine. Attempted `npx prisma validate --schema prisma/schema.sqlite.prisma` could not fetch `binaries.prisma.sh` in this environment. Do not substitute schema copy, `db push`, or a hand-created migration in production.

## Rollback principles

- Revert only reviewed application changes using an explicitly saved patch and path-specific review; preserve unrelated working tree changes.
- For a provider outage, disable the provider/feature at its tested server-side gate; do not silently fail over to a different processor.
- For LiveKit, revoke token issuance/agent join and stop affected sessions; do not delete a shared room merely because one member leaves.
- For SMS, turn off inbound/outbound processing and reject unverified webhooks; queueing/sending must stop immediately.
- For memory, revocation must stop reads/writes immediately and follow the approved purge/cache/backup policy. Disabling memory must not be represented as deleting normal chat history.
- Database rollback requires a separately approved, tested recovery plan and known-good backup. No schema migration was executed here.
