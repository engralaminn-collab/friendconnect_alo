# FriendConnect security repair review

**Reviewed:** 2026-11-24 (UTC)
**Repository:** `engralaminn-collab/friendconnect_alo`
**Branch:** `arena/d3b50abc-friendconnect-alo`
**Base:** `c21d1e6a825238df7773fb9c990e36dfccd5b97e`
**Review scope:** upload/download, private-file access, Socket.IO authentication and event authorization, session lifecycle/revocation, call signaling, security regression coverage, CI and local-development guidance. This is a scoped code review, not a whole-application security certification.

## Findings reproduced from the base revision

The checks below were confirmed by inspecting the base-commit code paths. The base revision was not run as a live exploit target; do not interpret these as production incident measurements.

1. **Upload type checks trusted user-controlled MIME/extension.** `POST /api/files/upload` rejected a denylist only, used the client MIME and suffix to write stored objects, and allowed browser-active types not present on its short denylist (for example HTML or SVG). Image processing was best-effort and could retain the original bytes. This allowed content to be stored with misleading metadata and potentially served in a browser context.
2. **Authenticated users could fetch another user's file by ID.** `GET /api/files/[id]` required a session and a file row but did not check ownership or an explicit share relationship. It selected the first matching storage filename and returned the database MIME inline. The ID format was also broader than the generated file IDs.
3. **Socket.IO accepted anonymous/invalid connections.** The base `io.use` middleware called `next()` even with no valid session and exposed global online/presence broadcasts. It did not continuously validate a session row after connection.
4. **Realtime event authorization was incomplete.** The base message/reaction/read/call handlers did not consistently prove the sender was a direct-message participant, current group member, or an allowed call participant before database writes/relay. Call signaling trusted client-supplied parties rather than a persisted call relationship.
5. **Presence exposed unnecessary online state.** The base implementation broadcast online and presence updates to all connected sockets instead of limiting them to eligible friends and applying block/profile-visibility checks.
6. **Session lifecycle and realtime revocation were not one enforced boundary.** The base auth/socket flow did not reliably make a persisted, expiring session row authoritative for HTTP identity, websocket identity, and device revocation. Session-management and logout behavior could therefore diverge from an already-issued socket.
7. **Security regression checks did not block CI.** The baseline workflow did not execute the added security test coverage as a required CI step. The local-development instructions also did not clearly distinguish the Next-only dev command from the full app/socket/gateway stack.

## Changes made

- `src/lib/upload-security.cjs` now allowlists supported image/document/audio/video types, requires extension/MIME agreement and signature detection, limits bytes and dimensions, and re-encodes raster images. The upload route uses exclusive, restrictive-mode file creation and cleans up completed stages after errors. Downloads use constrained IDs, revalidate stored type/signature, require an authenticated caller and a file-specific access decision, and send an attachment with `nosniff`, restrictive CSP, and private/no-store caching.
- `src/lib/file-access.ts` implements owner, direct-message participant, current group-member, profile visibility, approved Jara asset, and story access checks. It respects expired/deleted message attachments, story expiry/highlights, current friendship, block, and story mute state. A file remains private absent an explicit product relationship.
- `src/lib/socket-security.cjs` checks session token shape, database session existence and expiry, message participation, interaction permissions/blocks, and per-event limits. The Socket.IO handshake rejects invalid credentials; each inbound packet and a periodic timer revalidate the session. Data-changing and signaling events check message/group/call relationships. Call relay is tied to the persisted call record and emits an accepted event to the caller after updating state.
- Presence and per-user relay use Socket.IO user rooms, restrict presence to eligible friends, and apply visibility/block checks. Redis adapter support is now an installed runtime dependency; Redis is required for shared rooms and event limits in horizontally scaled deployments. Process-local event limits remain the single-instance fallback.
- NextAuth credential logins create a required DB `Session.token`; HTTP identity and websocket identity require that unexpired row. Logout, session-device revocation, and the realtime server use that same row as the revocation authority. The development-only secret fallback is refused in production.
- The HTTP calls route validates permission, self-call, busy participants, ownership, status, and duration. The client call path passes the expected signaling target. Regression tests exercise the built app and a real local Socket.IO process against a temporary SQLite DB and upload directory.
- CI now runs lint, typecheck, unit/security tests, socket syntax validation, a production build, and integration regressions as blocking job steps. `README.md` explains the development modes, local-only database caution, test requirements, and Redis scaling requirement.

