#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/arxiv-ai-trend.mjs
# LLM remote enrich (claude-cli). Allowed to partially or fully fail —
# heuristic fallback below always runs. See Issue #258 (github wrapper)
# — same pattern propagated here for parity.
/opt/homebrew/bin/node scripts/ai-trend-enrich-remote.mjs --source=arxiv \
  || echo "[wrapper] remote-enrich exited non-zero, continuing to fallback"
/opt/homebrew/bin/node scripts/ai-trend-enrich-fallback.mjs --source=arxiv
