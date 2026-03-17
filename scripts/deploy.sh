#!/bin/bash
# deploy.sh — Build-before-Stop: build first, only stop+restart on success
# This prevents the scenario where build fails after Kuro is already stopped,
# leaving the service dead with no recovery.
set -e

DEPLOY_DIR="/Users/user/Workspace/mini-agent"
LOG_FILE="$HOME/.mini-agent/deploy.log"

mkdir -p "$HOME/.mini-agent"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$DEPLOY_DIR"

log "Starting deployment..."

# ── Phase 1: Pull + Install + Build (Kuro still running) ──

log "Pulling latest code..."
git pull origin main 2>/dev/null || true

log "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

log "Building..."
pnpm build

# Build succeeded — safe to stop and restart

# ── Phase 2: Stop (only after successful build) ──

log "Build successful, stopping existing service..."

# 卸載所有 com.mini-agent.* launchd services（送 SIGTERM 觸發 graceful shutdown）
for plist in "$HOME/Library/LaunchAgents"/com.mini-agent.*.plist; do
    [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null && rm -f "$plist"
done
# 卸載舊的固定 plist（遷移期）
if [ -f "$HOME/Library/LaunchAgents/com.mini-agent.plist" ]; then
    launchctl unload "$HOME/Library/LaunchAgents/com.mini-agent.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.mini-agent.plist"
fi

# 等進程自己優雅退出（最長 11 分鐘，讓 8 分鐘 Claude 呼叫完成）
WAIT_MAX=132  # 132 * 5s = 660s = 11min
for i in $(seq 1 $WAIT_MAX); do
    if ! pgrep -f "node.*mini-agent.*dist/api.js" > /dev/null 2>&1; then
        break
    fi
    if [ "$i" -eq 1 ]; then log "Waiting for running tasks to finish..."; fi
    sleep 5
done

# 只有超時才 force kill
if pgrep -f "node.*mini-agent.*dist/api.js" > /dev/null 2>&1; then
    log "Process still alive after ${WAIT_MAX}x5s, force killing..."
    pkill -9 -f "node.*mini-agent.*dist/api.js" 2>/dev/null || true
    sleep 1
fi

# 確保 port 空出
PORT_PID=$(lsof -ti :3001 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
    log "Port 3001 still in use (PID $PORT_PID), force killing..."
    kill -9 $PORT_PID 2>/dev/null || true
    sleep 1
fi

# ── Phase 3: Sync CLI + Reset Telegram ──

# Sync CLI installation (~/.mini-agent) — non-blocking, 60s timeout
CLI_DIR="$HOME/.mini-agent"
if [ -d "$CLI_DIR/.git" ]; then
    log "Syncing CLI installation ($CLI_DIR)..."
    (
        cd "$CLI_DIR"
        git fetch origin main && git reset --hard origin/main
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
        pnpm build
    ) &
    CLI_PID=$!
    for i in $(seq 1 12); do
        if ! kill -0 $CLI_PID 2>/dev/null; then break; fi
        sleep 5
    done
    if kill -0 $CLI_PID 2>/dev/null; then
        log "CLI sync timed out (60s), killing — main deploy continues"
        kill $CLI_PID 2>/dev/null; wait $CLI_PID 2>/dev/null
    else
        wait $CLI_PID && log "CLI synced" || log "CLI sync failed (non-fatal)"
    fi
fi

# Reset Telegram getUpdates state (prevent 409 Conflict from stale long-poll)
if [ -f "$DEPLOY_DIR/.env" ]; then
    TG_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$DEPLOY_DIR/.env" | cut -d= -f2 | tr -d '"'"'" | tr -d ' ')
    if [ -n "$TG_TOKEN" ]; then
        curl -sf -X POST "https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook" > /dev/null 2>&1 && log "Telegram state reset"
    fi
fi

# ── Phase 4: Start + Health Check ──

log "Starting service..."
node "$DEPLOY_DIR/dist/cli.js" up -d

log "Running health check..."
HEALTH_OK=false
for i in $(seq 1 6); do
    sleep 5
    if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    log "Health check attempt $i/6 — waiting..."
done

if [ "$HEALTH_OK" = true ]; then
    log "Deployment successful"
    exit 0
else
    log "Health check failed after 30s"
    tail -20 "$HOME/.mini-agent/instances/*/logs/server.log" >> "$LOG_FILE" 2>/dev/null || true
    exit 1
fi
