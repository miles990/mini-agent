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
BRIDGE_BIND="${BRIDGE_BIND:-127.0.0.1}"
BRIDGE_HEADLESS="${BRIDGE_HEADLESS:-true}"
BRIDGE_STEALTH="${BRIDGE_STEALTH:-light}"

# ─── Helpers ──────────────────────────────────────────────────────────────────

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

  local binary="pinchtab-${os}-${arch}"
  local url="https://github.com/nichochar/pinchtab/releases/latest/download/${binary}"

  echo "Downloading Pinchtab: $url"
  if curl -fSL --max-time 60 "$url" -o "$PINCHTAB_BIN"; then
    chmod +x "$PINCHTAB_BIN"
    echo "Installed: $PINCHTAB_BIN"
    "$PINCHTAB_BIN" --version 2>/dev/null || true
  else
    echo "Download failed. Install manually:"
    echo "  curl -fSL '$url' -o '$PINCHTAB_BIN' && chmod +x '$PINCHTAB_BIN'"
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

  echo "Starting Pinchtab on port $PINCHTAB_PORT..."

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
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done

  echo "Pinchtab started but health check failed"
  echo "Check logs: $PINCHTAB_LOG"
  echo "STATUS: STARTED_NO_HEALTH"
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

# ─── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  install)  cmd_install ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  restart)  cmd_restart ;;
  *)
    echo "pinchtab-setup — Manage Pinchtab browser bridge"
    echo ""
    echo "Commands:"
    echo "  install   Download and install Pinchtab binary"
    echo "  start     Start Pinchtab (manages Chrome lifecycle)"
    echo "  stop      Stop Pinchtab"
    echo "  status    Check Pinchtab status and health"
    echo "  restart   Restart Pinchtab"
    echo ""
    echo "Environment:"
    echo "  PINCHTAB_PORT=9867       API port"
    echo "  BRIDGE_BIND=127.0.0.1    Bind address"
    echo "  BRIDGE_HEADLESS=true     Headless Chrome"
    echo "  BRIDGE_STEALTH=light     Anti-detection level"
    ;;
esac
