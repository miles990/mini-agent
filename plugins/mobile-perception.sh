#!/bin/bash
# Mobile Perception Plugin
# 讀取手機 sensor cache file + history，輸出 <mobile> section
# Phase 1.5: GPS + Orientation + Motion + Activity Recognition + Temporal State

STATE="$HOME/.mini-agent/mobile-state.json"
HISTORY="$HOME/.mini-agent/mobile-history.jsonl"

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
  if [ "$AGE" -gt 3600 ]; then
    echo "Disconnected (last seen $(( AGE / 3600 ))h ago)"
  elif [ "$AGE" -gt 60 ]; then
    echo "Disconnected (last seen $(( AGE / 60 ))m ago)"
  else
    echo "Disconnected (last seen ${AGE}s ago)"
  fi
  exit 0
fi

# --- Phase 1.5: Activity Recognition from history ---
ACTIVITY=""
if [ -f "$HISTORY" ]; then
  # Read last 12 entries (~60s at 5s interval) and compute accel magnitude variance
  ACTIVITY=$(tail -12 "$HISTORY" | jq -s '
    # Extract acceleration magnitudes
    [.[] | select(.accelX != null) |
      ((.accelX // 0) * (.accelX // 0) + (.accelY // 0) * (.accelY // 0) + (.accelZ // 0) * (.accelZ // 0)) | sqrt
    ] as $mags |

    if ($mags | length) < 3 then
      "unknown (insufficient data)"
    else
      # Compute variance of magnitudes
      ($mags | add / length) as $mean |
      ($mags | map(. - $mean | . * .) | add / length) as $variance |

      # Classify activity based on variance thresholds
      if $variance < 0.5 then
        "stationary (variance: \($variance | .*100|round/100))"
      elif $variance < 3.0 then
        "walking (variance: \($variance | .*100|round/100))"
      else
        "active movement (variance: \($variance | .*100|round/100))"
      end
    end
  ' 2>/dev/null)

  # Compute time span of history
  HISTORY_SPAN=$(tail -12 "$HISTORY" | jq -s '
    if length < 2 then "—"
    else
      ((.[0].ts // "") | split(".")[0] | split("T")[1] // "?") + "→" +
      (.[-1].ts // "" | split(".")[0] | split("T")[1] // "?") +
      " (\(length) samples)"
    end
  ' -r 2>/dev/null)
fi

# --- Output sensor data with smart display ---
jq -r '
  (if .data then . * .data else . end) as $d |

  # Device info
  "Connected: \($d.deviceName // "unknown")",

  # Location
  (if $d.latitude then
    "Location: \($d.latitude), \($d.longitude) ±\($d.accuracy // "?" | if type == "number" then (. | round | tostring) else . end)m"
  else
    "Location: unavailable (GPS permission needed or acquiring)"
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

# Activity recognition from history (Phase 1.5)
if [ -n "$ACTIVITY" ] && [ "$ACTIVITY" != "null" ]; then
  echo "Activity: $ACTIVITY"
fi
if [ -n "$HISTORY_SPAN" ] && [ "$HISTORY_SPAN" != "null" ] && [ "$HISTORY_SPAN" != "—" ]; then
  echo "History: $HISTORY_SPAN"
fi
