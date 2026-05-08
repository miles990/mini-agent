#!/bin/zsh
# build-kuro-content launchd wrapper (#394)
# Schedule: 16:25 daily -- after enrich (~15:30), before build-ai-trend-index (16:30)
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/build-kuro-content.mjs
