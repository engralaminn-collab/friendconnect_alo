# Original 30-finding remediation matrix

**Repository:** `engralaminn-collab/friendconnect_alo`
**Branch:** `arena/2b2a87d0-friendconnect-alo`, based on `ba1f0ee` (merge of PR #25)
**Source of the 30 findings:** the numbered list in the 2026-11-28 execution request. The earlier report (`docs/REMEDIATION_EXECUTION_REPORT_2026-11-28.md`, §9) recorded that the list was not available to it; the list is now present in the request and is used here verbatim by number.

## Classification key

- **FIXED AND VERIFIED**: code change plus a test that exercises it. Named test is listed.
- **ALREADY FIXED AND VERIFIED**: present on `main` before this work; the test named was run and passes.
- **NOT APPLICABLE WITH EVIDENCE**: the premise does not hold in this code.
- **BLOCKED WITH EXACT REASON**: needs infrastructure this sandbox does not have.
- **OPEN**: work is not complete. It is not hidden and not counted as done.

"Fixed this session" means changed on this branch in this turn. Test counts come from the final run recorded in `docs/RELEASE_REPORT.md`.

| # | Finding | Classification | Evidence (path / test) | Notes |
|---|---|---|---|---|
| 1 | Block must stop new messages via REST, Socket.IO, existing and new conversations | ALREADY FIXED AND VERIFIED | `tests/security/conversation-block.test.cjs`, `tests/integration/messages-hardening.test.cjs` | Passing in `test:security` (101/101) and `test:integration` (30/30). |
| 2 | Undeclared `node-turn` Docker dependency | FIXED AND VERIFIED (image build and boot in CI run 46159428630); compose `turn` (coturn) NOT runtime-verified | `Dockerfile`, `deploy/Dockerfile.app`, `docker-compose.yml`, `scripts/check-docker-manifest.mjs`, `tests/security/docker-manifest.test.cjs` | **This session:** root `docker-compose.yml` `turn` service ran `scripts/turn-server.js` in the app image, where `node-turn` is absent, so it relayed nothing. It now uses the coturn image with required `TURN_EXTERNAL_IP`/`TURN_PASSWORD` (no dev fallback). The app service's TURN password fallback was removed too. The image build and container run were verified by the GitHub runner: step "Build image and verify the running container" = success. The root compose `turn` service was not started by any run. |
| 3 | Runtime image missing `src/lib/*.cjs` modules | ALREADY FIXED AND VERIFIED; extended this session | `scripts/check-docker-manifest.mjs` (traces `require()` graph), `docker-manifest.test.cjs` | **This session:** `call-sweep.cjs` and `session-sweep.cjs` are required by `socket-server.js` and were added to both Dockerfiles. The manifest check passes. |
| 4 | Compose / database / package-manager mismatch | FIXED AND VERIFIED for MySQL migration and CRUD (CI run 46159428630, job "MySQL 8 migration and CRUD"); SQLite deploy compose not run | `deploy/docker-compose.yml` (MySQL 8 + coturn + socket), `deploy/Dockerfile.app`, `package-lock.json` (npm only); CI job `mysql-runtime` | No PostgreSQL remains in the deploy stack. Verified by the GitHub runner: step "Apply migrations to a real MySQL 8 server and run CRUD" = success. Local MySQL/Docker execution is impossible in this sandbox. The `deploy/` compose stack itself was not started. |
| 5 | REST fallback message creation does not emit realtime event | ALREADY FIXED AND VERIFIED | `tests/integration/messages-hardening.test.cjs` ("must notify the realtime server") | Passing in integration 30/30. |
| 6 | Inconsistent message-length validation | ALREADY FIXED AND VERIFIED | `conversation-block.test.cjs`, `messages-hardening.test.cjs` | One 10 000-character policy on REST and socket paths. |
| 7 | Future-scheduled, expired, cancelled messages leak to recipients | ALREADY FIXED AND VERIFIED | `messages-hardening.test.cjs`; `runJobs` filters `status: 'SENT'` | Passing. |
| 8 | `Profile.readReceipts` ignored in REST and socket read flows | ALREADY FIXED AND VERIFIED | `messages-hardening.test.cjs` (receipts off, then control case on) | Passing. |
| 9 | Scheduled cancel deletes audit history and races delivery | ALREADY FIXED AND VERIFIED | `messages-hardening.test.cjs`; `src/app/api/messages/scheduled/route.ts` sets `CANCELLED` in one conditional update | Passing. |
| 10 | Unchecked SQL identifiers in SQLite runtime sort | ALREADY FIXED AND VERIFIED | `src/lib/db-runtime.js` `orderColumn()` allowlist; `tests/integration/db-runtime.test.cjs` | Unknown columns throw; relation sorts are skipped, not interpolated. |
| 11 | Preview-domain trust and app-owned security headers | FIXED AND VERIFIED | `src/proxy.ts`; **new** `tests/security/proxy-headers.test.ts` (3 tests) | **This session:** added the first behavioural test. Mutation check: removing `X-Frame-Options` fails 2 tests. A `*.e2b.app` host gets `frame-ancestors 'none'`. |
| 12 | Strict Mode disabled; framework version disclosed | FIXED AND VERIFIED (config); hooks not individually audited | `next.config.ts` (`reactStrictMode: true`, `poweredByHeader: false`); `npm run lint` 0 problems, `typecheck` 0 errors, `build` passes | Hook-by-hook review was not performed; lint passing is the evidence. |
| 13 | Duplicate `DATABASE_URL` in `.env.example` | ALREADY FIXED AND VERIFIED | `scripts/check-env.mjs` duplicate-key check; `npm run env:check`-equivalent passes | |
| 14 | Non-atomic backup-code consumption | FIXED; concurrency NOT verified — OPEN | `src/lib/two-factor.ts` `consumeBackupCode` compare-and-swap (`updateMany` where `twoFactorBackup: stored`) | No test runs two concurrent consumptions. Required before this is FIXED AND VERIFIED. |
| 15 | Raw exception text / stack traces to clients | ALREADY FIXED AND VERIFIED | `tests/security/error-leak-guard.test.cjs` | Passing. |
| 16 | Two realtime servers; development-secret fallback | FIXED AND VERIFIED (the legacy server's fail-closed behaviour is from the prior PR and was not re-tested here) | `socket-server.js` is authoritative; `mini-services/chat-service` refuses production and the public dev secret; `tests/integration/socket-authz.test.cjs`; `tests/security/socket-security.test.cjs` | **This session:** the compose `turn` and `app` TURN passwords no longer fall back to `fc-turn-dev-local`. |
| 17 | Behavioural tests for blocks, stories, calls, uploads, socket call signaling | FIXED AND VERIFIED | Blocks: `conversation-block.test.cjs`. Stories: **new** `tests/security/story-access.test.ts`. Calls: `tests/integration/socket-authz.test.cjs`. Uploads: `tests/security/upload-security.test.cjs`, `file-access.test.ts`. | Stories coverage is at decision level plus a route-source assertion. No live HTTP story test was added. |
| 18 | Direct friendship state-machine tests | OPEN | Only `tests/integration/friends.test.cjs` "friend request lifecycle: request, accept, list, remove" (1 test) | Reject, cancel, re-request after reject, and block-during-pending transitions are not directly tested. |
| 19 | One-time-code, 2FA, API-error security tests | OPEN (partial) | `tests/integration/security.test.cjs` "block enforcement, reactions, reset flow, 2FA and file access" is one combined test | OTP attempt-limit and expiry, and 2FA replay, need dedicated tests. |
| 20 | Pagination, cursor, filtering, ordering, concurrent-insertion tests | OPEN | No cursor-pagination or concurrent-insertion test was found in `tests/` | |
| 21 | Audit actual frontend import graph before removing components | OPEN | Not performed in this session | No component was removed. |
| 22 | Correct E2EE documentation | FIXED AND VERIFIED (prior PR; re-checked) | `docs/SECURITY_AUDIT.md`; `src/lib/e2ee.ts` and `src/hooks/useE2EE.ts` are not wired into message delivery | Re-checked by grep this session. The README and UI carry no end-to-end claim. |
| 23 | Current / historical / superseded documentation index | FIXED AND VERIFIED (this session) | `docs/README.md` | Index classifies every `docs/*.md` and `docs/archive/`. |
| 24 | Project metadata and security reporting guidance without invented licence or contact | PARTIAL — BLOCKED on owner input | **New** `SECURITY.md` | Policy written without an invented contact. Private vulnerability reporting is disabled (`{"enabled":false}`). No licence exists (`license: null`); the owner must decide. |
| 25 | Align Prisma, adapters, Node, npm | FIXED (lockfile and CI pins align); Prisma validate BLOCKED here | `package.json` (`prisma` and `@prisma/client` 6.19.3 installed), `ci.yml` pins Node 22.23.4, npm 10.9.9, Prisma 6.19.3; `npm ci` succeeded | `prisma validate` and `generate` need `binaries.prisma.sh`, which is unreachable from this sandbox. CI performs them. |
| 26 | Safe cleanup of expired sessions, stories, verified orphaned files | PARTIAL: sessions FIXED AND VERIFIED; stories and orphan files OPEN | **New** `src/lib/session-sweep.cjs` run from `socket-server.js` `runJobs`; `tests/integration/session-sweep.test.cjs` | Stories and orphaned-file deletion were not implemented: deleting story media needs grant-revocation review. |
| 27 | Secure streaming, upload handling, HTTP Range | PARTIAL: Range FIXED AND VERIFIED; streaming OPEN | **New** `src/lib/http-range.cjs`; `src/app/api/files/[id]/route.ts` returns 206/416 and `Accept-Ranges`; `tests/security/http-range.test.cjs` (6 tests) | The file is still read fully into memory to validate its signature before slicing. True streaming is not done. |
| 28 | Rate limits across all API routes and socket events | OPEN | `rateLimit()` in `src/lib/cache.ts` is used by 20 of 143 route files (`grep -rl rateLimit src/app/api`) | Most mutating routes have no limit. Socket events have per-event limits from `socket-security.cjs`. |
| 29 | Stale ringing calls stay active | FIXED AND VERIFIED | **New** `src/lib/call-sweep.cjs`, run from `runJobs`; `tests/integration/call-sweep.test.cjs` (2 tests, real SQLite) | Stale `ringing` rows move to `missed` after `CALL_RING_TIMEOUT_SECONDS` (default 60). Both parties get `call:timeout`. The update is conditional, so an answer that lands mid-sweep wins. Mutation check: removing the status guard fails the race test. |
| 30 | Verify story visibility, friendship, blocking, expiry, ownership before recording views | FIXED AND VERIFIED (decision level) | **New** `src/app/api/stories/[id]/view/route.ts` + `src/lib/story-access.ts`; `tests/security/story-access.test.ts` (7 tests) | Owners are not counted. Denials return 404 so story IDs cannot be probed. Mutation check: removing the friendship check fails 1 test. |

## Summary

| Classification | Findings |
|---|---|
| FIXED AND VERIFIED, or ALREADY FIXED AND VERIFIED (18) | 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 22, 23, 29, 30 |
| FIXED AND VERIFIED for the part CI exercised; the compose runtime part not run (2) | 2, 4 |
| FIXED, verification partly BLOCKED locally (Prisma binaries; CI runs it) (1) | 25 |
| BLOCKED WITH EXACT REASON (0 in this list; the runtime part of 2 and 4 is listed under "not run") | — |
| PARTIAL, waiting on owner input (1) | 24 |
| PARTIAL, sessions done and streaming/cleanup open (2) | 26, 27 |
| OPEN (6) | 14 (concurrency test), 18, 19, 20, 21, 28; plus the stories and orphan-file parts of 26 |

Finding 14 is counted as OPEN because its race has no concurrency test. Finding 12 is counted as verified on the basis of config, lint, typecheck, and build, not a hook-by-hook review.

Verification source for rows 2 and 4 is the GitHub Actions run `46159428630` on commit `a703a2c` (`https://github.com/engralaminn-collab/friendconnect_alo/actions/runs/46159428630`). The job-level and step-level conclusions were read from the GitHub API. The per-check `PASS:` lines inside those steps could not be downloaded from the sandbox, so they are not quoted here.

Nothing is counted as fixed on a static text search alone. Where a fix is verified only statically, the matrix says so.