## Verification evidence

The integration suite proves these outcomes against the repaired code: invalid/missing/expired socket sessions are rejected; revocation disconnects a connected socket; call invitations/acceptance relay for allowed friends; outsiders do not receive presence or alter private message state; invalid or spoofed upload types are rejected without storage; a private attachment is denied to an unrelated account and is downloadable by an explicit message recipient; downloads are attachments with `nosniff`; NextAuth-backed sessions appear as current, device deletion invalidates the HTTP identity, and logout invalidates the session and socket.

Detailed command outcomes and limitations are recorded in `docs/SECURITY_AUDIT.md`. Passing these tests does not prove production configuration, Redis clustering, external TURN/media behavior, MySQL parity, or deployment safety.

## Residual risks and review boundaries

- Redis multi-instance behavior is implemented but was not exercised against a live Redis service in this environment. Configure and validate Redis before horizontal scaling; otherwise the process-local fallback cannot coordinate rate limits, rooms, or presence across instances.
- The HTTP busy-call check and subsequent call insert are not a database-level atomic reservation; simultaneous requests can race. Socket call-invite checks persisted active calls, but this is not a substitute for a transactional uniqueness/locking design if strict single-call concurrency is required.
- The MySQL/Prisma path, production reverse proxy, browser media stack, TURN deployment, external storage, and production data were not tested or changed. Active pre-existing files outside the new allowlist may now return 415 until safely re-uploaded; no migration or bulk file rewrite was performed.
- Socket.IO uses the persisted DB session as authority, with in-memory socket `userId` as a cached identity that is checked on each event and periodically. Session revocation detection latency is bounded by the packet check/30-second timer, subject to DB availability (DB errors fail closed).
- No live GitHub Actions run occurred during this review. The YAML was parsed locally, but the workflow still needs to pass on GitHub.
- The unrelated historical findings in the prior audit (for example metrics exposure, email search, E2EE claims, migration parity, and raw error messages) were not re-audited or fixed by this scoped work. See `docs/SECURITY_AUDIT.md` for explicit status boundaries.

## Rollback

Review the current branch diff first. To revert only this uncommitted repair set, run `git diff --binary > /safe/location/friendconnect-security-repair.patch` to preserve it, then `git restore` tracked files listed by `git status --short` and remove only the newly created files under `src/lib/` and `tests/integration/` shown by that same status. Do not restore or delete unrelated user changes. No commit, push, deployment, production migration, data reset, credential rotation, or infrastructure change was made as part of this review.

## Jara multimodal expansion review addendum — 2026-11-24

This addendum expands the review scope to Jara AI/multimodal capabilities and must not be read as a deployment or full security certification. Repository branch and HEAD remain `arena/d3b50abc-friendconnect-alo` / `c21d1e6a825238df7773fb9c990e36dfccd5b97e`; the worktree is uncommitted and preserves prior staged/unstaged work.

### Additional changes

- Restricted `/api/livekit/token` room token minting to `fc-<conversationId>` and authenticated conversation members.
- Changed `/api/calls/group` end behavior so an authorized participant leaves rather than deleting a shared room. No LiveKit server/browser call was exercised.
- Replaced the SMS webhook's signature-presence test with fail-closed Twilio-only form signature validation against a configured fixed HTTPS public URL; added deterministic positive/tampering/credential/transport unit tests. No provider was contacted.
- Added the multimodal architecture, open-source candidate evaluation, deployment, provider configuration, privacy/consent, and test report documents. Updated AI architecture/phase and memory privacy design with findings.
- Updated the browser voice text bridge to ignore client-submitted history, use the authenticated user's visible persisted Jara DM context, and save speech transcript/reply as ordinary chat messages. A local mocked-provider integration covers persisted continuity, privacy filtering, spoofed-history rejection, and persistence.

