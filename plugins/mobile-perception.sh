#!/bin/bash
# Mobile Perception Plugin
# 讀取手機 sensor cache file，輸出 <mobile> section
# Phase 1: GPS + Orientation + Motion
# v2: Smart display — hide unavailable sensors, infer movement state

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

# Output sensor data with smart display
jq -r '
  (if .data then . * .data else . end) as $d |

  # Device info
  "Connected: \($d.deviceName // "unknown")",

  # Location (always show if available)
  (if $d.latitude then
    "Location: \($d.latitude), \($d.longitude) ±\($d.accuracy // "?" | if type == "number" then (. | round | tostring) else . end)m"
  else
    "Location: unavailable"
  end),

  # Altitude (only if present and non-zero)
  (if ($d.altitude // null) and ($d.altitude | . > 0 or . < 0) then
    "Altitude: \($d.altitude | round)m"
  else empty end),

  # Movement state — infer from speed
  (if $d.speed and $d.speed > 0 then
    (if $d.speed > 11 then "Moving: 🚗 driving (\($d.speed | .*10|round/10) m/s)"
     elif $d.speed > 1.5 then "Moving: 🚶 walking (\($d.speed | .*10|round/10) m/s)"
     else "Moving: barely (\($d.speed | .*10|round/10) m/s)"
     end) +
    (if $d.heading then " heading \($d.heading | round)°" else "" end)
  elif $d.speed == 0 or $d.speed == null then
    "Moving: stationary"
  else empty end),

  # Orientation (only if any sensor has data)
  (if $d.alpha or $d.beta or $d.gamma then
    "Orientation: α=\($d.alpha // 0 | round)° β=\($d.beta // 0 | round)° γ=\($d.gamma // 0 | round)°"
  else empty end),

  # Acceleration (only if any sensor has data)
  (if $d.accelX or $d.accelY or $d.accelZ then
    "Accel: x=\($d.accelX // 0 | .*10|round/10) y=\($d.accelY // 0 | .*10|round/10) z=\($d.accelZ // 0 | .*10|round/10)"
  else empty end),

  # Note if no motion sensors (desktop browser)
  (if ($d.alpha == null and $d.beta == null and $d.gamma == null and $d.accelX == null) then
    "Sensors: GPS only (no gyro/accel — desktop browser?)"
  else empty end),

  # Timestamp
  "Updated: \(.updatedAt // .receivedAt // "?")"
' "$STATE" 2>/dev/null
