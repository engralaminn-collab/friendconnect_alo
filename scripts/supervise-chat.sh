#!/bin/bash
# Keeps the mini-services chat-service alive.
#
# The project root is derived from this script's own location instead of a
# hardcoded developer path (finding #12), so the repo works wherever it is
# cloned.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHAT_DIR="${CHAT_SERVICE_DIR:-$REPO_ROOT/mini-services/chat-service}"

if [ ! -d "$CHAT_DIR" ]; then
  echo "chat-service not found at $CHAT_DIR" >&2
  echo "Set CHAT_SERVICE_DIR to override." >&2
  exit 1
fi

cd "$CHAT_DIR" || exit 1

# Prefer npm: package.json is the canonical manifest and package-lock.json is the
# only lockfile CI installs from (bun.lock is stale — see CONTRIBUTING.md).
RUNNER="npm"
if ! command -v npm >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  RUNNER="bun"
fi

while true; do
  echo "[$(date)] Starting chat-service with $RUNNER..."
  if [ "$RUNNER" = "bun" ]; then bun run dev; else npm run dev; fi
  EXIT=$?
  echo "[$(date)] chat-service exited with code $EXIT, restarting in 2s..."
  sleep 2
done
