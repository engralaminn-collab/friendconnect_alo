# Deploy FriendConnect on learn.aloeducation.com (MySQL, port 3017)

Server: Ubuntu · user `aloedu` · IP `103.231.239.79` · Node 22 · PM2 · Caddy 2 · MySQL 8 · Redis.

How it runs:

```
Browser ──https──► Caddy (learn.aloeducation.com)
                     ├── /socket.io/* ──► 127.0.0.1:3018  friendconnect-socket (chat, calls signalling)
                     └── everything else ► 127.0.0.1:3017  friendconnect (Next.js app + API)
Browser ──udp 3478 + 49152-65535──► friendconnect-turn (call relay when direct P2P fails)
All three ──► MySQL 127.0.0.1:3306 · Redis 127.0.0.1:6379 · files in UPLOAD_DIR
```

Files used: `deploy/learn.aloeducation.com/` (`env.production.example`, `Caddyfile`,
`mysql-setup.sql`) and `scripts/deploy.sh`.

---

## 0. Before you start (2 checks)

```bash
# a) Is learn.aloeducation.com already used by another app?  If you see a block, that app
#    would be REPLACED. Use another sub-domain (e.g. chat.aloeducation.com) in that case.
grep -n "learn.aloeducation.com" /etc/caddy/Caddyfile

# b) Are the ports free?  (no output = free)
sudo ss -ltnp | grep -E ':(3017|3018)\b'
sudo ss -lunp | grep -E ':3478\b'
```

DNS: an **A record** `learn.aloeducation.com → 103.231.239.79` must exist.

## 1. Database

The app needs an **empty** database (it creates its own tables). Check `db_learn`:

```bash
sudo mysql -e "SELECT COUNT(*) AS tables_in_db FROM information_schema.tables WHERE table_schema='db_learn';"
```

* `0` → use `db_learn` / `user_learn` as you planned.
* more than `0` → another app uses it. Do **not** share it. Create a separate one:
  edit the password in `deploy/learn.aloeducation.com/mysql-setup.sql`, then
  `sudo mysql < deploy/learn.aloeducation.com/mysql-setup.sql` and use
  `mysql://user_friendconnect:PASSWORD@127.0.0.1:3306/db_friendconnect` below.

> The `user_learn` password was shared in a chat — please change it:
> `sudo mysql -e "ALTER USER 'user_learn'@'localhost' IDENTIFIED BY 'NEW_LONG_PASSWORD';"`
> (repeat for `'user_learn'@'127.0.0.1'` / `'%'` if those accounts exist).

## 2. Get the code

```bash
cd /home/aloedu
git clone https://github.com/engralaminn-collab/friendconnect_alo.git friendconnect   # first time
cd friendconnect
git checkout arena/8dc4f908-friendconnect-alo   # or main after this branch is merged
```

## 3. Configure `.env`

```bash
cp deploy/learn.aloeducation.com/env.production.example .env
nano .env
```

Fill in every `CHANGE_ME`:

| Setting | Value |
|---|---|
| `DATABASE_URL` | `mysql://user_learn:NEW_PASSWORD@127.0.0.1:3306/db_learn` (URL-encode `@ # / :` in the password) |
| `SMTP_PASSWORD` | your Resend API key (`re_…`). `SMTP_FROM` must use a domain verified in Resend |
| `TURN_PASSWORD` | output of `openssl rand -base64 24` |

Then: `chmod 600 .env`.

## 4. Install, create tables, build, start

```bash
mkdir -p /home/aloedu/storage/uploads/friendconnect
./scripts/deploy.sh
```

`deploy.sh` runs: `npm ci` → `npx prisma generate` → `npx prisma migrate deploy` (creates /
updates tables, never deletes data) → `npm run build` → `pm2 startOrReload` → health check.

If `migrate deploy` says **P3005 "The database schema is not empty"**, the database belongs to
another app — go back to step 1 and use a separate database.

Make PM2 start on reboot (once):

```bash
pm2 startup      # run the sudo command it prints
pm2 save
```

## 5. Caddy (HTTPS)

```bash
sudo mkdir -p /var/log/caddy
sudo nano /etc/caddy/Caddyfile        # paste deploy/learn.aloeducation.com/Caddyfile at the end
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 6. Firewall for calls

```bash
sudo ufw allow 80,443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152:65535/udp
```

(If your hosting provider has its own firewall panel, open the same ports there.)

## 7. Check it works

```bash
pm2 status                                    # friendconnect, friendconnect-socket, friendconnect-turn = online
curl -s http://127.0.0.1:3017/api/health      # "database":"ok", "realtime":"ok", "redis":"ok"
curl -sI https://learn.aloeducation.com | head -1
```

Open https://learn.aloeducation.com, register two accounts (two browsers / phones), send a
photo, then try a voice and a video call.

---

## Moving old data from SQLite (only if FriendConnect already ran before)

Old builds stored data in `.next/standalone/db/custom.db` and files in
`.next/standalone/upload/` (or `db/custom.db` and `upload/`). **Copy them out before
`npm run build`** — a build deletes `.next/`.

```bash
cd /home/aloedu/friendconnect
mkdir -p ~/fc-backup
cp -a .next/standalone/db/custom.db ~/fc-backup/ 2>/dev/null || cp -a db/custom.db ~/fc-backup/
cp -a .next/standalone/upload/. ~/fc-backup/upload/ 2>/dev/null || cp -a upload/. ~/fc-backup/upload/

# after step 4 (tables exist, database still empty):
node scripts/sqlite-to-mysql.cjs ~/fc-backup/custom.db
cp -a ~/fc-backup/upload/. /home/aloedu/storage/uploads/friendconnect/
pm2 restart friendconnect friendconnect-socket
```

The copy runs in one transaction (all or nothing) and refuses to write into a database that
already has users.

## Updating later

```bash
cd /home/aloedu/friendconnect && git pull && ./scripts/deploy.sh
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `pm2 logs friendconnect` shows `Access denied for user` | wrong password in `DATABASE_URL`, or special characters not URL-encoded |
| `@prisma/client did not initialize` | run `npx prisma generate`, then `npm run build` |
| Page loads but chat/calls don't connect | `pm2 logs friendconnect-socket`; check the `/socket.io*` block in Caddy; `APP_ORIGIN` must be exactly `https://learn.aloeducation.com` |
| Calls work on Wi-Fi but not mobile data | UDP 3478 + 49152-65535 not open; `TURN_EXTERNAL_IP` must be `103.231.239.79` |
| "Camera needs HTTPS" message | open the site with `https://`, not the IP address |
| Emails not arriving | `pm2 logs friendconnect | grep email`; verify the sender domain in Resend |
| Upload fails for big files | Caddy `max_size` (60MB) and free disk space in `UPLOAD_DIR` |
