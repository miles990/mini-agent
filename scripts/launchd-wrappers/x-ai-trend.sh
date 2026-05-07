#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/x-ai-trend.mjs --max=15
