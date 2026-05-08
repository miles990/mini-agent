#!/bin/zsh
# Forensic + bulletproof wrapper for github-ai-trend.
# Issue #354: fallback enricher silently skipped after remote enricher's all-fail run.
#
# Design:
# - No `set -e`: every step is independent; remote-enrich is *expected* to fail
#   and must never short-circuit the fallback step.
# - Every step wrapped in `|| echo`: any non-zero exit is logged but absorbed.
# - Every step gets a `[wrapper TIMESTAMP] step=NAME phase=PHASE` marker,
#   so if the process is killed mid-run the launchd log shows exactly where it died.
# - `[wrapper] step=done` only emitted on full success (all four phases reached).
#   Absence of this line is a hard signal that the wrapper was terminated.

cd /Users/user/Workspace/mini-agent

set -a
. ./.env
set +a

NODE=/opt/homebrew/bin/node
ts() { date -u +%FT%TZ }

echo "[wrapper $(ts)] step=fetch phase=start"
$NODE scripts/github-ai-trend.mjs \
  || echo "[wrapper $(ts)] step=fetch phase=nonzero (continuing)"
echo "[wrapper $(ts)] step=fetch phase=end"

echo "[wrapper $(ts)] step=remote-enrich phase=start"
$NODE scripts/ai-trend-enrich-remote.mjs --source=github \
  || echo "[wrapper $(ts)] step=remote-enrich phase=nonzero (continuing to fallback)"
echo "[wrapper $(ts)] step=remote-enrich phase=end"

echo "[wrapper $(ts)] step=fallback phase=start"
$NODE scripts/ai-trend-enrich-fallback.mjs --source=github \
  || echo "[wrapper $(ts)] step=fallback phase=nonzero"
echo "[wrapper $(ts)] step=fallback phase=end"

echo "[wrapper $(ts)] step=done"
