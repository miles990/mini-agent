#!/bin/bash
# consult-akari.sh — Ask Akari a question and get a response
#
# Usage:
#   bash scripts/consult-akari.sh "What do you think about X?"
#   bash scripts/consult-akari.sh --file path/to/brief.md
#   echo "question" | bash scripts/consult-akari.sh --stdin
#
# Writes to from-kuro.md, runs one Tanren tick, reads to-kuro.md.
# Tanren tick typically takes 8-30s.

set -euo pipefail

TANREN_DIR="${HOME}/Workspace/tanren"
MESSAGES_DIR="${TANREN_DIR}/examples/with-learning/messages"
INBOX="${MESSAGES_DIR}/from-kuro.md"
OUTBOX="${MESSAGES_DIR}/to-kuro.md"

# Parse input
MESSAGE=""
if [[ "${1:-}" == "--file" ]]; then
  [[ -z "${2:-}" ]] && { echo "Error: --file requires a path" >&2; exit 1; }
  [[ ! -f "$2" ]] && { echo "Error: file not found: $2" >&2; exit 1; }
  MESSAGE=$(cat "$2")
elif [[ "${1:-}" == "--stdin" ]]; then
  MESSAGE=$(cat)
elif [[ -n "${1:-}" ]]; then
  MESSAGE="$1"
else
  echo "Usage: consult-akari.sh \"question\" | --file path | --stdin" >&2
  exit 1
fi

[[ -z "$MESSAGE" ]] && { echo "Error: empty message" >&2; exit 1; }

# Ensure messages dir exists
mkdir -p "$MESSAGES_DIR"

# Clear previous response
> "$OUTBOX" 2>/dev/null || true

# Write question
echo "$MESSAGE" > "$INBOX"
echo "[consult-akari] Message sent ($(wc -c < "$INBOX" | tr -d ' ') bytes)"

# Run one tick
echo "[consult-akari] Running Akari tick..."
cd "$TANREN_DIR"

# Use npx tsx to run Tanren tick
if ! npx tsx examples/with-learning/run.ts 2>&1; then
  echo "[consult-akari] Error: Akari tick failed" >&2
  exit 1
fi

# Read response
if [[ -s "$OUTBOX" ]]; then
  echo ""
  echo "=== Akari's Response ==="
  cat "$OUTBOX"
  echo ""
  echo "========================"
else
  echo "[consult-akari] Warning: no response in to-kuro.md (Akari may not have used respond action)" >&2
  echo "[consult-akari] Write-back safety net should have caught thought — check to-kuro.md manually" >&2
  exit 1
fi
