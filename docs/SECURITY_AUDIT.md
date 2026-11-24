# Security audit — targeted FriendConnect repair

**Audit date:** 2026-11-24 UTC
**Repository:** `engralaminn-collab/friendconnect_alo`
**Branch:** `arena/d3b50abc-friendconnect-alo`
**Base commit:** `c21d1e6a825238df7773fb9c990e36dfccd5b97e`
**Scope:** seven requested review findings involving uploads/downloads, Socket.IO, sessions, CI, and local-development documentation. This is not a full application assessment or a production security certification.

## Executive status

| Finding | Base-revision evidence | Current repair/evidence | Status |
|---|---|---|---|
| Upload validation and private storage | Base route used a denylist, trusted browser MIME/extension, and could store active formats or content with mismatched signatures. | Allowlist + extension/MIME/signature checks; raster decode/re-encode; size/dimension limits; exclusive `0600` object creation; cleanup on failed writes. Integration test rejects HTML and spoofed PNG and confirms no object remains. | **Repaired; tested locally** |
| Private file download authorization | Base file route had no owner/share relationship check and served database MIME inline. | File-specific authorization for owner, current message/group membership, profile/photo visibility, approved Jara media, and eligible stories; constrained IDs and stored-byte validation; attachment, private/no-store, CSP and `nosniff` headers. Integration verifies owner/message-recipient allow and unrelated-user deny. | **Repaired; tested locally** |
| Socket authentication and session validity | Base handshake allowed anonymous/invalid sockets and did not continuously validate the session. | Handshake authenticates an unexpired DB session; every inbound event and a 30-second timer recheck it; invalid sessions are disconnected; size/rate controls added. Integration covers absent, invalid, expired, and revoked sessions. | **Repaired; tested locally** |
| Presence privacy and event authorization | Base presence was global and several mutations/relays trusted user-supplied IDs. | Presence limited to eligible friends with visibility/block checks; message/group/read/reaction/typing/call handlers authorize against current records; persisted call participants constrain relay. Integration verifies outsider presence privacy, an unauthorized invite denial, allowed call acceptance delivery, and no unauthorized reaction/read mutation. | **Repaired; targeted integration tested** |
| Canonical session creation, logout, and revocation | Base NextAuth/JWT and DB-session/socket lifecycle could diverge, leaving realtime sessions unauthenticated or surviving HTTP-side changes. | Successful credentials login creates a required DB session; unexpired row is required by HTTP and socket paths; session listing, per-device delete, and logout remove that row. Integration covers current-session listing, API revocation, logout, HTTP rejection, and socket disconnect. | **Repaired; tested locally** |
| Blocking security tests in CI | Baseline did not execute the security regressions as required checks. | CI workflow runs lint, typecheck, unit/security suite, socket syntax check, production build, and integration tests; failures stop the job. YAML parsed locally. | **Workflow edited and parsed; GitHub CI NOT RUN** |
| Accurate local development documentation | README did not clarify that `dev` is Next-only versus gateway/socket full-stack local mode and local DB safety. | README distinguishes `npm run dev` from `npm run dev:all`, documents disposable SQLite/test env, test/build commands, and Redis needs for horizontal scaling. | **Updated; not independently exercised as docs** |

## Findings and implementation details

### 1. Upload and download safety

At base commit `c21d1e6`, upload accepted anything not on a short executable denylist, with MIME and suffix supplied by the client. A payload named `.html` or `.svg` was not blocked by that denylist; bytes were not matched to the declared type. The download route returned content inline using `File.mimeType`, without checking `ownerId` or a share relationship. Any authenticated account able to obtain a file URL/ID could request another user's file.

Now the upload allowlist excludes HTML, SVG, scripts, and other browser-active formats. Extension, declared MIME, and detected signature must agree. Raster images are decoded and re-encoded. The download route returns only validated stored types with attachment disposition, restrictive CSP, `nosniff`, and private/no-store caching. File permission decisions are made using the existing file owner and product relationships. Expired/deleted messages and expired stories do not confer access; profile/story visibility, blocks, and story muting are applied. Invalid pre-existing stored files are denied rather than served unsafely.

