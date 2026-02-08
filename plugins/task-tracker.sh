#!/bin/bash
# Task Tracker — 追蹤未完成項目
# 掃描 HEARTBEAT.md、MEMORY.md、專案中的 TODO，回報進行中和待處理項目
# stdout 會被包在 <tasks>...</tasks> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MEMORY_DIR="${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}"

# ─── HEARTBEAT.md（任務清單）───────────────────
HEARTBEAT="$MEMORY_DIR/HEARTBEAT.md"
if [ -f "$HEARTBEAT" ]; then
    pending=$(grep -c '^\s*- \[ \]' "$HEARTBEAT" 2>/dev/null | tr -d '[:space:]' || echo 0)
    completed=$(grep -c '^\s*- \[x\]' "$HEARTBEAT" 2>/dev/null | tr -d '[:space:]' || echo 0)

    # 優先級分佈
    p0=$(grep -c '^\s*- \[ \].*P0' "$HEARTBEAT" 2>/dev/null | tr -d '[:space:]' || echo 0)
    p1=$(grep -c '^\s*- \[ \].*P1' "$HEARTBEAT" 2>/dev/null | tr -d '[:space:]' || echo 0)

    echo "=== HEARTBEAT ==="
    echo "pending: $pending (P0:$p0 P1:$p1) | completed: $completed"

    # 檢查逾期任務
    today=$(date +%Y-%m-%d)
    overdue=$(grep '^\s*- \[ \].*@due:' "$HEARTBEAT" 2>/dev/null | while read -r line; do
        due=$(echo "$line" | sed 's/.*@due:\([0-9-]*\).*/\1/')
        if [ "$due" \< "$today" ] || [ "$due" = "$today" ]; then
            echo "$line"
        fi
    done)
    if [ -n "$overdue" ]; then
        echo ""
        echo "--- ⚠️ OVERDUE ---"
        echo "$overdue" | head -5 | sed 's/^\s*- \[ \] /  /' | sed 's/\s*<!--.*-->//'
    fi

    # 列出未完成項目（按優先級排序：P0 先）
    if [ "$pending" -gt 0 ]; then
        echo ""
        echo "--- Pending ---"
        # P0 先
        grep '^\s*- \[ \].*P0' "$HEARTBEAT" 2>/dev/null | head -3 | sed 's/^\s*- \[ \] /  /' | sed 's/\s*<!--.*-->//'
        # P1 次之
        grep '^\s*- \[ \].*P1' "$HEARTBEAT" 2>/dev/null | head -3 | sed 's/^\s*- \[ \] /  /' | sed 's/\s*<!--.*-->//'
        # 其他
        grep '^\s*- \[ \]' "$HEARTBEAT" 2>/dev/null | grep -v 'P[01]' | head -3 | sed 's/^\s*- \[ \] /  /' | sed 's/\s*<!--.*-->//'
    fi
fi

# ─── TODO 掃描（src/ 目錄）──────────────────────
if [ -d "$PROJECT_DIR/src" ]; then
    todo_count=$(grep -r 'TODO\|FIXME\|HACK\|XXX' "$PROJECT_DIR/src/" --include="*.ts" -c 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')
    if [ "$todo_count" -gt 0 ]; then
        echo ""
        echo "=== Code TODOs: $todo_count ==="
        grep -rn 'TODO\|FIXME\|HACK\|XXX' "$PROJECT_DIR/src/" --include="*.ts" 2>/dev/null | head -5 | sed 's|.*/src/|src/|' | sed 's/^\(.\{100\}\).*/\1.../'
    fi
fi

# ─── Git 未提交變更 ──────────────────────────────
if [ -d "$PROJECT_DIR/.git" ]; then
    changes=$(cd "$PROJECT_DIR" && git status --short 2>/dev/null | wc -l | tr -d ' ')
    if [ "$changes" -gt 0 ]; then
        echo ""
        echo "=== Git: $changes uncommitted changes ==="
        cd "$PROJECT_DIR" && git status --short 2>/dev/null | head -5
    fi
fi

# ─── 最近日誌中的錯誤 ────────────────────────────
LOG_DIR="$MEMORY_DIR/../logs"
if [ -d "$LOG_DIR" ]; then
    recent_errors=$(find "$LOG_DIR" -name "*.log" -newer "$LOG_DIR" -mmin -60 2>/dev/null | xargs grep -l "error\|Error\|ERROR" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$recent_errors" -gt 0 ]; then
        echo ""
        echo "=== Recent errors in $recent_errors log files ==="
    fi
fi
