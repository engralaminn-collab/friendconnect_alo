# FriendConnect self-hosted service (parallel implementation)

> **Not production-deployed and not yet the active app.** The React and Flutter clients in this repository still use legacy hosted service. This service is a parallel first-party implementation so the existing site, legacy hosted service project, data, and services can remain available during a controlled migration. Do not remove legacy hosted service or point production clients at this API until data import, client integration, rollback, and real-device verification are complete.

## Implemented in this checkout

- Node 22 / Express API, Socket.IO realtime service, and a versioned MySQL 8 schema/migration runner.
- Invite-token registration (32 random bytes, SHA-256 token storage, email-bound invites supported, one-time consumption, expiry), Argon2id password hashes, email verification/reset, persisted hashed sessions, HTTP-only web cookies, bearer sessions for native clients, logout/revocation, and lockout/rate limits.
- Admin-only invite creation/revocation and user suspension. The first administrator is bootstrapped through an interactive CLI; the password is read without terminal echo.
- Authenticated friendship, direct/group conversation, paginated message, edit/delete, reaction, and receipt routes. REST and Socket.IO message/receipt/typing paths check conversation membership server-side.
- Private attachment upload/download with UUID storage keys, magic-byte MIME detection, strict allowlists, ClamAV INSTREAM scanning (fails closed), per-user quota, private directories, and authorized download streaming.
- Socket.IO session revalidation, authenticated room membership, rate-limited message/call signaling, one-to-one call state/history/timeouts, server-minted temporary Coturn REST credentials, persisted in-app notifications, and optional Web Push.
- Production configuration validation, signed + encrypted backup tooling, a guarded disposable restore-verification path, and web/API CI configuration.

`IMPLEMENTED` here means code exists and its unit/integration tests pass. It does not mean the MySQL migration has been run, email delivery works, a Coturn node is reachable, or any service is running on the VPS.

## Local development

Requirements: Node.js 22+, MySQL 8, ClamAV (`clamd`) for uploads, SMTP credentials for verification/reset mail, and optionally a TURN service/Web Push VAPID keys.

1. Create a **new, isolated** development database and user. Do not use an existing production database or an unrelated site's account.
2. From `server/`, copy `.env.example` to `.env` and fill development-only values. Never commit `.env`; secrets must not be placed in `VITE_*` variables.
3. Install dependencies and apply the explicit, checksummed migrations:

   ```sh
   npm ci
   npm run migrate
   npm run create-admin -- admin@example.test admin_name
   npm run dev
   ```

   `create-admin` requires an interactive terminal and prompts for a hidden password. It refuses to create a second administrator.
4. Uploads remain disabled in effect until ClamAV is reachable: the service rejects uploads if scanning is not configured/available. Registration requires a functioning mailer; no development email is silently simulated.

The API defaults to port `3210` for local development only. No production port is selected by this repository. A separate React client is now available at `/self-hosted` behind `VITE_SELF_HOSTED_API_ENABLED=true`; the Vite proxy sends relative `/api` and `/socket.io` requests to the local service. This is a staging/parallel route only: the normal legacy hosted service routes have not been switched, and Flutter is still legacy hosted service-backed. The target deployment description mentions Next.js on `3014` and a separate Socket.IO process on `3114`, but this checkout is Vite plus one combined Express/Socket.IO process. Do not deploy it to those ports or replace the named PM2 apps until the actual VPS layout and intended topology have been inspected and reconciled.

## Important API paths

All routes are under `/api` unless noted.

- `POST /auth/register`, `/auth/verify-email`, `/auth/verification/resend`, `/auth/login`, `/auth/password-reset/request`, `/auth/password-reset/confirm`
- `GET /auth/session`; `POST /auth/logout`, `/auth/logout-all`
- `/admin/invites`, `/admin/users`, `/admin/users/:userId/status`
- `/users/search`, `/friends`, `/friends/requests`
- `/conversations`, `/conversations/direct`, `/conversations/group`, `/conversations/:id/messages`
- `/conversations/:id/attachments`, `/attachments/:id`
- `/conversations/:id/calls`, `/conversations/:id/calls/active`, `/rtc/turn-credentials`
- `/notifications`, `/notifications/push-subscription`
- `GET /health/live` is process liveness; `GET /api/health/ready` checks MySQL readiness.

For cookie-authenticated mutations, call `GET /api/auth/session` and send the returned CSRF token as `X-CSRF-Token`. Native clients use a server-issued bearer session and must store it in platform secure storage. The browser cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Tokens are never accepted in query strings.

## Deployment status

No production PM2, Caddy, Coturn, or release/rollback configuration is included for this checkout. The target deployment is reported to run a Next.js application and a separate Socket.IO process, while this source is Vite plus one combined Express/Socket.IO process. Adding a generic PM2 or Caddy configuration without inspecting the actual host could start a duplicate process or replace existing routes, so deployment is deliberately blocked pending that comparison.

The API's production config validation fails closed unless HTTPS origins, proxy hops, an explicitly chosen port, a private media path, MySQL, SMTP, ClamAV, Coturn URLs/shared secret, and Web Push keys are configured. This validation does not establish that those production services exist or work. Never commit the Coturn shared secret.

## Backups and restore verification

`server/scripts/backup.sh` creates a MySQL logical dump and archive of private media, encrypts with `age`, signs the encrypted archive with an Ed25519 key, writes a checksum, copies all artifacts to an off-host `rclone` destination, and applies local retention. The temporary plaintext staging directory is required to be mode `0700`; MySQL config and signing key must be mode `0600` or `0400` and outside Git. Keep the age identity, signing private key, MySQL option file, and rclone credentials outside the repository and restrict them to the backup operator.

Set `BACKUP_ROOT`, `MEDIA_ROOT`, `MYSQL_CNF_FILE`, `DB_NAME`, `BACKUP_AGE_RECIPIENT`, `BACKUP_SIGNING_PRIVATE_KEY`, `BACKUP_REMOTE`, and optionally `BACKUP_KEEP_DAYS` in the backup runner's protected environment. Verify checksums and signatures from a trusted public key kept separately from the backup store.

`restore.sh archive.tar.gz.age` verifies signature, checksum, decryption, gzip data, metadata, and safe archive layout without changing MySQL/media. `restore.sh ... --apply` additionally requires an already-created **empty disposable database**, a new media directory, and `RESTORE_CONFIRM=RESTORE_TO_<database>`. It refuses to restore into `DB_NAME`. It is intended for isolated restore drills, not in-place production recovery. No backup has been created or restore-tested from this workspace.

## CI and verification limits

Run `npm run lint`, `npm run build`, `npm --prefix server run check`, and `npm audit --audit-level=low` at both repository roots. Root `npm run lint` is TypeScript validation, not ESLint. `.github/workflows/ci.yml` is configured for a dedicated `[self-hosted, linux, x64, friendconnect-ci]` runner; no runner is registered/verified here, and this is not a production deployment workflow. Tests cover HTTP auth/CSRF/CORS behavior, Argon2id and invite flows with fakes, authenticated Socket.IO membership/signaling/revocation acknowledgement, Coturn credential derivation, ClamAV protocol/fail-closed behavior, private file handling, and safe backup extraction.

There is no MySQL, ClamAV, SMTP, PM2, Caddy, age key, signing key, or Coturn instance available in this workspace. The SQL schema has not been applied against MySQL; no restore, web push service worker, Flutter build, iOS/Android background push migration, cross-provider call, HTTPS production, data import, or VPS restart test has been completed. The deployed/current clients still use legacy hosted service until those gaps are closed.
