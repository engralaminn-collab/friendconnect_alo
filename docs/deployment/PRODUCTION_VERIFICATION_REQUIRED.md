# Production verification — REQUIRED (NOT INDEPENDENTLY VERIFIED)

Status: **NOT INDEPENDENTLY VERIFIED**. Production has not been inspected. Nothing in this
document states that the latest commit is live. CI success is not deployment evidence.

Recorded: 2026-11-28, from the sandbox, read-only. Branch `arena/2b2a87d0-friendconnect-alo`
at `1983ebe`. `origin/main` at `ba1f0ee` (PR #25 merge).

## 1. What was checked (read-only)

| Check | Command | Result |
|---|---|---|
| App over HTTPS | `curl https://learn.aloeducation.com/api/health` | `Failed to connect ... port 443` (code 000) |
| App root | `curl https://learn.aloeducation.com/` | same connection failure |
| DNS | `getent hosts learn.aloeducation.com` | resolves to `…cfargotunnel.com` (Cloudflare Tunnel). Origin not reachable from this sandbox. |
| Panel host | `curl https://panel.alolabs.net/` | `SSL_ERROR_SYSCALL` (TLS handshake fails) |
| Raw origin IP | `curl http://103.231.239.79/` | `Empty reply from server` |
| SSH | no key in sandbox | not attempted; no deploy credential is available |

No deploy, restart, `.env` write, database access, or DNS/routing change was made.

## 2. Repository variables

`gh api repos/engralaminn-collab/friendconnect_alo/actions/variables` and `…/secrets` both
return **HTTP 403 "Resource not accessible by integration"**. The values cannot be read from
this sandbox, so the variables are **unverified**. Their values are not printed here.

Repo consumers of the names that the deployment docs mention:

| Name | Consumer in repo | Notes |
|---|---|---|
| `APP_URL` | `.github/workflows/ci.yml`, `scripts/check-env.mjs`, `src/lib/ai.ts`, `.env.example` | CI-only use; no deploy workflow reads it |
| `APP_PORT` | `.github/workflows/ci.yml`, `scripts/docker-verify.sh`, `scripts/check-env.mjs` | CI container check only |
| `APP_HEALTHCHECK_URL` | `.github/workflows/ci.yml` | CI container check only |
| `FRIENDCONNECT_DIR` | `docs/DEPLOY_PANEL_ALOLABS.md`, `docs/CI_CD_AND_OPERATIONS.md` | **Not consumed by any workflow.** Documentation only |
| `AUTO_DEPLOY_MAIN` | `docs/*` only (4 files) | **Not enforced by any code or workflow.** No deploy workflow exists. The `AUTO_DEPLOY_MAIN=false` rule is currently a documented convention, not a control |

`.github/workflows/ci.yml` is the only workflow. It contains no `vars.` or `secrets.` reads
and no SSH, SCP, or PM2 step.

## 3. Conflicting routing and port plans in the repository

Three different production layouts are committed. They cannot all be correct.

| Source | App port | Socket port | Host / notes |
|---|---|---|---|
| `Caddyfile` (root) | 3000 | — | `:81`, `XTransformPort` query proxy to `localhost:{query.XTransformPort}` |
| `Caddyfile.production` (root) | 3000 | 3003 | `{$APP_DOMAIN:friendconnect.example.com}` |
| `deploy/learn.aloeducation.com/Caddyfile` | 3017 | 3018 | `learn.aloeducation.com` |
| `scripts/deploy.sh` / `ecosystem.config.cjs` | `PORT` default 3000 | `SOCKET_PORT` default 3003 | from `.env` |
| `docs/DEPLOY_PANEL_ALOLABS.md` | — | 3003 (health check) | assumes `/home/aloedu/friendconnect`, ports 3054/3000/3005/3003 |
| Repository variables (per the task brief, unverified) | 3012 | 3003 | `/home/alamin/alolabs-projects/friendconnect_alo` |

The root `Caddyfile` (`XTransformPort` on `:81`) is an unexplained proxy hack. Treat it as
suspect until the owner explains it.

## 4. Governance gaps

- Branch protection on `main`: `gh api repos/…/branches/main/protection` returns **403**.
  Protection state is **unknown**. It must be verified by someone with admin access.
- `AUTO_DEPLOY_MAIN` has no enforcement point in code (see §2).
- `docs/DEPLOY_PANEL_ALOLABS.md` §1 concludes that `panel.alolabs.net` is a hosting control
  panel. Routing for `learn.aloeducation.com` vs `panel.alolabs.net` is undecided. Do not
  configure FriendConnect on `panel.alolabs.net` without written approval.

## 5. What is needed to verify production

Each item needs an explicit owner decision. The sandbox must not obtain these on its own.

1. Read-only access to the production host (SSH key for a read-only user, or a status
   endpoint owned by the operator) so that `git -C $DIR rev-parse HEAD`,
   `pm2 list`, `ss -ltnp`, and `curl http://127.0.0.1:<PORT>/api/health` can run.
2. Confirmation of the single intended routing layout from §3 (which Caddyfile, which ports,
   which hostname).
3. Read access to repository variables and secrets (names and presence only, never values),
   or the owner confirms the values and mapping.
4. Confirmation of who may approve `AUTO_DEPLOY_MAIN` changes and deploys.
5. Admin confirmation of `main` branch protection.

Until items 1–2 are satisfied, production status stays **NOT INDEPENDENTLY VERIFIED**.
