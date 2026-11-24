# Testing

What each suite covers, how to run it, and what it does **not** prove. Numbers
below are from the last full local run on this branch; see
[Current results](#current-results).

- [Quick reference](#quick-reference)
- [Suites](#suites)
- [What is deliberately not covered](#what-is-deliberately-not-covered)
- [Current results](#current-results)
- [Environment contract](#environment-contract)
- [Adding a test](#adding-a-test)

## Quick reference

```bash
# everything except E2E (needs browsers, see below)
npm run typecheck
npm run lint
npm run schema:check
npm run test:unit        # tests/ai, tests/jara
npm run test:security    # tests/security
NEXTAUTH_SECRET='local-only' NEXTAUTH_URL='http://127.0.0.1:3000' \
  DATABASE_URL='file:./db/build.db' npm run build
npm run test:integration # tests/integration — needs the build above
npm run test:e2e         # Playwright — needs `npx playwright install chromium`
```

`npm test` chains all of the above in that order. Integration tests spawn the
**standalone build** (`node .next/standalone/server.js`), so a stale build is the
most common cause of a confusing integration failure: rebuild first.

## Suites

### `tests/ai/*.test.ts`, `tests/jara/*.test.ts` — unit

Prompt construction, input validation, the Jara governance rules and the
evaluation scenario schema. Pure functions over fixtures; no server, no database.
Run with `tsx --test` because they import TypeScript modules directly.

### `tests/security/*.test.ts`, `tests/security/*.test.cjs` — security regression

One file per finding class, written to fail if the vulnerability returns:

| File | Proves |
| --- | --- |
| `socket-security.test.cjs` | `canInteract`/`isMessageParticipant` matrix: block beats friendship, stale `BLOCKED` rows still deny, default `FRIENDS` refuses strangers, missing profile denies, Jara stays reachable |
| `redis-failure.test.cjs` | the cache/rate-limit layer degrades to memory when Redis is configured but unreachable, and never throws into a request |
| `session-registry.test.cjs` | revoked/expired/ambiguous sessions resolve to `null` rather than inheriting another device's row |
| `upload-security.test.cjs` | magic-byte detection, allow-list enforcement, SVG/script payloads rejected, download headers |
| `file-access.test.ts` | grant model: owner/participant/group/story/profile resolution, expiry, idempotency, public-decision caching, and that the `.cjs` core used by the socket server issues the same grants as the app facade |

### `tests/integration/*.test.cjs` — integration

Each file starts its own server on a free port with its own throwaway SQLite file
and upload directory, then talks to it over HTTP and Socket.IO. Nothing here
touches `DATABASE_URL`, a real mailbox or a real AI provider.

| File | Proves |
| --- | --- |
| `session-api.test.cjs` | NextAuth and legacy login, `/api/me`, session listing/revocation, private upload then download (403 for a stranger, 200 for a message recipient), socket disconnect after revocation, logout; Jara history injection refused; group per-user delete visibility; AI provider isolation |
| `authz-drift.test.cjs` | REST routes import the shared authorization helper instead of re-deriving it, and the helper's answers match the expected matrix for every relationship state |
| `db-runtime.test.cjs` | the SQLite runtime: `Date`/`Boolean` coercion, `$transaction` (callback + array, rollback on throw), `groupBy`/`aggregate`, the full `include` matrix, nested writes with rollback and nested ids surviving a transaction, boot refusal on a half-migrated database, metadata coverage of all 52 models |
| `polls.test.cjs` | poll creation validation (blank/duplicate/too many options, past expiry, non-member), participant-only voting and reads, option-range checks, concurrent votes collapsing to one, expiry closing a poll while preserving its tally |
| `socket-authz.test.cjs` | handshake rejects missing/expired/revoked tokens, event authorization, scoped presence |
| `friends.test.cjs`, `security.test.cjs` | friend request/accept contract, blocked and unauthorized access paths |

### `tests/e2e/*.spec.ts` — Playwright

Browser-level flows against the standalone build, driven by
`playwright.config.ts` → `e2e/serve.cjs` (which allocates the ports, a temp
SQLite file, a temp upload directory and a non-production secret). The chat spec
registers two users and exchanges a message through the real UI, which is the
only place the client and server halves are exercised together.

## What is deliberately not covered

Stated plainly, because a green suite that overstates itself is worse than a
small honest one:

- **E2E has not been executed in this development environment.** Playwright's
  browser CDN (`cdn.playwright.dev`, `playwright.azureedge.net`) is not
  reachable here and there is no system browser, so `npx playwright install
  chromium` fails. The spec and config are real and CI runs them
  (`.github/workflows/ci.yml`), but the claim "E2E passes" can only be made from
  CI output.
- **The MySQL path is not exercised by automated tests.** CI validates the
  generated MySQL schema and migration (`prisma validate`,
  `prisma migrate diff --from-empty`) and the drift check, but no test runs the
  app against a live MySQL server. Verification there is a deploy-time activity
  (see [`DEPLOYMENT_AND_RECOVERY.md`](DEPLOYMENT_AND_RECOVERY.md)).
- **WebRTC media is not tested end to end.** Signaling is relayed by the socket
  server and authorization is covered; actual peer-to-peer audio/video across
  NATs depends on TURN and on two real browsers/networks.
- **Real external services are stubbed.** SMTP, S3, web push and AI providers are
  mocked in tests (the session test runs a local mock provider). Provider
  behaviour in production is a configuration task, not a test result.
- **Load and concurrency limits beyond the SQLite writer are untested.** The
  poll test covers concurrent writes on one process; multi-process behaviour
  needs Redis and is documented as a deployment constraint instead.

## Current results

Last full local run on this branch:

| Command | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run schema:check` | PASS (variants, metadata, DDL, MySQL migration, drift) |
| `npm run test:unit` + `test:security` | 63/63 pass |
| `npm run test:integration` | 18/18 pass |
| `npm run build` | clean |
| `npm run test:e2e` | **not run here** — browsers unavailable; executed by CI |

Integration tests need a fresh standalone build; each run logs the additive
migrations it applied, which is expected on a new database file.

## Environment contract

Tests must never point at production. The suites assume:

- `DATABASE_URL=file:…` into a temporary directory (integration tests override it
  per test; they do not read the ambient value);
- `NEXTAUTH_SECRET` set to any non-production value;
- `REDIS_URL=''` (empty, not unset) so the memory path is used deterministically —
  `redis-failure.test.cjs` is the only place a Redis URL is set, and it is an
  unreachable one;
- AI provider variables cleared so no test can reach a real provider;
- `UPLOAD_DIR` inside the temporary directory, removed on teardown.

CI mirrors this in `.github/workflows/ci.yml` with localhost URLs only.

## Adding a test

- Prefer an integration test when the behaviour crosses a boundary (route ↔
  database ↔ socket). It is the only kind here that can catch a broken `include:`
  or an authorization drift.
- Give the test its own database file, port and upload directory; the suites run
  in parallel and share no state.
- Assert the failure mode, not just the happy path: a test for a 403 must also
  show the 200 path for an authorized caller, otherwise a route that always
  denies would pass.
- If a finding is fixed in two places (REST and socket), assert both. Several
  findings in this project were "fixed" on one side only.
- Never reopen a hole to make a test simple. If real authorization gets in the
  way of a fixture (for example direct messages require an accepted friendship),
  make the fixture befriend the users rather than weakening the check.
