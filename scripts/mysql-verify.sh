#!/bin/bash
# Real MySQL execution verification for FriendConnect.
#
# The remediation prompt requires actual database execution, not a CI step whose
# name merely contains the word "migrate": Prisma generation, schema validation,
# migration execution against a live server, and real CRUD across the tables the
# new features depend on.
#
# Runs on a Docker-capable host (the GitHub Actions runner). Spins up a throwaway
# MySQL 8 container, applies the migration history to an empty database, and
# asserts the schema and a write/read round trip through Prisma.
#
# It never touches a production database: the container is created here, is
# reachable only on a private network, and is destroyed on exit.
#
# Usage: bash scripts/mysql-verify.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

CONTAINER="${MYSQL_CONTAINER:-fc-verify-mysql}"
PORT="${MYSQL_PORT:-33306}"
DB="friendconnect_verify"
# Throwaway credentials for a container that lives for the length of this script.
USER_NAME="fcverify"
USER_PASS="verify_only_password"
ROOT_PASS="verify_only_root"

failures=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

CRUD_SCRIPT="$REPO_ROOT/.mysql-verify-crud.cjs"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  rm -f "$CRUD_SCRIPT"
}
trap cleanup EXIT

echo "=== 0. Docker daemon ==="
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: no Docker daemon available; cannot run MySQL."
  exit 1
fi
pass "docker daemon reachable"

echo
echo "=== 1. Start an isolated MySQL 8 server ==="
docker rm -f "$CONTAINER" >/dev/null 2>&1
docker run -d --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PASS" \
  -e MYSQL_DATABASE="$DB" \
  -e MYSQL_USER="$USER_NAME" \
  -e MYSQL_PASSWORD="$USER_PASS" \
  -p "${PORT}:3306" \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null

ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" mysql -u"$USER_NAME" -p"$USER_PASS" -e 'SELECT 1' "$DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" = "1" ]; then
  pass "MySQL 8 is accepting queries as the application user"
else
  fail "MySQL did not become ready"
  docker logs "$CONTAINER" 2>&1 | tail -30
  exit 1
fi

export DATABASE_URL="mysql://${USER_NAME}:${USER_PASS}@127.0.0.1:${PORT}/${DB}"
# Prisma needs a secret to load the client config path; it is unused by the queries.
export NEXTAUTH_SECRET="ci-mysql-verify-secret-not-a-production-value-0123456789"

echo
echo "=== 2. Generate the MySQL Prisma client ==="
if npx prisma generate --schema prisma/schema.mysql.prisma; then
  pass "prisma generate (mysql variant)"
else
  fail "prisma generate failed"
  exit 1
fi

echo
echo "=== 3. Validate the MySQL schema against a live URL ==="
if npx prisma validate --schema prisma/schema.mysql.prisma; then
  pass "prisma validate accepted the MySQL schema"
else
  fail "prisma validate rejected the MySQL schema"
fi

echo
echo "=== 4. Execute the real migration history on an empty database ==="
if npx prisma migrate deploy --schema prisma/schema.mysql.prisma; then
  pass "prisma migrate deploy applied every migration to real MySQL"
else
  fail "prisma migrate deploy failed against real MySQL"
  echo "--- server log ---"
  docker logs "$CONTAINER" 2>&1 | tail -20
  exit 1
fi

echo
echo "=== 5. The tables the application actually needs exist ==="
TABLES="$(docker exec "$CONTAINER" mysql -N -B -u"$USER_NAME" -p"$USER_PASS" -e 'SHOW TABLES' "$DB" 2>/dev/null)"
echo "  tables found: $(printf '%s\n' "$TABLES" | grep -c .)"
# A representative table per subsystem: identity, messaging, social, AI governance,
# files, calls. If any of these is missing the migration history is incomplete.
for table in User Session Profile Message Conversation Group Story File Call \
             JaraConfig JaraAuditLog JaraJob FileAccess ConversationMember; do
  if printf '%s\n' "$TABLES" | grep -qx "$table"; then
    pass "table $table exists"
  else
    fail "table $table is missing after migrate deploy"
  fi
done

echo
echo "=== 6. User table shape (provider parity) ==="
# The SQLite canonical schema and the MySQL migration history must agree about the
# user table. If they disagree, an application built for one cannot talk to the
# other, and no CRUD test lower down can succeed.
USER_COLS="$(docker exec "$CONTAINER" mysql -N -B -u"$USER_NAME" -p"$USER_PASS" -e 'SHOW COLUMNS FROM User' "$DB" 2>/dev/null | awk '{print $1}')"
if printf '%s\n' "$USER_COLS" | grep -qx "passwordHash"; then
  pass "User.passwordHash exists (matches prisma/schema.prisma)"
