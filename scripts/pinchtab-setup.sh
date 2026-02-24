#!/bin/bash
# Pinchtab Setup — 安裝、啟動、管理 Pinchtab browser bridge
#
# Usage:
#   bash scripts/pinchtab-setup.sh install   # 下載 binary
#   bash scripts/pinchtab-setup.sh start     # 啟動 Pinchtab
#   bash scripts/pinchtab-setup.sh stop      # 停止 Pinchtab
#   bash scripts/pinchtab-setup.sh status    # 檢查狀態
#   bash scripts/pinchtab-setup.sh restart   # 重啟

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BIN="$HOME/.mini-agent/bin/pinchtab"
PINCHTAB_PID="$HOME/.mini-agent/pinchtab.pid"
PINCHTAB_LOG="$HOME/.mini-agent/pinchtab.log"
PINCHTAB_MODE_FILE="$HOME/.mini-agent/pinchtab.mode"
BRIDGE_BIND="${BRIDGE_BIND:-127.0.0.1}"
# Read saved mode, env override takes precedence
if [[ -n "${BRIDGE_HEADLESS:-}" ]]; then
  : # env var explicitly set, use it
elif [[ -f "$PINCHTAB_MODE_FILE" ]]; then
  BRIDGE_HEADLESS=$(cat "$PINCHTAB_MODE_FILE")
else
  BRIDGE_HEADLESS=true
fi
BRIDGE_STEALTH="${BRIDGE_STEALTH:-light}"
LOG_FILE="$HOME/.mini-agent/cdp.jsonl"

# ─── Helpers ──────────────────────────────────────────────────────────────────

log_event() {
  mkdir -p "$HOME/.mini-agent"
  local json
  json=$(python3 -c "
import json, datetime, sys
d = {}
for arg in sys.argv[1:]:
    if '=' in arg:
        k, v = arg.split('=', 1)
        if v.isdigit(): v = int(v)
        elif v == 'true': v = True
        elif v == 'false': v = False
        d[k] = v
d['ts'] = datetime.datetime.utcnow().isoformat() + 'Z'
print(json.dumps(d))
" "$@" 2>/dev/null || echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"op\":\"setup\"}")
  echo "$json" >> "$LOG_FILE" 2>/dev/null
}

ensure_dirs() {
  mkdir -p "$HOME/.mini-agent/bin"
}

is_running() {
  if [[ -f "$PINCHTAB_PID" ]]; then
    local pid
    pid=$(cat "$PINCHTAB_PID" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$PINCHTAB_PID"
  fi
  return 1
}

health_check() {
  curl -sf --max-time 3 "http://localhost:${PINCHTAB_PORT}/health" >/dev/null 2>&1
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_install() {
  ensure_dirs

  if [[ -f "$PINCHTAB_BIN" ]]; then
    echo "Pinchtab already installed: $PINCHTAB_BIN"
    "$PINCHTAB_BIN" --version 2>/dev/null || true
    return 0
  fi

  # Detect platform
  local arch
  arch=$(uname -m)
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64) arch="amd64" ;;
    *) echo "Unsupported architecture: $arch"; exit 1 ;;
  esac

  local os
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    *) echo "Unsupported OS: $os"; exit 1 ;;
  esac

  local archive="pinchtab-${os}-${arch}.tar.gz"
  local url="https://github.com/pinchtab/pinchtab/releases/latest/download/${archive}"
  local tmpdir
  tmpdir=$(mktemp -d)

  echo "Downloading Pinchtab: $url"
  if curl -fSL --max-time 60 "$url" -o "$tmpdir/$archive"; then
    tar -xzf "$tmpdir/$archive" -C "$tmpdir"
    local extracted
    extracted=$(find "$tmpdir" -name "pinchtab" -type f | head -1)
    if [[ -n "$extracted" ]]; then
      mv "$extracted" "$PINCHTAB_BIN"
      chmod +x "$PINCHTAB_BIN"
      echo "Installed: $PINCHTAB_BIN"
      "$PINCHTAB_BIN" --version 2>/dev/null || true
    else
      echo "Extract failed: pinchtab binary not found in archive"
      exit 1
    fi
    rm -rf "$tmpdir"
  else
    rm -rf "$tmpdir"
    echo "Download failed. Install manually:"
    echo "  curl -fSL '$url' -o /tmp/$archive && tar -xzf /tmp/$archive -C ~/.mini-agent/bin/"
    exit 1
  fi
}

