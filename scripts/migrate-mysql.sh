#!/usr/bin/env bash
# FriendConnect — create/upgrade the MySQL tables (safe, non-destructive).
# Usage: DATABASE_URL=mysql://user:pass@127.0.0.1:3306/db ./scripts/migrate-mysql.sh
#   (or put DATABASE_URL in .env — Prisma reads it automatically)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "=== FriendConnect MySQL migration ==="
echo "[1/2] Generating Prisma Client (MySQL schema)…"
npx prisma generate --schema prisma/schema.prisma
echo "[2/2] Applying migrations from prisma/migrations…"
npx prisma migrate deploy --schema prisma/schema.prisma
echo "Done. Copy old SQLite data (optional): node scripts/sqlite-to-mysql.cjs db/custom.db"
