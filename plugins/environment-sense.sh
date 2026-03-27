#!/bin/bash
# Environment Sense — 硬體 + 網路 + 能力偵測
# Category: heartbeat (30min refresh)
#
# 使用 kuro-sense binary 偵測環境，輸出三行壓縮格式 (~200 tokens)
# 硬體從 startup cache 讀取（不重跑），網路每次即時偵測
# Binary 不存在時靜默退出

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SENSE_BIN="$PROJECT_DIR/tools/kuro-sense/kuro-sense"
CACHE_FILE="$HOME/.mini-agent/sense-cache.json"
ALERTS_FILE="$HOME/.mini-agent/sense-alerts.json"

# Binary 不存在 → 靜默退出
[ -x "$SENSE_BIN" ] || exit 0

# jq 不存在 → 靜默退出
command -v jq &>/dev/null || exit 0

# ── 硬體資料：讀 startup cache（不重跑）──
HW_LINE=""
if [ -f "$CACHE_FILE" ]; then
  HW_LINE=$(jq -r '
    (.Hardware.cameras // [] | length) as $cam |
    (.Hardware.microphones // [] | length) as $mic |
    (.Hardware.displays // [] | length) as $disp |
    (.Hardware.displays[0].resolution // "unknown") as $res |
    "HW: \($cam)cam \($mic)mic \($disp)disp(\($res)) ✓"
  ' "$CACHE_FILE" 2>/dev/null)
fi

# ── 網路資料：每次即時偵測 ──
NET_LINE=""
CAP_LINE=""
ALERTS=""

DETECT_JSON=$("$SENSE_BIN" detect --json 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$DETECT_JSON" ]; then
  # 網路行
  NET_LINE=$(echo "$DETECT_JSON" | jq -r '
    .Network as $n |
    # Internet
    (if $n.internet.connected then "inet(\($n.internet.latency))" else "inet(✗)" end) as $inet |
    # Services
    ([$n.services[] | "\(.name | split(" ")[0] | ascii_downcase)(\(if .reachable then .latency else "✗ \(.latency // "TIMEOUT")" end))"] | join(" ")) as $svc |
    # VPN
    (if $n.vpn.active then "vpn:on" else "vpn:off" end) as $vpn |
    "Net: \($inet) \($svc) \($vpn)"
  ' 2>/dev/null)

  # 能力行
  CAP_LINE=$(echo "$DETECT_JSON" | jq -r '
    (.Capabilities | length) as $total |
    ([.Capabilities[] | select(.Available == true)] | length) as $avail |
    ([.Capabilities[] | select(.Available == false) | .Capability.Name] | join(" ")) as $missing |
    if ($total == $avail) then
      "Cap: \($avail)/\($total) ✓"
    else
      "Cap: \($avail)/\($total) ✓ | ✗ \($missing)"
    end
  ' 2>/dev/null)

  # 異常偵測：API 服務不可達
  UNREACHABLE=$(echo "$DETECT_JSON" | jq -r '
    [.Network.services[] | select(.reachable == false) | .name] | join(", ")
  ' 2>/dev/null)
  if [ -n "$UNREACHABLE" ] && [ "$UNREACHABLE" != "" ]; then
    ALERTS="⚠ Unreachable: $UNREACHABLE"
  fi
fi

# ── 讀取 sense-alerts.json（來自 self-healing / agent hooks）──
if [ -f "$ALERTS_FILE" ]; then
  EXTRA_ALERTS=$(jq -r '
    (now - 3600 | strftime("%Y-%m-%dT%H:%M:%SZ")) as $cutoff |
    [.[] | select(.ts > $cutoff) |
      if .type == "self-healed" then "🔧 \(.service) auto-restarted"
      elif .type == "api-status" then "⚠ \(.service) \(.status)"
      elif .type == "telegram-status" then "⚠ Telegram \(.status) (queue:\(.queueSize // "?"))"
      else empty end
    ] | join(" | ")
  ' "$ALERTS_FILE" 2>/dev/null)
  if [ -n "$EXTRA_ALERTS" ] && [ "$EXTRA_ALERTS" != "" ]; then
    if [ -n "$ALERTS" ]; then
      ALERTS="$ALERTS | $EXTRA_ALERTS"
    else
      ALERTS="$EXTRA_ALERTS"
    fi
  fi
fi

# ── 輸出 ──
# 用 cache 的 HW，fallback 到即時偵測
if [ -z "$HW_LINE" ] && [ -n "$DETECT_JSON" ]; then
  HW_LINE=$(echo "$DETECT_JSON" | jq -r '
    (.Hardware.cameras // [] | length) as $cam |
    (.Hardware.microphones // [] | length) as $mic |
    (.Hardware.displays // [] | length) as $disp |
    (.Hardware.displays[0].resolution // "unknown") as $res |
    "HW: \($cam)cam \($mic)mic \($disp)disp(\($res)) ✓"
  ' 2>/dev/null)
fi

[ -n "$HW_LINE" ] && echo "$HW_LINE"
[ -n "$NET_LINE" ] && echo "$NET_LINE"
[ -n "$CAP_LINE" ] && echo "$CAP_LINE"
[ -n "$ALERTS" ] && echo "$ALERTS"

exit 0