**Observed local integration outcomes:** HTML and spoofed PNG uploads → 415; invalid uploads create no objects; unrelated account → 403 for private file; owner and direct-message recipient → 200; successful downloads include attachment disposition and `X-Content-Type-Options: nosniff`.

### 2. Socket authentication, session validity, and resource authorization

At base commit `c21d1e6`, middleware continued handshakes even without an active session. Global presence events disclosed all online users. Several message/read/reaction/call handlers trusted client IDs or lacked consistent membership/participant checks.

The repaired handshake only accepts a well-formed token resolving to an unexpired `Session` row and user. Each event checks that same session again; a timer disconnects idle revoked sockets within 30 seconds. The middleware limits handshake attempts, event types have per-user limits, and packet JSON is capped. Message sending validates message permissions/blocks and file ownership; group sends and typing require current membership; reads are restricted to the recipient; reactions require direct participants or group membership; call signaling requires an active persisted call and one of its two participants, plus current call permission. Presence snapshots/transitions are limited to accepted, unblocked contacts whose profile is not private.

Socket user rooms work across processes only when the Socket.IO Redis adapter is active. `@socket.io/redis-adapter` is now a declared dependency and `REDIS_URL` activates it. Rate limits fall back to process-local counters if Redis is absent/unavailable, so production multi-instance deployments must provision and validate Redis rather than rely on that fallback.

**Observed local integration outcomes:** no token, malformed/unknown token, expired token → handshake rejected; revoked session → connected socket disconnected; friend invite and acceptance relay → pass; outsider invite → `{ ok: false }`; outsider receives no tested presence transition and cannot change message status or add a reaction.

### 3. Session lifecycle and revocation

The repaired NextAuth credential callback creates a random, persisted `Session.token` on each successful credential login and fails closed if it cannot persist the row. The callback puts that token in the JWT. `getCurrentUser`, device-session APIs, token issuance, logout, and Socket.IO all resolve the persisted, unexpired row rather than treating a JWT alone as current authorization. Logout deletes the row and clears the legacy cookie; per-device deletion checks ownership and deletes the chosen row. Production requires `NEXTAUTH_SECRET`; the well-known development fallback is not accepted in production.

**Observed local integration outcomes:** logged-in session list contains one current session; deleting it makes `/api/me` return 401; its active socket is disconnected on the next packet; a separate active session logout makes `/api/me` return 401 and its socket disconnects on the next packet. An idle socket is closed by the 30-second revalidation timer.

### 4. Call flow and compatibility

The HTTP call start path now rejects self-calls, checks `callPermission`/blocks, and checks active calls for either participant. End operations validate status/duration and require the caller to be one of the persisted participants. Socket invite and subsequent signaling use the same permission checks and call row. The acceptance path relays the accepted event after setting the persisted status to connected.

**Residual:** the HTTP “busy?” query and call insert are not atomic; near-simultaneous starts can race. A transactional/unique-slot solution would require a database-level design and was not added. Socket signaling and WebRTC media across browsers/networks were not end-to-end tested.

## Tests, build, and CI evidence

Executed locally on the current uncommitted branch:

- `NEXTAUTH_SECRET='local-only-test-secret-not-for-deployment' DATABASE_URL='file:./db/security-test-build.db' npm test` — **PASS**: unit/security 39/39; standalone production build passed; integration 2/2 passed.
- `npm run typecheck` — **PASS** (`tsc --noEmit`).
- `npm run lint` — **PASS** (`eslint .`).
- `node --check socket-server.js` and syntax checks for both integration tests — **PASS**.
- `@socket.io/redis-adapter` runtime module load — **PASS**; connection to a Redis service and multi-instance behavior are still **NOT RUN**.
- The production build intentionally requires `NEXTAUTH_SECRET`; the earlier missing-secret build failed as designed. The successful build used only disposable local/CI-only values, not production credentials.
- `.github/workflows/ci.yml` — **YAML parsed successfully** using PyYAML; a GitHub Actions run was **NOT RUN**.
- Redis multi-instance behavior, MySQL execution, production deployment, public hostname, and browser camera/microphone/TURN behavior — **NOT RUN**.

The integration harness creates its own temporary database and file directory and removes both after each run. The production build output is generated in `.next` under the repository, per existing build conventions.

## Risks and non-scope

