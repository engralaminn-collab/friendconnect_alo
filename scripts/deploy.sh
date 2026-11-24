#!/usr/bin/env bash
# FriendConnect — production deploy (Node + npm + PM2). Safe to run on every update.
#   cd /home/aloedu/friendconnect && ./scripts/deploy.sh
# Steps: install → prisma generate → migrate (MySQL) → build → PM2 reload → health check
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "=== FriendConnect deploy — $(date) ==="
echo "Dir: $APP_DIR  User: $(whoami)  Node: $(node -v)"

for cmd in node npm npx pm2; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "FAIL: $cmd not found"; exit 1; }
done
[ -f .env ] || { echo "FAIL: .env not found (see docs/DEPLOY_LEARN_ALOEDUCATION.md)"; exit 1; }

# Read a value from .env without `export $(xargs)` (which breaks on quotes / ! / spaces).
envget() {
  node -e '
    const fs = require("fs"); const k = process.argv[1]
    for (const raw of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const l = raw.trim(); if (!l || l.startsWith("#")) continue
      const i = l.indexOf("="); if (i < 1 || l.slice(0, i).trim() !== k) continue
      let v = l.slice(i + 1).trim()
      if ((v[0] === "\"" && v.endsWith("\"")) || (v[0] === "'"'"'" && v.endsWith("'"'"'"))) v = v.slice(1, -1)
      process.stdout.write(v); break
    }' "$1"
}

DATABASE_URL="$(envget DATABASE_URL)"
PORT="$(envget PORT)"; PORT="${PORT:-3000}"
SOCKET_PORT="$(envget SOCKET_PORT)"; SOCKET_PORT="${SOCKET_PORT:-3003}"
export DATABASE_URL

echo "[1/6] Installing dependencies…"
npm ci --no-audit --no-fund

echo "[2/7] Verifying generated schemas…"
# prisma/schema.prisma is the single editable source of truth; the provider
# variants, the runtime metadata, the SQLite DDL and the MySQL migration are all
# generated from it. Refuse to deploy if any of them is stale — that is how a
# deployment ends up running different DDL than the code expects.
#
# Previously this step copied schema.mysql.prisma OVER schema.prisma. That
# destroyed the canonical file in the working tree: the next schema edit went to
# the wrong file, and the copy was never restored on failure. Prisma accepts an
# explicit --schema, so no copy is needed.
npm run schema:check

if [[ "$DATABASE_URL" == mysql://* || "$DATABASE_URL" == mariadb://* ]]; then
  PRISMA_SCHEMA="prisma/schema.mysql.prisma"
  echo "  MySQL → $PRISMA_SCHEMA (canonical schema.prisma left untouched)"
else
  PRISMA_SCHEMA="prisma/schema.sqlite.prisma"
  echo "  SQLite → $PRISMA_SCHEMA"
fi
npx prisma generate --schema "$PRISMA_SCHEMA"

echo "[3/7] Database migrations…"
if [[ "$DATABASE_URL" == mysql://* || "$DATABASE_URL" == mariadb://* ]]; then
  # Back up before touching the schema. A migration that cannot be rolled back is
  # still recoverable if there is a dump, and this is the only step that writes
  # to production data.
  BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if command -v mysqldump >/dev/null 2>&1; then
    # Parse the URL without printing credentials. The helper exists because
    # inlining JavaScript inside eval is unreadable and mis-quotes passwords
    # containing quotes or dollar signs.
    if ! . <(node scripts/lib/db-url-env.mjs); then
      echo "FAIL: cannot parse DATABASE_URL for the backup step."
      exit 1
    fi
    DUMP="$BACKUP_DIR/pre-migrate-$STAMP.sql.gz"
    if MYSQL_PWD="$DB_PASS" mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
        --single-transaction --quick --no-tablespaces "$DB_NAME" | gzip > "$DUMP"; then
      echo "  ✓ database backed up → $DUMP"
    else
      echo "FAIL: database backup failed; refusing to migrate without one."
      echo "      Set SKIP_DB_BACKUP=1 only if you have an external backup."
      [[ "${SKIP_DB_BACKUP:-0}" == "1" ]] || exit 1
      rm -f "$DUMP"
    fi
  else
    echo "  WARNING: mysqldump not found; no backup taken before migrating."
    echo "           Install the MySQL client or set SKIP_DB_BACKUP=1 if you have one."
    [[ "${SKIP_DB_BACKUP:-0}" == "1" ]] || exit 1
  fi

  # Non-destructive: only applies new files from prisma/migrations. Never resets data.
  npx prisma migrate deploy --schema "$PRISMA_SCHEMA"
else
  echo "  SQLite: additive migrations run automatically on start (src/lib/db-migrations.cjs)."
fi

echo "[4/7] Building…"
npm run build

mkdir -p logs
UPLOAD_DIR="$(envget UPLOAD_DIR)"
[ -n "$UPLOAD_DIR" ] && mkdir -p "$UPLOAD_DIR"

echo "[5/7] Reloading PM2…"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null

echo "[6/7] Health check…"
for i in 1 2 3 4 5 6; do
  sleep 3
  APP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/api/health" || echo 000)
  SOCK=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SOCKET_PORT}/health" || echo 000)
  # /api/health → 200 when the database works (503 = database error).
  if [[ "$APP" == "200" && "$SOCK" == "200" ]]; then
    echo "  ✓ app :${PORT} (HTTP $APP)  ✓ socket :${SOCKET_PORT}"
    echo "=== Deploy OK ==="
    exit 0
  fi
  echo "  attempt $i: app=$APP socket=$SOCK"
done
curl -s "http://127.0.0.1:${PORT}/api/health" || true; echo
echo "FAIL: health check failed — run: pm2 logs --lines 100"
exit 1
