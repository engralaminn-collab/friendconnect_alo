# FriendConnect — CI/CD, environment and deployment reliability map (verified from the repository)

**Status date:** 2026-11-28 · **Branch context:** `arena/57297ae4-friendconnect-alo` (PR #24)
**Scope note:** this document is built from the repository only. The production server
(domain mapping, PM2 state, Nginx/Caddy, DB) is **not reachable from the build sandbox** and
is therefore explicitly marked UNVERIFIED below — nothing here invents server state.

## 1. Architecture map (as found in-repo)

| Area | Existing configuration (verified in-repo) | Risk | Action taken / required |
|---|---|---|---|
| GitHub workflows | `.github/workflows/ci.yml` (only workflow; there is no deploy workflow in this repo) | deploy config lives outside the repo | verify external deploy automation (repo vars `ALO_SERVER_*`, `AUTO_DEPLOY_MAIN=false`) with the operator |
| Runtime | Node 22 (`Dockerfile` `node:22-bookworm`, `engines.node >=20.11`, CI `NODE_VERSION=22.23.4`) | version drift | `packageManager` now `npm@10.9.9` (matches CI `NPM_VERSION` and repo variable) |
| Package manager | npm + committed `package-lock.json` + `npm ci` | lock drift | **fixed** — lock was missing `yjs`/`lib0`/`isomorphic.js`/`@types/dom-mediacapture-record` (peer deps of `@lexical/yjs`, `livekit-client`); `npm ci` failed on main and on PR #24 before `987e158` |
| Database | Prisma (SQLite default, MySQL/MariaDB variant); `prisma/schema.prisma` + generated `schema.sqlite.prisma`/`schema.mysql.prisma`; dual migrations under `prisma/migrations/mysql` + `prisma/migrations/sqlite`; additive `JaraJob` migration in PR #24 | schema drift | CI gates: prisma validate (both providers), `prisma migrate diff` render check, `schema:check` drift detection, `tests/security/schema-variants.test.cjs` — all present |
| Test DB isolation | Integration tests create a temp SQLite DB + own port per test file | low | none needed |
| Env validation | Scattered per-module checks (e.g. `auth.ts` fails closed on missing `NEXTAUTH_SECRET` in prod) | no central gate | **added** `scripts/check-env.mjs` + `npm run env:check` + CI step (`--mode ci`) |
| Build | `npm run build` → `next build` + standalone copy; verified in CI (standalone server + static) | — | none |
| Docker | `Dockerfile` (Next standalone + socket-server, non-root `fc`, HEALTHCHECK `/api/health`) | not built in CI | CI builds artifact only; Docker image build not exercised — build it on the host before relying on it |
| Process manager | `ecosystem.config.cjs` (PM2: `friendconnect` app + `${NAME}-socket`) | config drift | reload with `pm2 reload ecosystem.config.cjs && pm2 save` |
| Reverse proxy | `Caddyfile`, `Caddyfile.production`, `deploy/learn.aloeducation.com` present | not verified | validate with `caddy validate` on the host |
| Health | `/api/health` checks DB + realtime + redis (degraded-aware); `/api/health/ready` used by deploy automation | — | verify externally via `APP_HEALTHCHECK_URL` |
| Monitoring | logs to `logs/` via PM2; `logger.ts` structured JSON | no metrics/tracing | acceptable at current scale; consider uptime checks against `/api/health` |

## 2. CI pipeline (`.github/workflows/ci.yml`) — stage inventory

Checkout → Node setup (pinned 22.23.4, npm cache) → npm 10.9.9 → **lockfile/runtime verification** (`next`, `react`, `socket.io`, `prisma` exact versions) → **Environment validation (new)** → `npm ci` → Prisma client (SQLite) → schema validate ×3 (SQLite/MySQL URLs) → migration render check → schema drift check → MySQL invariants → lint → typecheck → unit → security → realtime `node --check socket-server.js` → production build → standalone output check → integration (isolated DB per test, TAP report + annotations) → Playwright e2e against the production build → artifact upload.

`permissions: contents: read` · concurrency cancels stale PR runs · no secrets consumed · e2e/integration failures surface as annotations, not silent green.

**Observed CI status:** PR #24 job `46125356538` ✅ (3m30s) — see PR #24 checks.

## 3. Environment validation usage

```bash
npm run env:check                       # infers mode from NODE_ENV
node scripts/check-env.mjs --mode ci    # what GitHub Actions runs
node scripts/check-env.mjs --mode production
```

- Validates **names and shapes only** (URLs parse, schemes allowed, ports 1–65535, required-in-prod = `DATABASE_URL` + `NEXTAUTH_SECRET`, production `NEXTAUTH_SECRET` ≥ 32 chars).
- **Never prints secret values** — only names and the complaint.
- Exits 1 on a blocking problem; warnings (AI provider, email, Redis fallback) never block.
- Mode `ci` requires `DATABASE_URL` + `NEXTAUTH_SECRET` — both are set by the CI job.
- All variables referenced by the code are now listed by name in `.env.example` (see the new "Referenced-but-optional aliases" block).

## 4. Deployment posture (repository view; server UNVERIFIED)

The repo does **not** contain a deploy workflow — production runs from the host via PM2 (`ecosystem.config.cjs`) with `APP_DIR` and `FRIENDCONNECT_DIR` (`/home/alamin/alolabs-projects/friendconnect_alo`) and variables such as `APP_HEALTHCHECK_URL=https://panel.alolabs.net/api/health`, `AUTO_DEPLOY_MAIN=false`. Per the incident history, deploys are manual/dispatch-driven.

Safe host procedure (verify names against the host before running):

```bash
cd /home/alamin/alolabs-projects/friendconnect_alo
git fetch origin && git status --porcelain   # must be clean
git log --oneline -1                          # expect the merged commit (or PR head)
cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"     # back up config first
npm ci --include=dev
npx prisma validate --schema prisma/schema.mysql.prisma
npx prisma migrate status --schema prisma/schema.mysql.prisma   # review before applying
npm run schema:check
npm run build                                  # NEXTAUTH_SECRET needed for build-time page data
npm run env:check -- --mode production         # or: node scripts/check-env.mjs --mode production
pm2 reload ecosystem.config.cjs --update-env && pm2 save
curl -fsS http://127.0.0.1:${PORT:-3000}/api/health
curl -fsS https://panel.alolabs.net/api/health
```

Migrations are **expand-only** in this repo (e.g. `20261124000000_complete_jara_tables` is `CREATE TABLE IF NOT EXISTS`). No destructive migration exists in the tree; do not add one without a separately approved change.

## 5. Known defects fixed on this branch / PR #24

1. `package-lock.json` out of sync with `package.json` (peer deps of `@lexical/yjs` and `livekit-client` missing) — CI `Install locked dependencies` failed on main and PR #24; fixed in `987e158`, `npm ci --dry-run` clean, CI green.
2. `.env.example` missing 22 referenced names — added as a names-only block.
3. No centralized environment validation — added `scripts/check-env.mjs` + CI step.
4. `packageManager` pinned to the npm version actually used (10.9.9).
5. `.env.example` previously omitted every provider-alias used by the code — operators could not discover them from the file.

## 6. Explicitly UNVERIFIED / blocked (no inference)

- Production host OS, PM2/nginx/Caddy state, ports in use, SSL renewal, backups, `:3012` vs `:3000` discrepancy between repo defaults and the deployed `APP_PORT=3012` variable.
- Whether the production DB is SQLite (standalone default) or MariaDB — `Dockerfile` defaults to `file:./db/custom.db`; the `DB_ENGINE=prisma` + `prisma/adapter-mariadb` path exists for MySQL; both are supported, the active one is host config.
- `Dockerfile` image build (not exercised in CI).
- Domain → app routing for `panel.alolabs.net`.
- The external deploy automation that consumes repo variables (outside this repository).

## 7. Pre-commit / pre-merge verification (single command)

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:security && npm run schema:check && npm run build && npm run test:integration
```

(`npm test` additionally runs Playwright e2e and is what `.github/workflows/ci.yml` effectively performs, plus build-output verification.)