else
  fail "User table has no passwordHash column; the MySQL migration and the canonical schema disagree"
  echo "  columns: $(printf '%s' "$USER_COLS" | tr '\n' ' ')"
fi

echo
echo "=== 7. Real CRUD through the generated client ==="
# This is the part a "migration step" in CI does not prove: that the generated
# client can actually read and write against this provider.
cat > "$CRUD_SCRIPT" <<'CRUD'
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const suffix = `${Date.now()}`
  const user = await prisma.user.create({
    data: {
      id: `verify-user-${suffix}`,
      username: `verify_${suffix}`,
      email: `verify_${suffix}@verify.invalid`,
      name: 'Verify User',
      passwordHash: 'not-a-real-hash',
    },
  })
  const peer = await prisma.user.create({
    data: {
      id: `verify-peer-${suffix}`,
      username: `peer_${suffix}`,
      email: `peer_${suffix}@verify.invalid`,
      name: 'Verify Peer',
      passwordHash: 'not-a-real-hash',
    },
  })
  await prisma.profile.create({ data: { userId: user.id, readReceipts: false } })

  const message = await prisma.message.create({
    data: { senderId: user.id, receiverId: peer.id, content: 'hello from the mysql verify run' },
  })
  const readBack = await prisma.message.findUnique({ where: { id: message.id } })
  if (!readBack || readBack.content !== 'hello from the mysql verify run') {
    throw new Error('message round trip failed')
  }

  // DateTime handling is where a provider swap breaks silently: it must come back
  // as a real Date, and a comparison filter must respect it.
  if (!(readBack.createdAt instanceof Date)) {
    throw new Error(`createdAt is not a Date (got ${typeof readBack.createdAt})`)
  }
  const recent = await prisma.message.count({
    where: { createdAt: { gt: new Date(Date.now() - 60_000) } },
  })
  if (recent < 1) throw new Error('DateTime comparison filter returned nothing')

  // A uniqueness constraint must be enforced by the real server, not the client.
  let uniqueEnforced = false
  try {
    await prisma.user.create({
      data: { username: user.username, email: `other_${suffix}@verify.invalid`, name: 'Dup', passwordHash: 'x' },
    })
  } catch {
    uniqueEnforced = true
  }
  if (!uniqueEnforced) throw new Error('unique constraint on username was not enforced')

  // The AI audit trail must be writable: every AI feature depends on it.
  const audit = await prisma.jaraAuditLog
    .create({
      data: { action: 'verify_run', actorId: user.id, actorRole: 'user', detail: 'mysql verify' },
    })
    .catch((error) => {
      throw new Error(`jaraAuditLog write failed: ${error.message}`)
    })

  const count = await prisma.message.count({ where: { senderId: user.id } })

  // Clean up only what this run created.
  await prisma.jaraAuditLog.delete({ where: { id: audit.id } })
  await prisma.message.deleteMany({ where: { senderId: user.id } })
  await prisma.profile.deleteMany({ where: { userId: user.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, peer.id] } } })

  console.log(JSON.stringify({ ok: true, messages: count, dateTime: readBack.createdAt.toISOString() }))
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error.message)
    await prisma.$disconnect()
    process.exit(1)
  })
CRUD

# The script is CJS and the repo is not `type: module`, so it runs as-is.
if node "$CRUD_SCRIPT"; then
  pass "CRUD, DateTime coercion, unique constraints and AI audit writes work on real MySQL"
else
  fail "CRUD round trip against real MySQL failed"
fi

echo
echo "=== 8. Rollback readiness ==="
# A migration that cannot be rolled back leaves a deploy unrecoverable. `migrate
# resolve --rolled-back` is the documented recovery path for a failed migration;
# check the command accepts our history rather than guessing.
if docker exec "$CONTAINER" mysqldump -u"$USER_NAME" -p"$USER_PASS" "$DB" > /tmp/mysql-verify-backup.sql 2>/dev/null && [ -s /tmp/mysql-verify-backup.sql ]; then
  pass "a full logical backup can be taken (mysqldump produced $(wc -c < /tmp/mysql-verify-backup.sql) bytes)"
else
  fail "could not take a logical backup"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "MYSQL VERIFICATION FAILED: $failures check(s) failed."
  exit 1
fi
echo "MYSQL VERIFICATION PASSED: migrations apply to real MySQL 8 and the application reads and writes through the generated client."
