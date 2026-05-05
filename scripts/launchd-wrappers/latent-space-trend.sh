#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent

# Idempotency guard: skip if today's file already exists with content
TODAY=$(date +%Y-%m-%d)
OUT="memory/state/latent-space-trend/${TODAY}.json"
if [ -s "$OUT" ] && [ $(wc -c < "$OUT") -gt 1000 ]; then
  echo "[latent-space-trend] skip ${TODAY} (already exists, $(wc -c < "$OUT") bytes)"
  exit 0
fi

set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/latent-space-trend.mjs
