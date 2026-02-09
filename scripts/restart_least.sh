#!/usr/bin/env bash
# restart_least.sh — kill all → build → start detached
set -euo pipefail

echo "⏹  Stopping all instances..."
mini-agent kill --all 2>/dev/null || true

# 確保 port 真的釋放（防 EADDRINUSE）
# kill --all 現在有 SIGKILL fallback，但仍需等待
for i in 1 2 3 4 5; do
  PORT_PID=$(lsof -ti :3001 2>/dev/null || true)
  if [ -z "$PORT_PID" ]; then
    break
  fi
  if [ "$i" -ge 3 ]; then
    echo "⚠️  Port 3001 still in use (PID $PORT_PID), force killing..."
    kill -9 $PORT_PID 2>/dev/null || true
  fi
  sleep 1
done

echo "🔄 Updating mini-agent..."
mini-agent update

echo "🔨 Building..."
pnpm --dir "$(dirname "$0")/.." build

echo "📦 Syncing dist..."
cp "$(dirname "$0")"/../dist/*.js "$(dirname "$0")"/../dist/*.d.ts "$(dirname "$0")"/../dist/*.map ~/.mini-agent/dist/ 2>/dev/null || true

echo "🚀 Starting..."
mini-agent up -d

echo "✅ Done"
