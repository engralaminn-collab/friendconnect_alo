#!/usr/bin/env bash
set -euo pipefail
pm2 restart friendconnect friendconnect-socket
echo "All services restarted"
