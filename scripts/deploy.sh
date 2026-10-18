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

echo "[2/6] Generating Prisma Client…"
if [[ "$DATABASE_URL" == mysql://* || "$DATABASE_URL" == mariadb://* ]]; then
  npx prisma generate --schema prisma/schema.prisma
else
  npx prisma generate --schema prisma/schema.sqlite.prisma
fi

echo "[3/6] Database migrations…"
if [[ "$DATABASE_URL" == mysql://* || "$DATABASE_URL" == mariadb://* ]]; then
  # Non-destructive: only applies new files from prisma/migrations. Never resets data.
  npx prisma migrate deploy --schema prisma/schema.prisma
else
  echo "  SQLite: tables are created/updated automatically on start."
fi

echo "[4/6] Building…"
npm run build

mkdir -p logs
UPLOAD_DIR="$(envget UPLOAD_DIR)"
[ -n "$UPLOAD_DIR" ] && mkdir -p "$UPLOAD_DIR"

echo "[5/6] Reloading PM2…"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null

echo "[6/6] Health check…"
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
