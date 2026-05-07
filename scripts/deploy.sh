#!/bin/bash
# deploy.sh — Build-before-Stop: build first, only stop+restart on success
# This prevents the scenario where build fails after Kuro is already stopped,
# leaving the service dead with no recovery.
set -e

DEPLOY_DIR="/Users/user/Workspace/mini-agent"
LOG_FILE="$HOME/.mini-agent/deploy.log"
LOCK_DIR="$HOME/.mini-agent/deploy.lock"
JANITOR_LOCK_DIR="$HOME/.mini-agent/workspace-janitor.lock"
DEFAULT_MEMORY_DIR="$(dirname "$DEPLOY_DIR")/mini-agent-memory/memory"
DEPLOY_LOCK_WAIT_SECONDS="${MINI_AGENT_DEPLOY_LOCK_WAIT_SECONDS:-90}"
DEPLOY_LOCK_TERM_GRACE_SECONDS="${MINI_AGENT_DEPLOY_LOCK_TERM_GRACE_SECONDS:-30}"
WORKSPACE_JANITOR_TIMEOUT_SECONDS="${MINI_AGENT_WORKSPACE_JANITOR_TIMEOUT_SECONDS:-60}"
LOCK_HELD=0

mkdir -p "$HOME/.mini-agent"
mkdir -p "$DEFAULT_MEMORY_DIR"
export MINI_AGENT_MEMORY_DIR="${MINI_AGENT_MEMORY_DIR:-$DEFAULT_MEMORY_DIR}"
export MINI_AGENT_MEMORY="${MINI_AGENT_MEMORY:-$MINI_AGENT_MEMORY_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

is_deploy_process() {
    ps -p "$1" -o command= 2>/dev/null | grep -q 'scripts/deploy\.sh'
}

