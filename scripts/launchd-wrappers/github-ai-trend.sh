#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/github-ai-trend.mjs
# Remote enrich (claude-cli). Allowed to partially or fully fail —
# fallback below always runs to backfill any post still showing
# 'pending-llm-pass' so the user-facing output is never the literal
# placeholder string. Issue #258.
/opt/homebrew/bin/node scripts/ai-trend-enrich-remote.mjs --source=github \
  || echo "[wrapper] remote-enrich exited non-zero, continuing to fallback"
/opt/homebrew/bin/node scripts/ai-trend-enrich-fallback.mjs --source=github
