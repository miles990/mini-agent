#!/bin/bash
# myelin proxy — transparent LLM API proxy for payload logging + crystallization
# Started before mini-agent to intercept Claude CLI requests
#
# Usage:
#   ./scripts/myelin-proxy.sh start   # Start proxy (background)
#   ./scripts/myelin-proxy.sh stop    # Stop proxy
#   ./scripts/myelin-proxy.sh status  # Check if running
#   ./scripts/myelin-proxy.sh logs    # Tail proxy logs

MYELIN_DIR="$HOME/Workspace/myelin"
MYELIN_PORT=8100
MYELIN_TARGET="https://api.anthropic.com"
MYELIN_DATA="$HOME/.mini-agent/myelin"
PID_FILE="$MYELIN_DATA/proxy.pid"

mkdir -p "$MYELIN_DATA"

case "${1:-status}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "myelin proxy already running (PID $(cat "$PID_FILE"))"
      exit 0
    fi

    cd "$MYELIN_DIR" || exit 1
    nohup node dist/cli.js proxy \
      --port "$MYELIN_PORT" \
      --target "$MYELIN_TARGET" \
      --active \
      --min-hits 3 \
      --cache-path "$MYELIN_DATA/cache.json" \
      --log-path "$MYELIN_DATA/proxy.jsonl" \
      --payload-log "$MYELIN_DATA/payload.jsonl" \
      > "$MYELIN_DATA/proxy.out" 2>&1 &

    echo $! > "$PID_FILE"
    sleep 1

    if curl -s "http://localhost:$MYELIN_PORT/__myelin/health" > /dev/null 2>&1; then
      echo "myelin proxy started on port $MYELIN_PORT (PID $!)"
    else
      echo "Failed to start myelin proxy"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null
      rm -f "$PID_FILE"
      echo "myelin proxy stopped"
    else
      echo "myelin proxy not running"
    fi
    ;;

  status)
    if curl -s "http://localhost:$MYELIN_PORT/__myelin/stats" 2>/dev/null; then
      echo ""
    else
      echo "myelin proxy not running"
    fi
    ;;

  logs)
    tail -f "$MYELIN_DATA/proxy.jsonl" 2>/dev/null
    ;;

  *)
    echo "Usage: $0 {start|stop|status|logs}"
    exit 1
    ;;
esac
