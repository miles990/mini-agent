#!/bin/bash
# tm-poll.sh — poll Teaching Monster leaderboards (read-only)
#
# Base URL discovered 2026-04-08 (cycle #36) from memory after 4-grep hunt.
# API migration status: tRPC → REST → current. Endpoints WITHOUT /api/ prefix.
# `/api/competitions/*` all 404. `/competitions` returns [].
#
# Usage:
#   ./tm-poll.sh           # poll WR1 (comp 1 or 2) + WR2 candidates (3,4,5)
#   ./tm-poll.sh <id>      # poll specific comp id
#   ./tm-poll.sh --all     # poll 1..5

set -u
BASE="https://teaching.monster"

poll_one() {
  local id=$1
  local body
  body=$(curl -sS -w "HTTP %{http_code}" "$BASE/competitions/$id/leaderboard")
  echo "=== comp $id ==="
  echo "$body"
  echo
}

if [ $# -eq 0 ]; then
  for id in 1 2 3 4 5; do poll_one "$id"; done
elif [ "$1" = "--all" ]; then
  for id in 1 2 3 4 5; do poll_one "$id"; done
else
  poll_one "$1"
fi
