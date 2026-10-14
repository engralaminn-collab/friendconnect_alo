# FriendConnect ALO production-readiness audit

**Audit date:** 2026-10-15
**Scope:** this checkout, the reachable GitHub repository/branch metadata, and non-invasive local resolver checks. No Ubuntu/Tailscale session was established; no production filesystem, PM2 app, MySQL database, Redis instance, media directory, or Caddy configuration was accessed or changed.

## Executive finding

The exact GitHub repository exists and is private: `engralaminn-collab/friendconnect_alo`; the authenticated GitHub CLI account can view it with `ADMIN` permission. GitHub `main` is currently `07fbaf392f7aa4be52b4d8397acf70f3b7936175`, the same commit as the starting checkout. The current working tree contains uncommitted changes on the required Arena branch. It has not been pushed or merged.

The checked-out source does **not** match the production architecture described in the deployment request. It is a Vite + React SPA and a Firebase-backed Flutter app. It contains no Next.js application, Prisma schema/migrations, `socket-server.js`, or 23-table production schema. A separate Node/Express/Socket.IO/MySQL implementation has been added under `server/`; an optional React route at `/self-hosted` calls that service. This route is an integration surface, not a cutover: it has only been type-checked/built, and the API has not been run against production or the existing `db_friendconnect`. The normal web routes and Flutter client still use Firebase. Replacing the existing production application, baselining Prisma, or configuring PM2 from this checkout would be unsafe.

**No production deployment or migration is claimed.** This audit treats the server table counts, live service status, and HTTPS timeout in the prompt as user-reported, not independently verified facts.

## Repository, credentials, and access checks

- `gh repo view` reports the exact repository as **private** and the current CLI viewer as **ADMIN**. `git ls-remote` and REST lookup report `main` at `07fbaf392f7aa4be52b4d8397acf70f3b7936175`; no remote Arena branch exists yet.
- The Arena GitHub connector returned `unsupported` in this session. The GitHub App installation itself could not be verified: the repository-installation API rejected the available CLI integration token (401), and the self-hosted-runner API returned 403. Direct GitHub CLI/repository access works; this does not prove the separate GitHub App installation or runner permissions.
- The sandbox checkout has `origin` configured; the user's statement that the Ubuntu clone has no remote is unverified because that host was not accessed.
- The checkout and reachable GitHub `main` contain only `.env.example` / `server/.env.example`; no real `.env` file is present locally or tracked on `main`, and no `.env` path was found in reachable Git history. A limited heuristic scan found no common private-key, GitHub/AWS/Slack/npm/Twilio/Stripe-token, or credential-bearing database-URL patterns. This is not a comprehensive secret audit and says nothing about the production `/home/aloedu/friendconnect/.env`. That file was not read, changed, or rotated.
- A local rollback snapshot was created outside the repository: `/home/user/friendconnect_alo-predeploy.bundle` (SHA-256 `543fec6c983aeb4d50cd036a5edd0859a803b62bffa925df619c37ce14b421b5`) and `/home/user/friendconnect_alo-predeploy-working-tree.tar.gz` (SHA-256 `90f7b4769a95c4aa8376fe9c4f7ec13a853270187e2b83ba4aa09402a1c22ff2`). These are workspace source/Git snapshots, **not** a production database or media backup.
- There is no `tailscale` binary or runner service installed in this sandbox. DNS through the sandbox resolver returned A record `103.231.239.79` for `panel.alolabs.net`, but this does not verify authoritative DNS, the VPS/router WAN IP, NAT, firewall, ISP ingress, Caddy, certificate, public HTTPS, WebSockets, or TURN. The environment cannot reach arbitrary public hosts, so no external HTTPS or TURN probe was performed.

## Feature inventory

`IMPLEMENTED` means source exists; it does not imply production operation. `BROKEN` identifies a known defect in the current Firebase path. `SIMULATED` is explicitly local/demo behavior. `MISSING` means no implementation was found for the stated acceptance criterion in this checkout.

