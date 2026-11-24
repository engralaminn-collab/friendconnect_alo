# Deploying FriendConnect to `panel.alolabs.net`

**Status: BLOCKED — no deployment credentials available from the build sandbox.**
Nothing in this document has been executed against production. It exists so that whoever
has access can complete the deploy without re-deriving the situation.

Verified 2026-11-23. Every claim below was reproduced with a command; no step is assumed.

---

## 1. What is actually known about the target

| Fact | How it was established |
|---|---|
| `panel.alolabs.net` resolves to Cloudflare (`172.67.155.32`, `104.21.34.58`) | `getent hosts panel.alolabs.net` |
| HTTPS from the sandbox fails at TLS handshake (`SSL_ERROR_SYSCALL`); HTTP returns an empty reply | `curl -v https://panel.alolabs.net/`, `curl http://panel.alolabs.net/` |
| Port 22 answers (Cloudflare edge), but SSH key exchange is closed | `ssh aloedu@panel.alolabs.net` → `kex_exchange_identification: Connection closed` |
| The repo's own earlier investigation states `panel.alolabs.net` is a **hosting control panel**, and that the app runs on `learn.aloeducation.com` via `103.231.239.79` | `docs/DEPLOYMENT_AND_RECOVERY.md` §11 |

**Therefore the routing architecture is still unconfirmed.** The single most important unknown is
whether `panel.alolabs.net` serves the application itself or a control panel that manages it.
Do not configure a reverse-proxy route until this is answered — if it is a control panel, adding a
catch-all route to it could take the panel down.

## 2. Why the sandbox cannot deploy

| Requirement | Probe | Result |
|---|---|---|
| SSH creds | `ssh -o BatchMode=yes aloedu@103.231.239.79` | `Connection reset by peer`; no `~/.ssh` exists |
| CI secrets | `gh api .../actions/secrets` | `403 Resource not accessible by integration` |
| CI variables (`AUTO_DEPLOY_MAIN`) | `gh api .../actions/variables` | `403 Resource not accessible by integration` |
| Network path to origin | `curl https://103.231.239.79` | TLS dropped (egress allowlist: only github/npm/pypi) |
| Prisma engines | `npx prisma generate` | `binaries.prisma.sh` unreachable |

The token in use has repo `admin` permission for git operations but is **not** authorized for
Actions secrets/variables, and there is no SSH key. Both are required.

## 3. Safest way to grant deployment access

Preferred: **let CI deploy**, so no key ever enters the sandbox.

1. Generate a dedicated deploy key (do this on a trusted machine, never paste it into chat):
   ```bash
   ssh-keygen -t ed25519 -C "friendconnect-ci" -f ./friendconnect-ci -N ""
   ssh-keygen -y -f ./friendconnect-ci >> /home/aloedu/.ssh/authorized_keys   # on the server
   ```
2. In GitHub → Settings → Secrets and variables → Actions, add:
   | Name | Type | Value |
   |---|---|---|
   | `ALO_SERVER_HOST` | Secret | server address |
   | `ALO_SERVER_USER` | Secret | `aloedu` |
   | `ALO_SERVER_SSH_KEY` | Secret | contents of `friendconnect-ci` (private) |
   | `FRIENDCONNECT_DIR` | Variable | e.g. `/home/aloedu/friendconnect` |
   | `AUTO_DEPLOY_MAIN` | Variable | `true` **only after** the routing question in §1 is answered |

   `.github/workflows/ci.yml` already consumes these names; no workflow change is needed.
3. Merge to `main` → CI runs the quality gate → `scripts/deploy.sh` runs on the server.

Alternative: give the sandbox an SSH key with a passphrase-free deploy key scoped to that host.
Less desirable — it puts a production credential in an ephemeral environment.

## 4. Pre-deploy checklist (run on the server, not here)

```bash
# 0. Answer the routing question first
pm2 list
sudo caddy validate --config /etc/caddy/Caddyfile && sudo cat /etc/caddy/Caddyfile
ss -ltnp | grep -E ':(3054|3000|3005|3003)\b'
curl -sI http://127.0.0.1:3054 | head -3

# 1. Back up BEFORE anything
./scripts/backup.sh

# 2. Deploy
cd "$FRIENDCONNECT_DIR" && git pull origin main && ./scripts/deploy.sh

# 3. Health
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3003/health
```

`scripts/deploy.sh` runs `prisma migrate deploy`, which is additive-only. **Never** run
`prisma migrate reset` or `db push --accept-data-loss` against production.

### Environment variables that must be set before first boot

| Variable | Why | Consequence if missing |
|---|---|---|
| `NEXTAUTH_SECRET` | Signs session JWTs | **Auth routes now hard-fail** (deliberate, added 2026-11-23) |
| `DATABASE_URL` | DB connection | app won't start |
| `APP_ORIGIN` / `NEXTAUTH_URL` | cookie + OAuth origin | login loop |
| `METRICS_TOKEN` | gates `/api/metrics` | endpoint is admin-session-only |
| `TURN_SERVERS`, `TURN_SECRET` | calls across NATs | calls hang on "Connecting…" |

## 5. What still cannot be verified even after deploy

- **Jara real inference** — no AI provider is configured in this environment
  (`/api/ai/status` → `configured:false`). Jara returns a canned `fallbackReply`.
  Set `OLLAMA_URL` or a provider key, then confirm `GET /api/ai/status` → `configured:true`.
- **Audio/video calls** — needs a real browser with camera/mic, plus reachable TURN.
- **Browser E2E** — Playwright browsers cannot be downloaded here.
- **MySQL path** — untested end to end (see [TESTING.md](TESTING.md#what-is-deliberately-not-covered)).
