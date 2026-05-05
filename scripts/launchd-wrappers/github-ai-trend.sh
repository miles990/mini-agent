#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/github-ai-trend.mjs
/opt/homebrew/bin/node scripts/ai-trend-enrich-remote.mjs --source=github
