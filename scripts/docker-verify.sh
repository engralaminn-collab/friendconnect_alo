#!/bin/bash
# Real Docker build + container runtime verification for FriendConnect.
#
# Required by the remediation prompt (Phase Twenty-One / "close the Docker
# verification gap"): static Dockerfile checks are NOT a substitute for building
# the image and starting it. This script does the real thing on a Docker-capable
# host (the GitHub Actions runner; it also works on any dev machine with a
# daemon).
#
# It exits non-zero on the first failed assertion, and prints a PASS/FAIL line per
# check so the CI log is readable evidence rather than one opaque failure.
#
# Usage:  bash scripts/docker-verify.sh [image-tag]
#
# Environment:
#   IMAGE            image tag to build (default friendconnect:verify)
#   APP_CONTAINER    app container name (default fc-verify-app)
#   SOCKET_CONTAINER socket container name (default fc-verify-socket)
#   APP_PORT         host port mapped to the app (default 3312)
#   SOCKET_PORT      host port mapped to the socket server (default 3313)
#   KEEP_CONTAINERS  set to 1 to leave containers running for debugging
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

IMAGE="${IMAGE:-friendconnect:verify}"
APP_CONTAINER="${APP_CONTAINER:-fc-verify-app}"
SOCKET_CONTAINER="${SOCKET_CONTAINER:-fc-verify-socket}"
APP_PORT="${APP_PORT:-3312}"
SOCKET_PORT="${SOCKET_PORT:-3313}"
KEEP_CONTAINERS="${KEEP_CONTAINERS:-0}"
NETWORK="fc-verify-net"
VOLUME="fc-verify-data"

# A throwaway secret: this stack never leaves the runner and touches no real data.
SECRET="ci-docker-verify-secret-not-a-production-value-0123456789"

failures=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

cleanup() {
  if [ "$KEEP_CONTAINERS" = "1" ]; then
    echo "--- KEEP_CONTAINERS=1, leaving containers for inspection ---"
    return
  fi
  docker rm -f "$APP_CONTAINER" "$SOCKET_CONTAINER" >/dev/null 2>&1
  docker volume rm "$VOLUME" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
}
trap cleanup EXIT

echo "=== 0. Docker daemon ==="
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: no Docker daemon available on this host."
  exit 1
fi
docker version --format '  client {{.Client.Version}} / server {{.Server.Version}}' || true
pass "docker daemon reachable"

echo
echo "=== 1. Build the production image from the repository Dockerfile ==="
# Build context is the repo root, exactly as `deploy/docker-compose.yml` uses it.
if docker build --tag "$IMAGE" --file Dockerfile . ; then
  pass "docker build succeeded for $IMAGE"
else
  fail "docker build failed"
  echo "--- cannot continue without an image ---"
  exit 1
fi

IMAGE_SIZE="$(docker image inspect "$IMAGE" --format '{{.Size}}' 2>/dev/null || echo 0)"
echo "  image size: $((IMAGE_SIZE / 1024 / 1024)) MiB"

echo
echo "=== 2. The boot path exists in the image ==="
# The whole point of findings 2 and 3: the container used to boot `server.js` fine
# and crash the moment the realtime server was started, because the modules it
# requires were never copied. Assert on the files themselves, then on the boot.
for path in /app/server.js /app/socket-server.js \
            /app/src/lib/socket-security.cjs /app/src/lib/file-access.cjs \
            /app/src/lib/db-migrations.cjs /app/src/lib/schema-metadata.cjs \
            /app/src/lib/sqlite-ddl.cjs /app/src/lib/db-runtime.js; do
  if docker run --rm --entrypoint sh "$IMAGE" -c "test -f $path"; then
    pass "image contains $path"
  else
    fail "image is missing $path"
  fi
done

# `node --check` on both entrypoints proves the interpreter can parse them as
# shipped, which catches a truncated or half-copied file.
if docker run --rm --entrypoint sh "$IMAGE" -c 'node --check socket-server.js && node --check server.js'; then
  pass "both entrypoints parse with node --check inside the image"
else
  fail "an entrypoint does not parse inside the image"
fi

# Better-sqlite3 is a native module: if the image's node ABI does not match the
# prebuilt binding, the database cannot open at all. Load it explicitly.
if docker run --rm --entrypoint node "$IMAGE" -e "require('better-sqlite3'); console.log('native-ok')" >/dev/null 2>&1; then
  pass "better-sqlite3 native binding loads inside the image"
else
  fail "better-sqlite3 cannot load inside the image (ABI/build mismatch)"
fi

echo
echo "=== 3. Start the realtime server ==="
docker network create "$NETWORK" >/dev/null 2>&1
docker volume create "$VOLUME" >/dev/null 2>&1

# A named volume is mounted over /data for both processes. The image runs as the
# non-root `fc` user, so prove the volume inherits a writable uid/gid *before* a
# database error turns into an opaque 60-second health timeout.
if docker run --rm -v "$VOLUME:/data" --entrypoint sh "$IMAGE" -c   'touch /data/.write-probe && mkdir -p /data/upload && rm /data/.write-probe'; then
  pass "named /data volume is writable by the non-root runtime user"
else
  fail "named /data volume is not writable by the non-root runtime user"
fi

docker rm -f "$SOCKET_CONTAINER" >/dev/null 2>&1

docker run -d --name "$SOCKET_CONTAINER" \
  --network "$NETWORK" \
  -p "${SOCKET_PORT}:3003" \
  -e NODE_ENV=production \
  -e SOCKET_PORT=3003 \
  -e DATABASE_URL="file:/data/verify.db" \
  -e NEXTAUTH_SECRET="$SECRET" \
  -e APP_ORIGIN="http://127.0.0.1:${APP_PORT}" \
  -v "$VOLUME:/data" \
  "$IMAGE" node socket-server.js >/dev/null