- Redis adapter connection, pub/sub, room fanout, and shared rate-limit behavior have not been integration tested against Redis. Horizontal scaling is **not verified**.
- `isUserOnline` is cross-process only with Redis adapter; without it, socket-room fanout and rate-limit fallback are local to one process.
- The HTTP active-call check/insert is not atomic, as noted above.
- Existing stored files whose content/type fails new validation may return 415. No bulk conversion/deletion was performed.
- MySQL/Prisma, reverse proxy/CORS deployment configuration, production storage permissions, TURN, browser media, and external integrations remain unverified.
- This work does not assert E2EE or encryption at rest. Message/file transport and storage protection outside the tested routes were not audited here.
- Historical findings outside this request—metrics access, user-search privacy, raw error text, migration/schema parity, broader API authorization, and dependency/repository hygiene—are not declared fixed or safe by this targeted audit.
- No production migrations, resets, seeds, deployment, credential rotation, infrastructure changes, commit, or push were performed.

## Local reproduction

Use disposable local settings; never point these commands at production:

```sh
export DATABASE_URL='file:./db/security-test-build.db'
export NEXTAUTH_SECRET='local-only-test-secret-not-for-deployment'
npm ci
npm test
npm run lint
npm run typecheck
node --check socket-server.js
```

`npm test` runs unit/security tests, creates a production build, and then starts the integration harness against temporary test-only DB and upload directories. `npm run test:integration` alone assumes a fresh standalone build already exists. Full local app/socket/gateway use is documented in `README.md` under `npm run dev:all`; ordinary `npm run dev` starts only Next.js.

## Rollback

Before rollback, save the current diff (`git diff --binary > /safe/location/friendconnect-security-repair.patch`). Then restore tracked changes listed by `git status --short` and remove only the newly added paths from that status (`src/lib/file-access.ts`, `src/lib/session-registry.cjs`, `src/lib/socket-security.cjs`, `src/lib/upload-security.cjs`, and the new security/integration test files). Do not revert unrelated user changes. This work made no database/schema migration, so no data rollback is needed. Do not rollback by deleting the repository, changing branches, or touching production configuration.

## Jara multimodal addendum — 2026-11-24

The preceding audit remains scoped to its file/session/socket repair. The following are additional narrow review changes, not a whole-app certification:

- `/api/livekit/token` now restricts room identifiers to `fc-<conversationId>` and checks authenticated conversation membership before minting. `/api/calls/group` requires membership for end and no longer deletes the shared room on a single participant's leave. These paths were typechecked and production-built, but no LiveKit server/browser session was available for integration verification.
- `/api/jara/sms/webhook` no longer treats a signature header's mere presence as validation. It requires enabled inbound Twilio config, configured auth token and fixed HTTPS callback URL, form-encoded nonduplicate fields, and valid HMAC-SHA1 `X-Twilio-Signature`; unknown providers and JSON fail closed. The pure verifier has positive/tampering/wrong-token/non-HTTPS tests. Actual proxy canonical URL, carrier delivery, replay/idempotency and secret-store behavior are not end-to-end verified. The current DB field is not encrypted secret storage, and raw SQLite runtime/schema parity lacks the SMS models/delegates, so production SMS must remain disabled pending redesign/validation.
- The browser-voice text bridge now ignores client-submitted history, rebuilds bounded context from the authenticated user's visible persisted Jara DM, and stores transcript/reply as ordinary messages. The local mock-provider integration verifies these boundaries. It remains browser speech plus text completion, not server realtime voice.
- Persistent memory, camera perception, realtime Jara audio, general tool execution and semantic retrieval remain unimplemented. `JaraMemory` schema is not consent; no migration or memory runtime was added. See `JARA_PRIVACY_AND_CONSENT.md` and `JARA_MEMORY_PRIVACY_DESIGN.md`.

Current turn verification: `npm run test:unit` 55/55; `npm run typecheck` PASS; `npm run lint` PASS; production `npm run build` PASS with test-only `NEXTAUTH_SECRET`; `npm run test:integration` 2/2. Prisma validate is blocked by the sandbox network restriction to `binaries.prisma.sh`; live providers, LiveKit, SMS carrier, MySQL, GPU, deployment and GitHub CI were not tested. Exact environment/install history is in `JARA_TEST_REPORT.md`.