| Area | Status | Evidence / limitation |
|---|---|---|
| Next.js frontend/backend on port 3014 | **MISSING** | Root `package.json` and `vite.config.ts` build a Vite SPA. No `next` dependency or Next config/app exists in the checkout or current `main`. |
| Separate Socket.IO PM2 process on port 3114 | **MISSING** | `server/` runs Express + Socket.IO together as one example API process. No `socket-server.js` or two-process production configuration matching PM2 `friendconnect` + `friendconnect-socket` exists here. Do not combine, replace, or restart production PM2 processes based on this source. |
| Existing production MySQL/23-table Prisma model | **MISSING** | No Prisma schema, Prisma CLI, `prisma/migrations`, or comment-only `20260807120000_init` file exists in this repository. Production schema/table counts cannot be introspected from the sandbox. |
| MySQL backup and restore verification | **MISSING** | Local signed/encrypted backup scripts exist for the new service, but there is no production MySQL option file, credential, dump, or isolated restore DB here. No production backup or restore was run. |
| Existing live Firebase authentication | **IMPLEMENTED** | The current web/Flutter clients use Firebase email/password Auth and profile checks. This remains the default live path, not the requested MySQL/Argon2id platform. |
| Self-hosted invite-only registration | **IMPLEMENTED** | Parallel API uses random single-use expiring invite tokens, Argon2id, hashed verification/reset tokens, persisted sessions, lockout, and admin-gated invite/suspension code. Requires MySQL/SMTP and has not been integration-tested against them. |
| Browser self-hosted route | **IMPLEMENTED** | Feature-flagged React route `/self-hosted` integrates auth, friends, direct/group chats, pagination, receipts, reactions, edits/deletes, and private attachment upload/download against the parallel API. Root Vite build/type-check pass. No production deployment or browser-to-real-MySQL test has been performed. |
| Main web-client cutover | **MISSING** | Normal routes still initialize and use Firebase. The optional route is isolated behind `VITE_SELF_HOSTED_API_ENABLED`. |
| Flutter API/auth migration | **MISSING** | Flutter remains Firebase-backed; no first-party secure-storage/REST/Socket.IO integration or Flutter build exists. Flutter/Dart SDK is unavailable here. |
| Friendships/direct and group messaging | **IMPLEMENTED** | MySQL repository/API enforces friendship and membership, supports groups up to 30, messages, edits/deletes, reactions, cursor paging, and receipt state. Tests use fakes; no 23-table production data import or MySQL integration test exists. |
| Realtime delivery, typing, presence, Socket.IO revocation notice | **IMPLEMENTED** | Authenticated Socket.IO rooms revalidate sessions and check membership. Session revocation now waits up to 1.2 seconds for a client ACK before forcibly disconnecting; the test verifies notice-before-disconnect behavior. No production socket on port 3114 or real browser/account delivery was verified. |
| Stories | **MISSING** | No story schema/API/client was found. |
| Starred messages | **MISSING** | No persisted star/bookmark API or UI was found. Reactions are not starred messages. |
| Message search | **MISSING** | No authorized server-backed message-search endpoint/UI was found. |
| Private attachments and permissions | **IMPLEMENTED** | Parallel API uses private UUID object keys, size/type checks, ClamAV fail-closed scanning, quotas, member-checked upload/download, and private permissions. It is not integrated into the existing Firebase app and was not tested against production storage. |
| Push notifications | **BROKEN** | Existing Firebase Function payload assumptions mismatch current writers. The parallel API has persisted notifications and a Web Push sender, but no service worker/browser subscription UI or Flutter background-push migration is integrated. |
| Audio/video WebRTC UI and cross-network calls | **MISSING** | The API persists call state/history and securely relays signaling and mints temporary TURN credentials, but no client call UI uses it. Existing Firebase WebRTC paths remain. No call between real devices or networks was tested. |
| Coturn configuration and external reachability | **MISSING** | The API can mint temporary credentials, but no production Coturn config is included or changed. Port 3478 status from the prompt was not independently checked; public IP/NAT, relay ranges, TLS, firewall, and external call path remain unverified. |
| Self-hosted database migration / Prisma baseline | **MISSING** | There is no Firebase/production data export/import or existing-database schema comparison. Do not create a baseline from the parallel service schema or mark it applied to `db_friendconnect`. |
| CI | **IMPLEMENTED** | `.github/workflows/ci.yml` now targets a custom `[self-hosted, linux, x64, friendconnect-ci]` runner for lockfile installs, TypeScript check, Vite build, tests, audits, and script syntax. The workflow is unpushed and the runner label/installation is unverified. No pull-request code runs on that runner. |
| Production CD and rollback | **MISSING** | No deploy workflow/script has been connected to the target PM2 release layout. The checkout's Vite/combined-API topology is incompatible with the stated Next.js/two-PM2 deployment. A release/symlink/PM2/Caddy script would risk replacing a different working application without a server inventory. |
| Existing Caddy/HTTPS and other sites | **MISSING** | No Caddy config, cert, firewall, unrelated site, or PM2 process was inspected or changed. Public timeout cause is not diagnosed. |
| ESLint | **MISSING** | There is no ESLint dependency, config, or lint script in `main`; `npm run lint` is `tsc --noEmit`, not ESLint. The reported 38 ESLint errors may refer to the separate production checkout and could not be reproduced here. |