### Important residuals

- Jara realtime voice, camera/video understanding, server ASR/TTS, outbound carrier SMS, semantic retrieval, general agent tools/tasks and persistent-memory runtime are not implemented or verified.
- Existing browser speech is not a realtime media service. Existing LiveKit calls are media transport, not Jara's agent/perception.
- Text providers exist in code, but availability/quality is untested; baseline is `NOT_RUN` and 0 model calls.
- Schema parity is incomplete (canonical SQLite Prisma 28 models, canonical 51; MySQL 40), and raw SQLite runtime lacks Jara SMS delegates/tables. No schema/migration changes were made.
- Memory is not implemented. Existing config `memoryEnabled: true` is not consent. The earlier design gate stands; retention/provider policy needs review and explicit user controls.
- Local verification: unit 55/55, typecheck/lint/build pass, integration 2/2, diff check outcome reported in `JARA_TEST_REPORT.md`; Prisma validation/generation blocked by unavailable schema-engine host. No external accounts, GPU, production database or real hardware were accessed.

Read `docs/JARA_TEST_REPORT.md` for exact command outcomes and `docs/JARA_MULTIMODAL_ARCHITECTURE.md` for capability boundaries and acceptance gates. No commit, push, PR, deployment, production restart/migration, destructive DB operation, credential request, or external provider call occurred.

## Jara messaging-user review addendum — 2026-11-25

Branch `arena/d33d7903-friendconnect-alo` (base `dc1e3f0`, PR #20). This addendum
covers the change that made Jara a participant in the ordinary message store
instead of only in the separate `/api/jara/chat` screen.

### Changes

- Added `src/lib/jara-responder.ts`: authorization (DM receiver, conversation
  member, or group member + consent + explicit mention), idempotency on the source
  message id, per-user rate limit, live config → system prompt → `aiChat`,
  persistence as a normal `Message`, `message:new` fanout, notification, read
  receipt and `JaraAuditLog` entry.
- `POST /api/messages` and `POST /api/conversations/:id/messages` (the chat UI
  path) now trigger the reply after the message is stored; provider latency never
  blocks the send.
- `socket-server.js` `message:send` triggers the same reply through the new
  internal `POST /api/jara/respond` route (shared `x-internal-secret`,
  constant-time comparison). `APP_INTERNAL_URL` documents the direction.
- Without a reachable provider the user receives an explicit `type: system`
  notice with `metadata.inference = "unavailable"`; no canned text is presented as
  model output.

### Verification

- New `tests/integration/jara-user.test.cjs`: 5 tests, real production build, real
  HTTP Ollama-compatible provider, real Socket.IO round trip — permanent identity
  and idempotent seeding, Bangla DM, duplicate protection, read receipt,
  notification, honest unavailability, cross-user privacy (`not_participant`),
  internal-secret enforcement, ordinary-user 403s, and the Super Admin
  propose → approve → audit flow (hash/version tamper and replay refused).
- `npm run test:integration` 26/26, `test:unit`, `test:security` (42),
  `schema:check`, `tsc --noEmit` (0 errors), `lint`, production build: all pass.

### Residuals (unchanged by this work)

- No live AI provider is reachable from this environment, so answer quality is
  unverified; the gateway path is exercised over HTTP only.
- Jara audio/video calls remain browser STT/TTS + avatar UI; no real-time video
  avatar, no LiveKit participation by Jara, no server-side ASR/TTS.
- Owner-approved avatar image not supplied; governance pipeline unchanged.
- MySQL acceptance and production deployment to `panel.alolabs.net` remain
  `BLOCKED` (no database server, no engine download, no SSH/CI secrets, no DNS
  access). Nothing was deployed.

See `docs/JARA_MESSAGING_ACCEPTANCE.md` and `docs/JARA_ARCHITECTURE.md`.
