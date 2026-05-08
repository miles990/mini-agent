#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/hn-ai-trend.mjs
# LLM enrich (local Qwen, then claude-cli remote). Allowed to partially or
# fully fail — heuristic fallback below always runs to backfill any post
# still showing 'pending-llm-pass'. See Issue #258 (github wrapper) — same
# pattern propagated here for parity. Without this, a depleted Anthropic
# quota collapses the whole HN enrichment chain.
/opt/homebrew/bin/node scripts/hn-ai-trend-enrich.mjs \
  || /opt/homebrew/bin/node scripts/hn-ai-trend-enrich-remote.mjs \
  || echo "[wrapper] both LLM enrich paths failed, continuing to fallback"
/opt/homebrew/bin/node scripts/ai-trend-enrich-fallback.mjs --source=hn
