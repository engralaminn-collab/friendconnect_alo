#!/bin/bash
# Run chat-service and verify the realtime flow end-to-end in one shot.
set +e

# Resolve paths from this script rather than a hardcoded developer checkout.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pkill -f "chat-service" 2>/dev/null
pkill -f "supervise-chat" 2>/dev/null
sleep 1

setsid "$REPO_ROOT/scripts/supervise-chat.sh" > /tmp/chat-service.log 2>&1 < /dev/null &
disown

# wait for chat-service
for i in 1 2 3 4 5 6 7 8 9 10 12 14 16 18 20; do
  if curl -s --max-time 1 "http://localhost:3003/?EIO=4&transport=polling" 2>&1 | head -1 | grep -q "sid"; then
    echo "[OK] chat-service up after ${i}s"
    break
  fi
  sleep 1
done

echo "---chat-service log---"
tail -10 /tmp/chat-service.log
echo "---probe via caddy---"
curl -s "http://localhost:81/?EIO=4&transport=polling&XTransformPort=3003" 2>&1 | head -1

# Wait 10s for sockets to settle
sleep 10
echo "---chat-service log after 10s---"
tail -20 /tmp/chat-service.log
echo "---ps---"
ps -ef | grep -E "supervise|bun.*chat" | grep -v grep | head -3