cmd_start() {
  if is_running; then
    echo "Pinchtab already running (PID: $(cat "$PINCHTAB_PID"))"
    health_check && echo "Health: OK" || echo "Health: NOT RESPONDING"
    return 0
  fi

  if [[ ! -x "$PINCHTAB_BIN" ]]; then
    echo "Pinchtab not installed. Run: bash scripts/pinchtab-setup.sh install"
    exit 1
  fi

  ensure_dirs

  local mode_label="headless"
  [[ "$BRIDGE_HEADLESS" == "false" ]] && mode_label="visible"
  echo "Starting Pinchtab on port $PINCHTAB_PORT (mode: $mode_label)..."

  BRIDGE_BIND="$BRIDGE_BIND" \
  BRIDGE_PORT="$PINCHTAB_PORT" \
  BRIDGE_HEADLESS="$BRIDGE_HEADLESS" \
  BRIDGE_STEALTH="$BRIDGE_STEALTH" \
  nohup "$PINCHTAB_BIN" > "$PINCHTAB_LOG" 2>&1 &

  local pid=$!
  echo "$pid" > "$PINCHTAB_PID"

  # Wait for startup
  local retries=10
  while [[ $retries -gt 0 ]]; do
    if health_check; then
      echo "Pinchtab started (PID: $pid, port: $PINCHTAB_PORT)"
      echo "STATUS: OK"
      log_event "op=setup_start" "result=ok" "pid=$pid" "port=$PINCHTAB_PORT" "mode=$mode_label"
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done

  echo "Pinchtab started but health check failed"
  echo "Check logs: $PINCHTAB_LOG"
  echo "STATUS: STARTED_NO_HEALTH"
  log_event "op=setup_start" "result=no_health" "pid=$pid" "port=$PINCHTAB_PORT" "mode=$mode_label"
}

cmd_stop() {
  if ! is_running; then
    echo "Pinchtab not running"
    return 0
  fi

  local pid
  pid=$(cat "$PINCHTAB_PID")
  echo "Stopping Pinchtab (PID: $pid)..."
  kill "$pid" 2>/dev/null
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
  fi

  rm -f "$PINCHTAB_PID"
  echo "Pinchtab stopped"
  log_event "op=setup_stop" "pid=$pid"
}

cmd_status() {
  if is_running; then
    local pid
    pid=$(cat "$PINCHTAB_PID")
    echo "Pinchtab: RUNNING (PID: $pid, port: $PINCHTAB_PORT)"
    if health_check; then
      echo "Health: OK"
      # Show tab count
      local tabs
      tabs=$(curl -sf --max-time 3 "http://localhost:${PINCHTAB_PORT}/tabs" 2>/dev/null)
      if [[ -n "$tabs" ]]; then
        local count
        count=$(echo "$tabs" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
        echo "Tabs: $count"
      fi
      echo "STATUS: OK"
    else
      echo "Health: NOT RESPONDING"
      echo "STATUS: UNHEALTHY"
    fi
  else
    echo "Pinchtab: NOT RUNNING"
    if [[ -x "$PINCHTAB_BIN" ]]; then
      echo "Binary: installed"
      echo "Auto-fix: bash scripts/pinchtab-setup.sh start"
    else
      echo "Binary: not installed"
      echo "Auto-fix: bash scripts/pinchtab-setup.sh install && bash scripts/pinchtab-setup.sh start"
    fi
    echo "STATUS: NOT_RUNNING"
  fi
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_mode() {
  local target="$1"
  case "$target" in
    headless)
      echo "true" > "$PINCHTAB_MODE_FILE"
      echo "Mode set: headless"
      ;;
    visible)
      echo "false" > "$PINCHTAB_MODE_FILE"
      echo "Mode set: visible"
      ;;
    "")
      # Show current mode
      if [[ "$BRIDGE_HEADLESS" == "false" ]]; then
        echo "Current mode: visible"
      else
        echo "Current mode: headless"
      fi
      return 0
      ;;
    *)
      echo "Usage: pinchtab-setup.sh mode [headless|visible]" >&2
      exit 1
      ;;
  esac

  log_event "op=setup_mode" "mode=$target"

  # Restart if running
  if is_running; then
    echo "Restarting Pinchtab in $target mode..."
    cmd_stop
    sleep 1
    # Re-read the mode we just saved
    BRIDGE_HEADLESS=$(cat "$PINCHTAB_MODE_FILE")
    cmd_start
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  install)  cmd_install ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  restart)  cmd_restart ;;
  mode)     cmd_mode "${2:-}" ;;
  *)
    echo "pinchtab-setup — Manage Pinchtab browser bridge"
    echo ""
    echo "Commands:"
    echo "  install          Download and install Pinchtab binary"
    echo "  start            Start Pinchtab (manages Chrome lifecycle)"
    echo "  stop             Stop Pinchtab"
    echo "  status           Check Pinchtab status and health"
    echo "  restart          Restart Pinchtab"
    echo "  mode             Show current mode (headless/visible)"
    echo "  mode headless    Switch to headless mode (+ auto-restart)"
    echo "  mode visible     Switch to visible mode (+ auto-restart)"
    echo ""
    echo "Environment:"
    echo "  PINCHTAB_PORT=9867       API port"
    echo "  BRIDGE_BIND=127.0.0.1    Bind address"
    echo "  BRIDGE_HEADLESS=true     Headless Chrome (overrides saved mode)"
    echo "  BRIDGE_STEALTH=light     Anti-detection level"
    ;;
esac
