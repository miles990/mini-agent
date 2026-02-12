#!/bin/bash
# Mobile Perception Plugin
# 讀取手機 sensor cache file，輸出 <mobile> section
# Phase 1: GPS + Orientation + Motion

STATE="$HOME/.mini-agent/mobile-state.json"

if [ ! -f "$STATE" ]; then
  echo "Not connected"
  exit 0
fi

# Check freshness (>30s = disconnected)
UPDATED=$(jq -r '.updatedAt // empty' "$STATE" 2>/dev/null)
if [ -z "$UPDATED" ]; then
  echo "Not connected (no timestamp)"
  exit 0
fi

# macOS date: parse ISO timestamp (updatedAt is UTC with Z suffix)
UPDATED_EPOCH=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%S" "${UPDATED%%.*}" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
AGE=$(( NOW_EPOCH - UPDATED_EPOCH ))

if [ "$AGE" -gt 30 ]; then
  echo "Disconnected (last seen ${AGE}s ago)"
  exit 0
fi

# Output sensor data
jq -r '
  "Connected: \(.deviceName // "unknown")",
  "Location: \(.latitude // "?"), \(.longitude // "?") \u00b1\(.accuracy // "?" | if type == "number" then (. | round | tostring) else . end)m",
  "Altitude: \(if .altitude then (.altitude | round | tostring) + "m" else "--" end)",
  "Speed: \(if .speed then (.speed | tostring) + " m/s" else "0 m/s" end)",
  "Heading: \(if .heading then (.heading | round | tostring) + "\u00b0" else "--" end)",
  "Orientation: \u03b1=\(if .alpha then (.alpha | round | tostring) else "?" end)\u00b0 \u03b2=\(if .beta then (.beta | round | tostring) else "?" end)\u00b0 \u03b3=\(if .gamma then (.gamma | round | tostring) else "?" end)\u00b0",
  "Accel: x=\(if .accelX then (.accelX | .*10|round/10 | tostring) else "?" end) y=\(if .accelY then (.accelY | .*10|round/10 | tostring) else "?" end) z=\(if .accelZ then (.accelZ | .*10|round/10 | tostring) else "?" end)",
  "Updated: \(.updatedAt // "?")"
' "$STATE" 2>/dev/null
