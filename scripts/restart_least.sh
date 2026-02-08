#!/usr/bin/env bash
# restart_least.sh — kill all → build → start detached
set -euo pipefail

echo "⏹  Stopping all instances..."
mini-agent kill --all 2>/dev/null || true

# 確保 port 真的釋放（防 EADDRINUSE）
sleep 1

echo "🔨 Building..."
pnpm --dir "$(dirname "$0")/.." build

echo "📦 Syncing dist..."
cp "$(dirname "$0")"/../dist/*.js "$(dirname "$0")"/../dist/*.d.ts "$(dirname "$0")"/../dist/*.map ~/.mini-agent/dist/ 2>/dev/null || true

echo "🚀 Starting..."
mini-agent up -d

echo "✅ Done"
