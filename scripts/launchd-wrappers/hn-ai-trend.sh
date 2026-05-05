#!/bin/zsh
set -e
cd /Users/user/Workspace/mini-agent
set -a
. ./.env
set +a
/opt/homebrew/bin/node scripts/hn-ai-trend.mjs
( /opt/homebrew/bin/node scripts/hn-ai-trend-enrich.mjs || /opt/homebrew/bin/node scripts/hn-ai-trend-enrich-remote.mjs )