socket_ready=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${SOCKET_PORT}/health" >/dev/null 2>&1; then
    socket_ready=1
    break
  fi
  sleep 1
done

if [ "$socket_ready" = "1" ]; then
  pass "realtime server answers /health on port ${SOCKET_PORT}"
else
  fail "realtime server did not become healthy"
  echo "--- socket container logs ---"
  docker logs "$SOCKET_CONTAINER" 2>&1 | tail -40
fi

echo
echo "=== 4. Start the application and run a real message workflow ==="
docker rm -f "$APP_CONTAINER" >/dev/null 2>&1
docker run -d --name "$APP_CONTAINER" \
  --network "$NETWORK" \
  -p "${APP_PORT}:3000" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOSTNAME=0.0.0.0 \
  -e DATABASE_URL="file:/data/verify.db" \
  -e NEXTAUTH_SECRET="$SECRET" \
  -e NEXTAUTH_URL="http://127.0.0.1:${APP_PORT}" \
  -e APP_ORIGIN="http://127.0.0.1:${APP_PORT}" \
  -e SOCKET_INTERNAL_URL="http://${SOCKET_CONTAINER}:3003" \
  -e UPLOAD_DIR=/data/upload \
  -v "$VOLUME:/data" \
  "$IMAGE" node server.js >/dev/null

app_ready=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    app_ready=1
    break
  fi
  sleep 1
done

if [ "$app_ready" = "1" ]; then
  pass "application answers /api/health on port ${APP_PORT}"
else
  fail "application did not become healthy"
  echo "--- app container logs ---"
  docker logs "$APP_CONTAINER" 2>&1 | tail -60
fi

HEALTH_JSON="$(curl -sS "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo '{}')"
echo "  /api/health -> $HEALTH_JSON"

# The database check is the one that proves SQLite works inside the container with
# the volume mounted, not just that a route returns 200.
if printf '%s' "$HEALTH_JSON" | grep -q '"database":"ok"'; then
  pass "container reports database ok"
else
  fail "container reports a database problem"
fi

if printf '%s' "$HEALTH_JSON" | grep -q '"realtime":"ok"'; then
  pass "container reaches the realtime server over the docker network"
else
  fail "container cannot reach the realtime server (SOCKET_INTERNAL_URL wiring)"
fi

# A real registration proves write access to the volume-backed database, that
# migrations ran, and that the auth stack is wired — a health probe does not.
REG_BODY="$(curl -sS -X POST "http://127.0.0.1:${APP_PORT}/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Docker Verify\",\"username\":\"dockerverify$(date +%s)\",\"email\":\"dockerverify$(date +%s)@verify.invalid\",\"password\":\"ValidPassw0rd!\"}" \
  -w '\n%{http_code}' 2>/dev/null || echo '{}')"
REG_CODE="$(printf '%s' "$REG_BODY" | tail -1)"
if [ "$REG_CODE" = "201" ]; then
  pass "registration writes to the container database (HTTP 201)"
else
  fail "registration failed (HTTP ${REG_CODE:-none})"
  printf '%s\n' "$REG_BODY" | head -5
fi

echo
echo "=== 5. File storage persists across a restart ==="
# Finding 3 also covered the upload volume: a file written by the app must survive
# a container restart, or attachments vanish on every deploy.
docker exec "$APP_CONTAINER" sh -c 'mkdir -p /data/upload && echo persistence-probe > /data/upload/.verify-probe'
docker restart "$APP_CONTAINER" >/dev/null 2>&1
app_back=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    app_back=1
    break
  fi
  sleep 1
done
if [ "$app_back" = "1" ]; then
  pass "application restarts cleanly"
else
  fail "application did not come back after restart"
fi
if docker exec "$APP_CONTAINER" sh -c 'grep -q persistence-probe /data/upload/.verify-probe'; then
  pass "uploaded file survives a container restart (volume is real)"
else
  fail "upload directory did not persist across restart"
fi

echo
echo "=== 6. Graceful shutdown ==="
docker stop --timeout 15 "$APP_CONTAINER" >/dev/null 2>&1
if [ -z "$(docker ps -q --filter "name=^/${APP_CONTAINER}$")" ]; then
  pass "application container stops cleanly on SIGTERM"
else
  fail "application container did not stop"
fi
docker stop --timeout 15 "$SOCKET_CONTAINER" >/dev/null 2>&1
if [ -z "$(docker ps -q --filter "name=^/${SOCKET_CONTAINER}$")" ]; then
  pass "realtime container stops cleanly on SIGTERM"
else
  fail "realtime container did not stop"
fi

echo
echo "=== 7. Dependency hygiene inside the image ==="
# The image must not contain the repository's development-only surface.
if docker run --rm --entrypoint sh "$IMAGE" -c 'test ! -f /app/.env && test ! -f /app/.env.local'; then
  pass "image ships no .env files"
else
  fail "image contains an .env file (secret leak risk)"
fi
# Next 16's own standalone trace includes selected `src/app` files, so asserting
# that `/app/src/app` is absent is wrong: it rejects the framework's canonical
# output and says nothing about leaked development material. Assert on the actual
# dev-only surfaces instead.
if docker run --rm --entrypoint sh "$IMAGE" -c \
  'test ! -d /app/tests && test ! -d /app/.git && test ! -d /app/docs && test ! -f /app/playwright.config.ts'; then
  pass "image excludes tests, docs, Playwright config and VCS metadata"
else
  fail "image contains development-only repository material"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "DOCKER VERIFICATION FAILED: $failures check(s) failed."
  exit 1
fi
echo "DOCKER VERIFICATION PASSED: image builds, both processes start, database writes, storage persists, shutdown is clean."
