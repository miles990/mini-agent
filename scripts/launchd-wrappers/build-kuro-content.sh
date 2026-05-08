#!/bin/zsh
# Wrapper for com.kuro.build-kuro-content (issue #394).
# Runs daily 16:25 between enrich (~15:30) and build-ai-trend-index (16:30)
# so the index step naturally consumes today's generated kuro-content.
set -e
cd /Users/user/Workspace/mini-agent
# launchd's default PATH excludes ~/.local/bin and homebrew — without these
# the inner `claude` CLI call (build-kuro-content.mjs:181) can't resolve.
# Same fix shipped in #398 for the other ai-trend wrappers.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
set -a
. ./.env
set +a
# build-kuro-content.mjs returns:
#   0 = wrote live <DATE>.md (gate passed)
#   1 = wrote <DATE>.md.draft (gate failed — DO NOT promote)
#   2 = hard error
set +e
/opt/homebrew/bin/node scripts/build-kuro-content.mjs
_exit=$?
set -e
if [ $_exit -ne 0 ]; then
  echo "[wrapper] build-kuro-content exited $_exit (1=draft-only,2=hard-error)"
fi
exit $_exit
