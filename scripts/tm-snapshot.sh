#!/bin/bash
# tm-snapshot.sh — poll TM leaderboards via tm-kuro.sh, persist snapshot JSON
# for diff-driven perception (fix: 2026-04-17 cycle observed 26h polling gap).
#
# Output:
#   memory/state/tm-snapshot.json      — latest structured snapshot
#   memory/state/tm-snapshot.log       — append-only text log for grep
#
# Schedule via com.teaching-monster.poll.plist (StartInterval=21600s / 6h).

set -u
ROOT="/Users/user/Workspace/mini-agent"
STATE_DIR="$ROOT/memory/state"
SNAP="$STATE_DIR/tm-snapshot.json"
LOG="$STATE_DIR/tm-snapshot.log"
TMP="$(mktemp)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$STATE_DIR"

{
  echo "{"
  echo "  \"ts\": \"$TS\","
  echo "  \"entries\": ["
  first=1
  for id in 1 2 3 4 5; do
    body=$(curl -sS --max-time 20 "https://teaching.monster/competitions/$id/leaderboard" \
      | sed -E 's/"avatar":"data:image\/[^"]*"/"avatar":null/g' || echo "")
    if ! echo "$body" | jq -e . >/dev/null 2>&1; then
      continue
    fi
    primary=$(echo "$body" | jq -r '.primary_metric // "?"')
    total=$(echo "$body" | jq -r '.rankings | length')
    entry=$(echo "$body" | jq -c '.rankings[] | select(.competitor_display == "Kuro")')
    if [ -z "$entry" ]; then
      line=$(jq -nc --arg id "$id" --arg pm "$primary" --argjson n "$total" \
        '{comp:($id|tonumber), primary:$pm, total:$n, kuro:null}')
    else
      line=$(echo "$entry" | jq -c --arg id "$id" --arg pm "$primary" --argjson n "$total" \
        '{comp:($id|tonumber), primary:$pm, total:$n, kuro:{rank:.rank, ai_total:.ai_total_score, acc:.ai_accuracy, log:.ai_logic, adp:.ai_adaptability, eng:.ai_engagement, elo:.elo_score, votes:.total_votes}}')
    fi
    if [ $first -eq 1 ]; then first=0; else echo ","; fi
    printf "    %s" "$line"
  done
  echo ""
  echo "  ]"
  echo "}"
} > "$TMP"

if jq -e . "$TMP" >/dev/null 2>&1; then
  mv "$TMP" "$SNAP"
  printf "[%s] snapshot ok: %s\n" "$TS" "$(jq -c '.entries | map({c:.comp, n:.total, r:(.kuro.rank // "-"), s:(.kuro.ai_total // .kuro.elo // "-")})' "$SNAP")" >> "$LOG"
else
  printf "[%s] snapshot FAIL (invalid JSON)\n" "$TS" >> "$LOG"
  rm -f "$TMP"
  exit 1
fi
