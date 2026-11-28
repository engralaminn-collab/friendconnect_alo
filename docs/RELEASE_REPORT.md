# Release report: branch `arena/2b2a87d0-friendconnect-alo`

**Verdict: PARTIAL — NOT COMPLETE.**

This branch completes a verified subset of the 30-finding remediation and fixes several defects found during verification. It does **not** deliver the AI platform, audio/video AI participation, SMS, document intelligence, workflow automation, or the external-repository review requested. Those are listed under "Not done" below. Nothing here has been deployed, merged, or run against a production system.

## 1. Repository state

| Item | Value |
|---|---|
| Repository | `engralaminn-collab/friendconnect_alo` (public, default branch `main`) |
| Working branch | `arena/2b2a87d0-friendconnect-alo` (status: active) |
| Starting commit | `ba1f0ee43eb3afa1626fcef459b7f231ee88f151` (merge of PR #25 into `main`) |
| PR #25 | `https://github.com/engralaminn-collab/friendconnect_alo/pull/25` — **MERGED** at `2026-11-28T14:57:35Z`. Its recorded head was `f85c7afa5adccd42499594938b78fa0b84dfcee7`. The request named head `arena/d188d202-friendconnect-alo` and commit `0686ef3`; both are superseded by the merge. |
| Open pull requests before this work | none |
| Working tree before this work | clean (`git status --short` empty) |
| Remotes | `origin` = `https://github.com/engralaminn-collab/friendconnect_alo.git` |

The request asked to verify the PR head before editing. That was done: the PR is already merged into `main`, and this branch contains it. No merge was performed in this turn.

## 2. Environment

| Item | Value |
|---|---|
| Node | v22.22.3 (CI pins 22.23.4; not reproduced exactly) |
| npm | 10.9.8 (CI pins 10.9.9) |
| Install | `npm ci --ignore-scripts`, then `npm rebuild better-sqlite3` with `npm_config_nodedir=/usr/local`. Succeeded. |
| Docker / Podman / nerdctl | **Not available.** No `/var/run/docker.sock`. |
| `binaries.prisma.sh` | **Unreachable** (TLS disconnect). `prisma validate` and `prisma generate` cannot run here. |
| `registry.npmjs.org`, `github.com` API | Reachable |

## 3. Commands and results (final run on this branch)

Exit codes are from the shell. Counts are from the TAP summary.

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | 0 problems |
| `npm run typecheck` | 0 | 0 errors (after one fix: see §6) |
| `npm run test:unit` | 0 | 51 / 51 pass |
| `npm run test:security` | 0 | 101 / 101 pass (baseline before this work: 84) |
| `npm run build` | 0 | Next.js production build with standalone output |
| `npm run test:integration` | 0 | 30 / 30 pass against the production build (baseline: 27) |
| `npm run schema:check` | 0 | No drift; canonical models 53, runtime delegates 53, migration tables 53; provider parity PASSED |
| `node scripts/check-docker-manifest.mjs` | 0 | Both images consistent (2 checked) |
| `node scripts/check-env.mjs --mode ci` | 0 | Env check PASSED |
| `node --check socket-server.js` | 0 | Syntax OK |
| `npx prisma validate --schema prisma/schema.sqlite.prisma` | — | **BLOCKED**: cannot fetch schema engine from `binaries.prisma.sh` |
| `npm run test:e2e` (Playwright) | — | **NOT RUN**: browser binaries not downloaded in this session |
| `docker build` / `docker compose config` | — | **BLOCKED**: no container runtime |
| GitHub Actions run for this branch | — | See §9 |

Each new test was run and then checked for failure under a temporary mutation of its fix. The mutated file was restored byte-for-byte afterwards.

| New test | Mutation | Result |
|---|---|---|
| `tests/integration/call-sweep.test.cjs` (race) | removed `status: 'ringing'` guard | fails (1 of 2) |
| `tests/security/story-access.test.ts` | removed friendship check | fails (1 of 7) |
| `tests/security/http-range.test.cjs` | route ignores Range | fails |
| `tests/security/proxy-headers.test.ts` | removed `X-Frame-Options` | fails (2 of 3) |
| `tests/integration/session-sweep.test.cjs` | deletes every session | fails (1 of 1) |

## 4. Changes on this branch

### Modified
- `docker-compose.yml`: `turn` service now uses coturn (was: `scripts/turn-server.js` in the app image, which relays nothing without `node-turn`). `TURN_EXTERNAL_IP` and `TURN_PASSWORD` are required; the development password fallback was removed from the `turn` and `app` services. The coturn service publishes the relay range `49160-49200/udp`.
- `Dockerfile`, `deploy/Dockerfile.app`: copy `src/lib/call-sweep.cjs` and `src/lib/session-sweep.cjs`, which the socket server requires.
- `socket-server.js`: `runJobs()` now (a) deletes expired sessions, (b) marks stale `ringing` calls as `missed` and emits `call:timeout` to both parties.
- `src/app/api/files/[id]/route.ts`: single-range HTTP Range support (206, 416, `Accept-Ranges`).
- `src/app/api/stories/[id]/view/route.ts`: story views are authorized (owner, accepted friend, not blocked, not expired) before recording. Denials return 404.

### New
- `src/lib/story-access.ts` — pure view-authorization decision.
- `src/lib/call-sweep.cjs` — stale-ring expiry with conditional update.
- `src/lib/session-sweep.cjs` — expired-session deletion.
- `src/lib/http-range.cjs` — single-range parser.
- Tests: `tests/integration/call-sweep.test.cjs`, `tests/integration/session-sweep.test.cjs`, `tests/security/story-access.test.ts`, `tests/security/http-range.test.cjs`, `tests/security/proxy-headers.test.ts`.
- Docs: `SECURITY.md`, `docs/REMEDIATION_MATRIX.md`, `docs/INTEGRATION_RESEARCH_MATRIX.md`, `docs/FREE_FIRST_ARCHITECTURE.md`, `docs/README.md`, `docs/RELEASE_REPORT.md`.

### Database and migrations
**None.** No Prisma schema change, no migration, no data change. The session and call sweeps delete or update rows that are already invalid (expired sessions) or abandoned (stale ringing calls). Rollback is a code revert.

### Environment and secrets
No `.env` file was created or modified. No credential, token, or key was added to the repository. Test values were supplied only as process environment variables for local runs.

## 5. Behavioural changes that operators must know about

1. **`docker-compose.yml` now requires `TURN_PASSWORD` and `TURN_EXTERNAL_IP`.** `docker compose up` fails with a message if either is unset. This is intentional: it removes a development password from production configuration.
2. **Stale calls end.** A call in `ringing` for longer than `CALL_RING_TIMEOUT_SECONDS` (default 60, range 10–600) becomes `missed`. Users can call again.
3. **Story views by non-friends or blocked users return 404** instead of being recorded.
4. **Expired sessions are deleted** by the realtime server's 30-second job loop. Expired sessions could not authenticate before, so no active user is affected.
5. **Range requests on downloads** return 206. Clients that never sent a Range header see no change.

## 6. Defects found and fixed during verification

- A TypeScript narrowing error (`range.end` possibly undefined) introduced by the first Range implementation broke `typecheck` and `build`. Fixed with a JSDoc discriminated-union type on `parseRange`. The integration suite initially dropped to 19/30 because the build had failed; it returned to 30/30 after the rebuild. The failure was caused by my change, not by an environment issue.
- The root `docker-compose.yml` TURN service would have started and relayed nothing (see §4).

## 7. Not done (open)

These are **OPEN**. None is claimed as complete.

- **AI identity, AI permissions, and the multi-model gateway** (Phases 2–3). Existing code: `src/lib/ai-identity.ts`, `src/lib/ai-gateway.ts`, the Jara assistant, with unit and security tests (within the 101 passing security tests). Not extended. Not verified against any live provider.
- **Audio/video AI participation, speech-to-text, text-to-speech, consent flows** (Phases 4–5). Not started.
- **Human audio/video calls on real devices and browsers.** Not tested. Signaling is covered by `tests/integration/socket-authz.test.cjs`; media is not.
- **SMS** (Phase 6). Twilio code exists for Jara but is not activated; no provider call was made. Not verified.
- **Document sharing, reference library, AI document assistant** (Phases 7). Not started beyond the existing file-access model.
- **Workflow automation** (Phase 9). Not started.
- **External repository source review** (Phases 4, 8–16, 18–19). Metadata and licence checks only; see `docs/INTEGRATION_RESEARCH_MATRIX.md`.
- **Findings 14, 18, 19, 20, 21, 26 (stories and orphan files), 27 (streaming), 28 (rate limits on 123 of 143 route files)** — see `docs/REMEDIATION_MATRIX.md`.
- **Finding 4 and the MySQL path**: CI job exists; not executed here.
- **Docker image build and runtime, Compose runtime, health check, graceful shutdown, restart recovery**: BLOCKED (no runtime).
- **Playwright end-to-end suite**: not run.
- **Staging and production**: not deployed. No target host was inspected. No authorization was given.

## 8. Remaining risks

- The Docker image has never been built from this branch. Several fixes depend on static manifest checks and on `require()`-graph analysis.
- Rate limiting covers 20 of 143 route files.
- Story and file cleanup is incomplete; orphaned files accumulate.
- Redis is in `docker-compose.yml` as `redis:7-alpine`. Its licence for current versions must be verified (see `FREE_FIRST_ARCHITECTURE.md`).
- The repository has **no licence file** and **no security contact**. Private vulnerability reporting is disabled. The owner must decide both.
- `z-ai-web-dev-sdk` is an external-service SDK. Its use has not been reviewed.

## 9. CI and pull request

- GitHub Actions: the `FriendConnect CI` workflow runs on pull requests to `main`. Its result for this branch is recorded in §10. The local gate commands above are not a substitute for a runner result.
- Pull request: recorded in §10.

## 10. Final status

| Item | Status |
|---|---|
| Original 30 findings | 18 fixed and verified; 2 fixed with static-only verification (Docker runtime BLOCKED); 25 fixed with local Prisma validation BLOCKED; 4 BLOCKED; 24 PARTIAL on owner input; 26 and 27 PARTIAL; 14, 18, 19, 20, 21, 28 OPEN. Full matrix: `docs/REMEDIATION_MATRIX.md`. |
| Docker build and runtime | BLOCKED: no container runtime |
| Database (MySQL and migration execution) | BLOCKED for MySQL; SQLite schema and runtime tested locally |
| AI platform, calls, SMS, documents, workflows | NOT STARTED or PARTIAL (see §7) |
| Production deployment | NOT DONE (not authorized) |
| Merge | NOT DONE (not authorized) |

**PARTIAL — NOT COMPLETE.**
