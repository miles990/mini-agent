#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/x-ai-trend.mjs --max=15
