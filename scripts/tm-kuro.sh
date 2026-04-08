#!/bin/bash
# tm-kuro.sh — one-liner extract Kuro's scores across all TM competitions
#
# Schema locked 2026-04-08 (cycle #77) after burning 5 delegates on jq/grep
# guess-and-check. Crystallized lesson: "consecutive parse failure =
# schema ignorance, not query bug". This wrapper ossifies the schema.
#
#   GET https://teaching.monster/competitions/{id}/leaderboard
#   Response: {competition_id, primary_metric, display_metrics, rankings:[...]}
#   Rankings entry: competitor_display, rank, elo_score, total_votes,
#                   ai_accuracy, ai_logic, ai_adaptability, ai_engagement,
#                   ai_total_score
#   Kuro's competitor_display = "Kuro" (not "Kuro-Teach")
#
# Usage:
#   ./tm-kuro.sh             # all 5 comps, default name=Kuro
#   ./tm-kuro.sh <name>      # search different competitor_display
#   ./tm-kuro.sh <name> <id> # single comp

set -u
BASE="https://teaching.monster"
NAME="${1:-Kuro}"

if [ "${2:-}" ]; then
  IDS=("$2")
else
  IDS=(1 2 3 4 5)
fi

for id in "${IDS[@]}"; do
  body=$(curl -sS "$BASE/competitions/$id/leaderboard" \
    | sed -E 's/"avatar":"data:image\/[^"]*"/"avatar":null/g')

  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    printf "comp %s: (invalid JSON — skip)\n" "$id"
    continue
  fi

  primary=$(echo "$body" | jq -r '.primary_metric // "?"')
  total=$(echo "$body" | jq -r '.rankings | length')

  entry=$(echo "$body" | jq -c --arg n "$NAME" '.rankings[] | select(.competitor_display == $n)')

  if [ -z "$entry" ]; then
    printf "comp %s [%s, n=%s]: %s not found\n" "$id" "$primary" "$total" "$NAME"
    continue
  fi

  rank=$(echo "$entry" | jq -r '.rank')
  elo=$(echo "$entry" | jq -r '.elo_score')
  votes=$(echo "$entry" | jq -r '.total_votes')
  ai_total=$(echo "$entry" | jq -r '.ai_total_score // "-"')
  ai_acc=$(echo "$entry" | jq -r '.ai_accuracy // "-"')
  ai_log=$(echo "$entry" | jq -r '.ai_logic // "-"')
  ai_adp=$(echo "$entry" | jq -r '.ai_adaptability // "-"')
  ai_eng=$(echo "$entry" | jq -r '.ai_engagement // "-"')

  printf "comp %s [%s, n=%s]: rank=%s total=%s  acc=%s log=%s adp=%s eng=%s  elo=%s votes=%s\n" \
    "$id" "$primary" "$total" "$rank" "$ai_total" "$ai_acc" "$ai_log" "$ai_adp" "$ai_eng" "$elo" "$votes"
done