release_lock() {
    if [ "$LOCK_HELD" = "1" ] && [ -d "$LOCK_DIR" ]; then
        CURRENT_LOCK_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
        if [ "$CURRENT_LOCK_PID" = "$$" ]; then
            rm -rf "$LOCK_DIR"
        fi
        LOCK_HELD=0
    fi
}

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_DIR/pid"
        LOCK_HELD=1
        trap release_lock EXIT
        return 0
    fi

    LOCK_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
        if ! is_deploy_process "$LOCK_PID"; then
            log "Deploy lock PID $LOCK_PID is alive but not deploy.sh; removing stale lock"
            rm -rf "$LOCK_DIR"
        else
            log "Another deploy is already running (PID $LOCK_PID); waiting up to ${DEPLOY_LOCK_WAIT_SECONDS}s"
            for _ in $(seq 1 "$DEPLOY_LOCK_WAIT_SECONDS"); do
                if ! kill -0 "$LOCK_PID" 2>/dev/null; then
                    log "Previous deploy PID $LOCK_PID exited; taking over lock"
                    rm -rf "$LOCK_DIR"
                    break
                fi
                sleep 1
            done

            if [ -d "$LOCK_DIR" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
                log "Previous deploy PID $LOCK_PID still running; requesting graceful shutdown"
                kill -TERM "$LOCK_PID" 2>/dev/null || true
                for _ in $(seq 1 "$DEPLOY_LOCK_TERM_GRACE_SECONDS"); do
                    if ! kill -0 "$LOCK_PID" 2>/dev/null; then
                        log "Previous deploy PID $LOCK_PID exited after TERM; taking over lock"
                        rm -rf "$LOCK_DIR"
                        break
                    fi
                    sleep 1
                done
            fi

            if [ -d "$LOCK_DIR" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
                log "Previous deploy PID $LOCK_PID ignored TERM; force killing before new deploy"
                kill -KILL "$LOCK_PID" 2>/dev/null || true
                sleep 1
                rm -rf "$LOCK_DIR"
            fi
        fi
    else
        log "Removing stale deploy lock"
        rm -rf "$LOCK_DIR"
    fi

    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_DIR/pid"
        LOCK_HELD=1
        trap release_lock EXIT
        return 0
    fi

    log "Could not acquire deploy lock; aborting"
    exit 1
}

run_workspace_janitor() {
    if mkdir "$JANITOR_LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$JANITOR_LOCK_DIR/pid"
    else
        JANITOR_LOCK_PID=$(cat "$JANITOR_LOCK_DIR/pid" 2>/dev/null || true)
        if [ -n "$JANITOR_LOCK_PID" ] && kill -0 "$JANITOR_LOCK_PID" 2>/dev/null; then
            log "Skipping workspace janitor because another janitor is running (PID $JANITOR_LOCK_PID)"
            return 0
        fi
        log "Removing stale workspace janitor lock"
        rm -rf "$JANITOR_LOCK_DIR"
        if ! mkdir "$JANITOR_LOCK_DIR" 2>/dev/null; then
            log "Skipping workspace janitor; could not acquire janitor lock"
            return 0
        fi
        echo "$$" > "$JANITOR_LOCK_DIR/pid"
    fi

    log "Running workspace janitor..."
    (
        pnpm exec tsx scripts/workspace-janitor.ts --apply >> "$LOG_FILE" 2>&1
    ) &
    JANITOR_PID=$!
    for _ in $(seq 1 "$WORKSPACE_JANITOR_TIMEOUT_SECONDS"); do
        if ! kill -0 "$JANITOR_PID" 2>/dev/null; then break; fi
        sleep 1
    done
    if kill -0 "$JANITOR_PID" 2>/dev/null; then
        log "Workspace janitor timed out after ${WORKSPACE_JANITOR_TIMEOUT_SECONDS}s; terminating (non-fatal)"
        kill -TERM "$JANITOR_PID" 2>/dev/null || true
        wait "$JANITOR_PID" 2>/dev/null || true
        log "Workspace janitor failed (non-fatal)"
    elif wait "$JANITOR_PID"; then
        log "Workspace janitor completed"
    else
        log "Workspace janitor failed (non-fatal)"
    fi
    rm -rf "$JANITOR_LOCK_DIR"
}

cd "$DEPLOY_DIR"

acquire_lock

log "Starting deployment..."

# ── Phase 1: Pull + Install + Build (Kuro still running) ──

log "Pulling latest code..."
if [ "${MINI_AGENT_SKIP_DEPLOY_PULL:-0}" = "1" ]; then
    log "Skipping git pull; caller already synced deploy checkout"
elif ! git pull origin main; then
    log "git pull failed; aborting deploy before build/stop"
    exit 1
fi

if ! pnpm exec tsx scripts/check-conflicts.ts; then
    log "Unresolved git conflicts detected; aborting deploy before build/stop"
    log "For append-only memory conflicts, run: pnpm exec tsx scripts/check-conflicts.ts --resolve-append-only"
    exit 1
fi

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
    if curl -sf http://127.0.0.1:3001/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    log "Health check attempt $i/6 — waiting..."
done

if [ "$HEALTH_OK" = true ]; then
    log "Deployment successful"
    log "Releasing deploy lock before non-critical workspace janitor"
    release_lock
    if [ "${MINI_AGENT_SKIP_WORKSPACE_JANITOR:-0}" = "1" ]; then
        log "Skipping workspace janitor"
    elif [ "$(git branch --show-current 2>/dev/null)" != "runtime/main" ]; then
        log "Skipping workspace janitor because deploy checkout is not on runtime/main"
    elif git status --porcelain | grep -q '^UU '; then
        log "Skipping workspace janitor because deploy checkout has unresolved conflicts"
    else
        run_workspace_janitor
    fi
    exit 0
else
    log "Health check failed after 30s"
    tail -20 "$HOME/.mini-agent/instances/*/logs/server.log" >> "$LOG_FILE" 2>/dev/null || true
    exit 1
fi
