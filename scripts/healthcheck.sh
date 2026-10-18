#!/usr/bin/env bash
# FriendConnect — Health Check Script (for cron/monitoring)
set -euo pipefail
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
SOCKET_URL="${SOCKET_HEALTH_URL:-http://localhost:3003/health}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
SOCKET=$(curl -s -o /dev/null -w "%{http_code}" "$SOCKET_URL" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ] && [ "$SOCKET" = "200" ]; then
  echo "OK: app=$STATUS socket=$SOCKET"
  exit 0
else
  echo "FAIL: app=$STATUS socket=$SOCKET"
  pm2 restart friendconnect friendconnect-socket 2>/dev/null || true
  exit 1
fi
