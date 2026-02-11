#!/bin/bash
# deploy.sh — Stop → install → build → start (background) → health check
set -e

DEPLOY_DIR="/Users/user/Workspace/mini-agent"
LOG_FILE="$HOME/.mini-agent/deploy.log"

mkdir -p "$HOME/.mini-agent"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$DEPLOY_DIR"

log "Starting deployment..."

# Stop — graceful shutdown（等任務完成再退出）
log "Stopping existing service..."

# 卸載所有 com.mini-agent.* launchd services（如有殘留）
for plist in "$HOME/Library/LaunchAgents"/com.mini-agent.*.plist; do
    [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null && rm -f "$plist"
done

# 送 SIGTERM 觸發 graceful shutdown，等進程退出（最長 11 分鐘）
AGENT_PATTERN="node.*mini-agent.*dist/cli.js"
if pgrep -f "$AGENT_PATTERN" > /dev/null 2>&1; then
    pkill -f "$AGENT_PATTERN" 2>/dev/null || true
    WAIT_MAX=132  # 132 * 5s = 660s = 11min
    for i in $(seq 1 $WAIT_MAX); do
        if ! pgrep -f "$AGENT_PATTERN" > /dev/null 2>&1; then
            break
        fi
        if [ "$i" -eq 1 ]; then log "Waiting for running tasks to finish..."; fi
        sleep 5
    done

    # 只有超時才 force kill
    if pgrep -f "$AGENT_PATTERN" > /dev/null 2>&1; then
        log "Process still alive after ${WAIT_MAX}x5s, force killing..."
        pkill -9 -f "$AGENT_PATTERN" 2>/dev/null || true
        sleep 1
    fi
fi

# 確保 port 空出
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

# Sync CLI installation (~/.mini-agent)
# mini-agent CLI 全域連結指向 ~/.mini-agent，CI/CD 只更新 Workspace 副本
# 這裡同步確保 CLI 也是最新版本
CLI_DIR="$HOME/.mini-agent"
if [ -d "$CLI_DIR/.git" ]; then
    log "Syncing CLI installation ($CLI_DIR)..."
    cd "$CLI_DIR"
    git fetch origin main && git reset --hard origin/main
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm build
    cd "$DEPLOY_DIR"
    log "CLI synced"
fi

# Start — launchd plist for reliable daemon management (KeepAlive + auto-restart)
log "Starting service..."
PLIST_LABEL="com.mini-agent.kuro"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
AGENT_LOG="$HOME/.mini-agent/server.log"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>${DEPLOY_DIR}/dist/cli.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${DEPLOY_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PORT</key>
        <string>3001</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${AGENT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${AGENT_LOG}</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST

launchctl load "$PLIST_PATH"
log "launchd service loaded ($PLIST_LABEL)"

# Health check（wait up to 10s）
log "Running health check..."
for i in $(seq 1 10); do
    if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
        log "Deployment successful"
        exit 0
    fi
    sleep 1
done

log "Health check failed"
tail -20 "$AGENT_LOG" >> "$LOG_FILE" 2>/dev/null || true
exit 1
