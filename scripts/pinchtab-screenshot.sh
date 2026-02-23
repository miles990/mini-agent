#!/bin/bash
# Pinchtab Screenshot — Capture screenshot and save to file
#
# Usage:
#   bash scripts/pinchtab-screenshot.sh [output-path]
#   # Default output: /tmp/screenshot.jpg

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
OUTPUT="${1:-/tmp/screenshot.jpg}"

if ! curl -sf --max-time 3 "http://localhost:${PINCHTAB_PORT}/health" >/dev/null 2>&1; then
  echo "Pinchtab not available" >&2
  exit 1
fi

curl -sf --max-time 15 "http://localhost:${PINCHTAB_PORT}/screenshot" -o "$OUTPUT" 2>/dev/null

if [[ -f "$OUTPUT" ]] && [[ -s "$OUTPUT" ]]; then
  echo "Screenshot saved: $OUTPUT"
else
  echo "Screenshot failed" >&2
  exit 1
fi