## Local verification performed

- `npm run lint` — passed (`tsc --noEmit`).
- `npm run build` — passed as a **Vite** production bundle, not a Next.js build.
- `npm run test:server` and `npm run check:server` — **18 Node tests passed** (auth/CSRF, invite flow, Socket.IO authorization/revocation acknowledgement, ClamAV behavior, media permissions, TURN credential derivation, and constrained backup extraction). These use local fakes/test fixtures; they do not prove MySQL production behavior.
- `bash -n server/scripts/backup.sh server/scripts/restore.sh` and `python3 -m py_compile server/scripts/safe_extract.py` — passed; no backup or restore operation was executed.
- Root and server `npm audit --audit-level=low` — **0 reported vulnerabilities** after non-forced lockfile updates and a narrow `@grpc/grpc-js` override. Firebase remains present because removing it before verified data/client cutover would risk the current app.

## Safety decisions and blockers

- No production `.env`, database password, JWT/TURN/VAPID secret, backup, media, PM2 service, Caddy route, or domain configuration was read, overwritten, rotated, or deleted.
- The target path `/home/aloedu/friendconnect` and its `.env`, 23 MySQL tables, 13 users, 14 messages, 43 calls, ports 3014/3114/3478, Redis, PM2 apps, and Caddy are user-reported and remain unverified by this session.
- No SQL or Prisma command was run against any production or disposable DB. No migration is marked applied. The safe next step is **not** to run `migrate deploy`; first the exact production source/Prisma files, installed CLI version, credentials-file setup, consistent dump, and isolated restore must be obtained and checked on the server.
- The Arena GitHub connector is unsupported here; direct GitHub CLI access works. GitHub `main` has no current workflow file. The new self-hosted CI workflow is only in the working tree; runner registration/status could not be queried with the available token.
- No production-compatible deployment workflow was added, no GitHub push/PR/merge occurred, and no deployment was attempted. This avoids replacing a live Next.js app with the unrelated Vite source or disturbing either PM2 process.

## Production acceptance still outstanding

1. Establish authorized Tailscale/SSH access and snapshot the **actual Ubuntu source + Git metadata**, PM2 configs, Caddy routes, runner state, firewall/NAT, and unrelated services without displaying `.env` values.
2. Compare that source with GitHub and this checkout before synchronization; recover the actual Next.js/Prisma/socket-server runtime files or reconcile the repository's intended architecture.
3. Make a consistent MySQL backup, restore to an isolated disposable database, compare all 23-table schema/counts, and only then produce/verify the correct Prisma baseline. Never run destructive Prisma commands or automatically migrate production.
4. Complete the main web + Flutter cutover, profile/story/starred/search/notification/call UI, private media, cross-account authorization, and two-device tests without deleting existing data or Firebase fallback until acceptance and rollback are verified.
5. Inspect public DNS authority, public/WAN IP, NAT/router/firewall/ISP, existing Caddy host routing/certificate, WebSocket upgrades, and external Coturn relay connectivity. Do not change unrelated domains.
6. Register and verify an isolated unprivileged self-hosted runner; then implement and test release-directory activation, process-specific PM2 restart, health checks, rollback, and commit logging against the actual Next.js + Socket.IO layout. Do not deploy this Vite checkout to ports 3014/3114.

## Conclusion

The repository is private and accessible through the authenticated CLI, local code checks pass, dependency audit is clean, and a tested parallel API plus optional browser route exists. However, the verified source does not contain the production Next.js/Prisma/two-process system described in the request, and no server session, database backup/restore, live schema comparison, public-network test, self-hosted runner, or release rollback test is available. **FriendConnect ALO is not production-complete or deployed.**
