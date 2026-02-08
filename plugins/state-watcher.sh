#!/bin/bash
# State Watcher — 偵測環境狀態變化
# 比對當前狀態 vs 上次快照，回報差異
# stdout 會被包在 <state-changes>...</state-changes> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MEMORY_DIR="${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}"
SNAPSHOT_FILE="$MEMORY_DIR/.state-snapshot.json"

# ─── 收集當前狀態 ─────────────────────────────
collect_state() {
    local state="{"

    # Docker 狀態
    if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        local containers=$(docker ps --format '{{.Names}}:{{.Status}}' 2>/dev/null | sort | tr '\n' ',' | sed 's/,$//')
        state="$state\"docker\":\"$containers\","
    else
        state="$state\"docker\":\"unavailable\","
    fi

    # 關鍵端口
    local ports=""
    for port in 3001 9222 3000 5173 8080; do
        if lsof -i :$port -sTCP:LISTEN &>/dev/null 2>&1; then
            ports="${ports}${port}:open,"
        fi
    done
    ports="${ports%,}"
    state="$state\"ports\":\"$ports\","

    # Git 狀態
    if [ -d "$PROJECT_DIR/.git" ]; then
        local branch=$(cd "$PROJECT_DIR" && git branch --show-current 2>/dev/null)
        local dirty=$(cd "$PROJECT_DIR" && git status --short 2>/dev/null | wc -l | tr -d ' ')
        state="$state\"git\":\"$branch:$dirty\","
    fi

    # 磁碟使用
    local disk_pct=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
    state="$state\"disk\":\"$disk_pct\","

    # 記憶體使用（macOS 簡化版）
    local mem_pressure="normal"
    if command -v memory_pressure &>/dev/null; then
        mem_pressure=$(memory_pressure 2>/dev/null | head -1 | awk '{print $NF}' || echo "unknown")
    fi
    state="$state\"memory\":\"${mem_pressure}\""

    state="$state}"
    echo "$state"
}

# ─── 比較狀態 ─────────────────────────────────
current=$(collect_state)

if [ ! -f "$SNAPSHOT_FILE" ]; then
    # 第一次執行，建立快照
    echo "$current" > "$SNAPSHOT_FILE"
    echo "=== First Run ==="
    echo "Snapshot created. Will detect changes on next run."
    exit 0
fi

previous=$(cat "$SNAPSHOT_FILE" 2>/dev/null)

# 更新快照
echo "$current" > "$SNAPSHOT_FILE"

# 簡單比較
if [ "$current" = "$previous" ]; then
    echo "No changes since last check."
    exit 0
fi

echo "=== Changes Detected ==="

# 逐欄位比較（簡單 shell 解析）
extract_field() {
    echo "$1" | sed "s/.*\"$2\":\"//;s/\".*//"
}

# Docker
prev_docker=$(extract_field "$previous" "docker")
curr_docker=$(extract_field "$current" "docker")
if [ "$prev_docker" != "$curr_docker" ]; then
    echo "Docker: $prev_docker → $curr_docker"
    if [ "$curr_docker" = "unavailable" ] && [ "$prev_docker" != "unavailable" ]; then
        echo "  ⚠️ ALERT: Docker became unavailable!"
    fi
fi

# Ports
prev_ports=$(extract_field "$previous" "ports")
curr_ports=$(extract_field "$current" "ports")
if [ "$prev_ports" != "$curr_ports" ]; then
    echo "Ports: $prev_ports → $curr_ports"
    # 檢查關鍵端口消失
    for port in 3001 3000; do
        if echo "$prev_ports" | grep -q "$port:open" && ! echo "$curr_ports" | grep -q "$port:open"; then
            echo "  ⚠️ ALERT: Port $port went down!"
        fi
    done
fi

# Git
prev_git=$(extract_field "$previous" "git")
curr_git=$(extract_field "$current" "git")
if [ "$prev_git" != "$curr_git" ]; then
    echo "Git: $prev_git → $curr_git"
fi

# Disk
prev_disk=$(extract_field "$previous" "disk")
curr_disk=$(extract_field "$current" "disk")
if [ "$prev_disk" != "$curr_disk" ]; then
    echo "Disk: ${prev_disk}% → ${curr_disk}%"
    if [ -n "$curr_disk" ] && [ "$curr_disk" -gt 90 ] 2>/dev/null; then
        echo "  ⚠️ ALERT: Disk usage above 90%!"
    fi
fi
