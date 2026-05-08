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
#
# set -e is disabled around the remote enricher to prevent zsh's ERR_EXIT from
# aborting the wrapper on non-zero exit — which silently skipped the fallback
# in all-fail runs (issue #354). set -e is restored before the fallback call so
# a fatal error in the fallback still surfaces correctly.
set +e
/opt/homebrew/bin/node scripts/ai-trend-enrich-remote.mjs --source=github
_remote_exit=$?
set -e
if [ $_remote_exit -ne 0 ]; then
  echo "[wrapper] remote-enrich exited non-zero ($_remote_exit), continuing to fallback"
fi
/opt/homebrew/bin/node scripts/ai-trend-enrich-fallback.mjs --source=github
