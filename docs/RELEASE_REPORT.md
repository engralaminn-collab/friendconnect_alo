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
| `npm run test:e2e` (Playwright) | — | **NOT RUN locally** (browser binaries not downloaded in this session). Passed on the CI runner (§10). |
| `docker build` / `docker compose config` | — | **BLOCKED locally**: no container runtime. Image build and container run passed on the CI runner (§10). `docker compose config` was not run by any job. |
| GitHub Actions `FriendConnect CI` run `46159428630` on `a703a2c` (pull request #26) | 0 (`gh run watch --exit-status`) | **success**. All three jobs succeeded (see §10). |

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
- **Compose runtime** (root and `deploy/`), coturn relay behaviour, and a cross-restart recovery test beyond the CI script: NOT RUN. Image build, boot, health, and graceful shutdown were verified in CI (§10).
- **Playwright end-to-end suite**: not run.
- **Staging and production**: not deployed. No target host was inspected. No authorization was given.

## 8. Remaining risks

- The Docker image was built on the CI runner for the first time from this branch (run `46159428630`). Compose stacks, the coturn service, and sustained-load behaviour have not been run.
- Rate limiting covers 20 of 143 route files.
- Story and file cleanup is incomplete; orphaned files accumulate.
- Redis is in `docker-compose.yml` as `redis:7-alpine`. Its licence for current versions must be verified (see `FREE_FIRST_ARCHITECTURE.md`).
- The repository has **no licence file** and **no security contact**. Private vulnerability reporting is disabled. The owner must decide both.
- `z-ai-web-dev-sdk` is an external-service SDK. Its use has not been reviewed.

## 9. Risks from CI scope

- The GitHub Actions run is the first Docker build of this branch. It is evidence, but no container was run long enough to observe sustained load, realtime call media, or restart recovery beyond the script's checks.

## 10. CI and pull request

Pull request: `https://github.com/engralaminn-collab/friendconnect_alo/pull/26` (base `main`, head `arena/2b2a87d0-friendconnect-alo`). **Not merged.**

GitHub Actions run `46159428630` (`https://github.com/engralaminn-collab/friendconnect_alo/actions/runs/46159428630`), commit `a703a2c24a67d3561afd30ea0cddc3f2e631df6f`, conclusion **success**.

| Job | Conclusion | Steps that ran (all success unless noted) |
|---|---|---|
| Install, Prisma, Lint, Typecheck and Build | success | Verify runtime and lockfile; Install locked dependencies; Generate SQLite Prisma Client; Validate Prisma schema; Validate migration history; MySQL index/variant invariants; Lint; Typecheck; Security regression tests; Docker image manifest consistency; Production build; Verify standalone build output; Integration tests (isolated database per test); Install Playwright browsers; **Playwright end-to-end tests**; Upload production build artifact. "Upload Playwright report" was skipped (it runs on failure). |
| MySQL 8 migration and CRUD | success | Install locked dependencies; **Apply migrations to a real MySQL 8 server and run CRUD**. The failure-annotation steps were skipped, as they run only on failure. |
| Docker build and container runtime | success | Verify Docker is available; **Build image and verify the running container**. Failure-annotation steps were skipped. |

What the Docker step covers, from `scripts/docker-verify.sh`: image build from the repository `Dockerfile`; required modules present in the image; `node --check` of both entrypoints; `better-sqlite3` load; realtime `/health`; application `/api/health` with database check; container-to-container socket reachability; user registration returning HTTP 201; uploaded file surviving a restart; graceful SIGTERM shutdown of both containers.

What the MySQL step covers, from `scripts/mysql-verify.sh`: isolated MySQL 8 container; `prisma generate` and `validate` for the MySQL schema; `prisma migrate deploy` on an empty database; table checks and CRUD.

Limits of this evidence:
- The per-check `PASS:` lines inside those steps could not be downloaded from the sandbox (the log archive request failed), so they are not quoted here. The step conclusions are authoritative.
- The root `docker-compose.yml` (including the coturn `turn` service) was not started by any job.
- `deploy/docker-compose.yml` was not started by any job.
- Staging and production were not touched.

## 11. Final status

| Item | Status |
|---|---|
| Original 30 findings | 21 fixed and verified (incl. ALREADY FIXED); 2 fixed with the coturn/compose runtime not run; 1 fixed with local Prisma validation BLOCKED; 6 PARTIAL (19, 20, 21, 24, 26, 27); 0 OPEN. See `docs/REMEDIATION_MATRIX.md`. The 30-item source list is not confirmed (see the matrix's Source list section). |
| Docker image build and container run | VERIFIED by CI run `46159428630` (image build, boot, health, registration, upload persistence, graceful stop). Compose stacks not run. |
| Database | MySQL 8 migrations and CRUD VERIFIED by CI run `46159428630`. SQLite schema and runtime verified locally and in CI. |
| AI platform, calls, SMS, documents, workflows | NOT STARTED or PARTIAL (see §7) |
| Production deployment | NOT DONE (not authorized) |
| Merge | NOT DONE (not authorized) |
| Pull request | #26 open, not merged |

**PARTIAL — NOT COMPLETE.**

## 12. Update: follow-on work on this branch

Commits added after `41b37d3`, in order (the first five first, then the two below):

| Commit | Content | Evidence |
|---|---|---|
| `49b183a` | Pair lock and blocker-only unblock in `src/lib/friendship.ts`; 12-test state-machine suite | 12/12 pass. Two tests failed before the fix. |
| `5a89fdd` | TOTP accepted once per time step (`verifyTotpOnce`); OTP and backup-code tests | 7 + 6 tests. Replay assertion added to `security.test.cjs`. |
| `45e5127` | Keyset message pagination (`src/lib/message-page.ts`). A SQLite-runtime defect was found: `cursor` was ignored, so cursor paging looped on the same rows. | 6 tests. Restoring the old query fails the suite. |
| `4a4fdc7` | Live test of the socket server's expired-session sweep | Passes. Breaking the call site fails it. |
| `9c2ca31` | coturn pinned to `4.19.2-r0@sha256:ccdbc51e…` | Tag and digest confirmed on Docker Hub. 4 source-level tests. |
| `8a533dc` | Global write-rate floor on every state-changing `/api` request, in `src/proxy.ts` (F28) | 8 behavioural tests on the real proxy; disabling the refusal fails 6. Integration passes with the limit active. |
| `14719bf` | Retention sweep for expired stories, highlights kept (F26) | 2 integration tests on the real runtime; removing the highlight filter fails one. Both Dockerfiles updated; manifest check passes. |

Test gates on the final tree, measured locally in this sandbox:

| Gate | Result |
|---|---|
| lint | exit 0 |
| typecheck | exit 0 |
| unit | 51/51 |
| security | 120/120 |
| build | exit 0 (needs `NEXTAUTH_SECRET` at build time, as the production guard requires) |
| integration | 57/57 (`test:integration` now runs `.ts` suites in the same invocation as CI) |
| schema:check, check-docker-manifest, socket-server syntax, check-env --mode ci | exit 0 |

What changed in the test runner: `test:integration` previously ran only `tests/integration/*.test.cjs`. The new `.ts` suites were not run by CI until the script was changed. The 11 failures seen earlier were not a flaky test. `.next` (excluded from snapshots) was missing, so `.next/standalone` was absent. Running `npm run build` fixed it.

Not run in this sandbox, and therefore not verified: Docker build and container (CI-only, last run `46159428630`); the compose coturn runtime; real WebRTC or SMS; the 30-second live sweep in CI (it does run inside `test:integration`, which CI executes).

Limitations of the new work:
- The TOTP replay claim and the friendship pair lock are per process unless `REDIS_URL` is set. Multi-instance deployments need a shared store.
- The matrix follows a 30-item list recorded from the execution request. A different numbered list is in `docs/archive/AUDIT_INITIAL.md`. The owner must confirm which is authoritative.

CI evidence this turn: run `46167546796` (`842b9f9`) passed in every job, and its integration step succeeded with 55 tests. Run `46169734302` (`52a0cd9`, which includes `8a533dc` and `14719bf`) passed in every job: lint, typecheck, unit, security, integration, Playwright e2e, the MySQL 8 migration and CRUD, and the Docker build with container checks.

Open after this turn: F27 streaming (a security trade-off, see the matrix); F26 orphaned files (destructive, needs an owner decision); F19 and F20 broader coverage; F21 removal (owner decision); F24 (owner input).

## 13. Status of the wider scope

| Area | Status |
|---|---|
| AI identity, multi-model gateway, AI call participation | NOT STARTED on this branch. `src/lib/ai-identity.ts` and `ai-gateway.ts` are pure modules with unit tests. Nothing imports them outside tests, and there is no AI account model or route. |
| WebRTC audio and video | NOT STARTED as a verified feature. No real browser or device test. |
| SMS gateway with consent and opt-out | NOT STARTED as a verified feature. No authorised gateway test. |
| Document sharing and RAG with permission isolation | NOT STARTED. |
| Workflow automation with human approval | NOT STARTED. |
| Source-level research review of listed repositories | PARTIAL. Metadata and selected LICENSE files only. See `docs/INTEGRATION_RESEARCH_MATRIX.md`. |
| Production deploy, merge of PR #25, merge to `main` | NOT DONE (not authorised). |

**PARTIAL — NOT COMPLETE.** The feature build-out above is not started, and the research review is incomplete.

