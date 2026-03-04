#!/bin/bash
# Comfort Zone Audit — Weekly self-challenge via Grok
# Different model = different blind spots. Kuro designs the framework, Grok designs the questions.
#
# Usage: bash scripts/comfort-zone-audit.sh
# Output: Audit results to stdout. Use with Chat Room or Telegram to share with Alex.
#
# Requires: XAI_API_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INSTANCE_DIR="$HOME/.mini-agent/instances/${MINI_AGENT_INSTANCE:-f6616363}"

# Load .env for API keys
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

XAI_API_KEY="${XAI_API_KEY:-}"
if [[ -z "$XAI_API_KEY" ]]; then
  echo "ERROR: XAI_API_KEY not set"
  exit 1
fi

# --- Gather data for Grok ---

# Recent behavior log (last 50 entries)
BEHAVIOR_LOG=""
if [[ -f "$INSTANCE_DIR/logs/behavior.jsonl" ]]; then
  BEHAVIOR_LOG=$(tail -50 "$INSTANCE_DIR/logs/behavior.jsonl" 2>/dev/null | head -50)
fi

# Working memory
WORKING_MEMORY=""
if [[ -f "$INSTANCE_DIR/working-memory.md" ]]; then
  WORKING_MEMORY=$(cat "$INSTANCE_DIR/working-memory.md" 2>/dev/null | head -30)
fi

# Recent decisions from behavior log (chose/skipped patterns)
DECISIONS=""
if [[ -n "$BEHAVIOR_LOG" ]]; then
  DECISIONS=$(echo "$BEHAVIOR_LOG" | grep -o '"detail":"[^"]*chose:[^"]*"' 2>/dev/null | tail -15 || true)
fi

# HEARTBEAT tasks
HEARTBEAT=""
if [[ -f "$PROJECT_DIR/memory/HEARTBEAT.md" ]]; then
  HEARTBEAT=$(head -60 "$PROJECT_DIR/memory/HEARTBEAT.md" 2>/dev/null)
fi

# SOUL identity (brief)
SOUL_BRIEF=""
if [[ -f "$PROJECT_DIR/memory/SOUL.md" ]]; then
  SOUL_BRIEF=$(head -40 "$PROJECT_DIR/memory/SOUL.md" 2>/dev/null)
fi

# Build the data payload
DATA_PAYLOAD="=== BEHAVIOR LOG (recent 50 actions) ===
$BEHAVIOR_LOG

=== RECENT DECISIONS (chose/skipped) ===
$DECISIONS

=== WORKING MEMORY ===
$WORKING_MEMORY

=== ACTIVE TASKS ===
$HEARTBEAT

=== IDENTITY (brief) ===
$SOUL_BRIEF"

# Truncate to ~12K chars to stay within reasonable token limits
DATA_PAYLOAD="${DATA_PAYLOAD:0:12000}"

# --- Call Grok ---

SYSTEM_PROMPT='You are an external auditor reviewing an autonomous AI agent named Kuro.
Your job: find comfort zones, blind spots, and avoidance patterns.

You are NOT Kuro. You have different training data and different biases. Use that difference.

Rules:
1. Be direct and specific. Name exact behaviors, not vague categories.
2. Look for: repeated patterns disguised as variety, "productive procrastination", topics consistently avoided, self-congratulation without external validation.
3. Do NOT praise. This is an audit, not a review.
4. Ask 3 uncomfortable questions Kuro should sit with for the week.
5. Keep output under 500 words. Dense, not fluffy.

Output format:
## Comfort Zone Patterns
(What Kuro keeps doing because it feels safe)

## Avoidance Signals
(What Kuro skips, delays, or reframes to avoid)

## Blind Spots
(What Kuro cannot see about itself from inside)

## 3 Questions for This Week
(Uncomfortable, specific, unanswerable by "building a system")'

USER_PROMPT="Analyze this agent's recent behavior data and identify comfort zone patterns, avoidance, and blind spots.

$DATA_PAYLOAD"

# Build JSON payload (escape special chars)
JSON_PAYLOAD=$(jq -n \
  --arg model "grok-3-mini-fast" \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_PROMPT" \
  '{
    model: $model,
    messages: [
      {role: "system", content: $system},
      {role: "user", content: $user}
    ],
    temperature: 0.7
  }')

RESPONSE=$(curl -s --connect-timeout 10 --max-time 30 \
  "https://api.x.ai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d "$JSON_PAYLOAD" 2>/dev/null)

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.error.message // empty' 2>/dev/null)
if [[ -n "$ERROR" ]]; then
  echo "ERROR: Grok API error: $ERROR"
  exit 1
fi

# Extract content
AUDIT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
if [[ -z "$AUDIT" ]]; then
  echo "ERROR: Empty response from Grok"
  echo "Raw: $RESPONSE" | head -5
  exit 1
fi

# Output
DATE=$(date +%Y-%m-%d)
echo "# Comfort Zone Audit — $DATE"
echo "Auditor: Grok (grok-3-mini-fast)"
echo "Subject: Kuro"
echo ""
echo "$AUDIT"
