#!/bin/bash
# Wrapper that keeps chat-service alive
cd /home/z/my-project/mini-services/chat-service
while true; do
  echo "[$(date)] Starting chat-service..."
  bun run dev
  EXIT=$?
  echo "[$(date)] chat-service exited with code $EXIT, restarting in 2s..."
  sleep 2
done
