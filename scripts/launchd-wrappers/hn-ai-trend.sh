#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
# Fetcher: HN firebase API has transient outages. set -e was killing the whole
# chain on a single fetch failure, leaving today's data empty AND skipping
# enrichment of yesterday's already-pending posts. Same #354 pattern as the
# github wrapper — disable ERR_EXIT around the fetcher, log non-zero, continue
# so enrich + fallback still run on whatever state exists.
set +e
/opt/homebrew/bin/node scripts/hn-ai-trend.mjs
_fetch_exit=$?
set -e
if [ $_fetch_exit -ne 0 ]; then
  echo "[wrapper] hn-ai-trend fetch exited non-zero ($_fetch_exit), continuing to enrich/fallback on existing state"
fi
# LLM enrich (local Qwen, then claude-cli remote). Allowed to partially or
# fully fail — heuristic fallback below always runs to backfill any post
# still showing 'pending-llm-pass'. See Issue #258 (github wrapper) — same
# pattern propagated here for parity. Without this, a depleted Anthropic
# quota collapses the whole HN enrichment chain.
/opt/homebrew/bin/node scripts/hn-ai-trend-enrich.mjs \
  || /opt/homebrew/bin/node scripts/hn-ai-trend-enrich-remote.mjs \
  || echo "[wrapper] both LLM enrich paths failed, continuing to fallback"
/opt/homebrew/bin/node scripts/ai-trend-enrich-fallback.mjs --source=hn
