#!/bin/bash
# Mobile Perception Plugin
# 讀取手機 sensor cache file，輸出 <mobile> section
# Phase 1: GPS + Orientation + Motion

STATE="$HOME/.mini-agent/mobile-state.json"

if [ ! -f "$STATE" ]; then
  echo "Not connected"
  exit 0
fi

# Check freshness (>120s = disconnected, allows for background/network delays)
UPDATED=$(jq -r '.updatedAt // .receivedAt // empty' "$STATE" 2>/dev/null)
if [ -z "$UPDATED" ]; then
  echo "Not connected (no timestamp)"
  exit 0
fi

# macOS date: parse ISO timestamp (updatedAt is UTC with Z suffix)
UPDATED_EPOCH=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%S" "${UPDATED%%.*}" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
AGE=$(( NOW_EPOCH - UPDATED_EPOCH ))

if [ "$AGE" -gt 120 ]; then
  echo "Disconnected (last seen ${AGE}s ago)"
  exit 0
fi

# Output sensor data — flatten .data nested structure
jq -r '
  (if .data then . * .data else . end) as $d |
  "Connected: \($d.deviceName // "unknown")",
  "Location: \($d.latitude // "?"), \($d.longitude // "?") \u00b1\($d.accuracy // "?" | if type == "number" then (. | round | tostring) else . end)m",
  "Altitude: \(if $d.altitude then ($d.altitude | round | tostring) + "m" else "--" end)",
  "Speed: \(if $d.speed then ($d.speed | tostring) + " m/s" else "0 m/s" end)",
  "Heading: \(if $d.heading then ($d.heading | round | tostring) + "\u00b0" else "--" end)",
  "Orientation: \u03b1=\(if $d.alpha then ($d.alpha | round | tostring) else "?" end)\u00b0 \u03b2=\(if $d.beta then ($d.beta | round | tostring) else "?" end)\u00b0 \u03b3=\(if $d.gamma then ($d.gamma | round | tostring) else "?" end)\u00b0",
  "Accel: x=\(if $d.accelX then ($d.accelX | .*10|round/10 | tostring) else "?" end) y=\(if $d.accelY then ($d.accelY | .*10|round/10 | tostring) else "?" end) z=\(if $d.accelZ then ($d.accelZ | .*10|round/10 | tostring) else "?" end)",
  "Updated: \(.updatedAt // .receivedAt // "?")"
' "$STATE" 2>/dev/null
