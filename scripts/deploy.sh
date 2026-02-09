#!/bin/bash
# deploy.sh — Stop → install → build → start via launchd → health check
set -e

DEPLOY_DIR="/Users/user/Workspace/mini-agent"
LOG_FILE="$HOME/.mini-agent/deploy.log"

mkdir -p "$HOME/.mini-agent"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$DEPLOY_DIR"

log "Starting deployment..."

# Stop — 同時處理新舊機制
log "Stopping existing service..."
# 卸載所有 com.mini-agent.* launchd services（新機制）
for plist in "$HOME/Library/LaunchAgents"/com.mini-agent.*.plist; do
    [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null && rm -f "$plist"
done
# 卸載舊的固定 plist（遷移期）
if [ -f "$HOME/Library/LaunchAgents/com.mini-agent.plist" ]; then
    launchctl unload "$HOME/Library/LaunchAgents/com.mini-agent.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.mini-agent.plist"
fi
# Kill any stray mini-agent processes
pkill -f "node.*mini-agent.*dist/api.js" 2>/dev/null || true
sleep 2

# Ensure port is free
PORT_PID=$(lsof -ti :3001 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
    log "Port 3001 still in use (PID $PORT_PID), force killing..."
    kill -9 $PORT_PID 2>/dev/null || true
    sleep 1
fi

# Install dependencies
log "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Build
log "Building..."
pnpm build

# Start — 用 CLI（內部走 launchd）
log "Starting service..."
node "$DEPLOY_DIR/dist/cli.js" up -d

# Health check
log "Running health check..."
sleep 3
if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    log "Deployment successful"
    exit 0
else
    log "Health check failed"
    tail -20 "$HOME/.mini-agent/instances/*/logs/server.log" >> "$LOG_FILE" 2>/dev/null || true
    exit 1
fi
