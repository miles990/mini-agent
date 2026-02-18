#!/bin/bash
# Self-Awareness — 內部狀態感知
# 追蹤學習進度、行為模式、記憶健康
# stdout 會被包在 <self-awareness>...</self-awareness> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MEMORY_DIR="${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}"
TOPICS_DIR="$MEMORY_DIR/topics"
INSTANCE_ID="${MINI_AGENT_INSTANCE:-unknown}"
BEHAVIOR_LOG="$HOME/.mini-agent/instances/$INSTANCE_ID/logs/behavior/$(date +%Y-%m-%d).jsonl"

TODAY=$(date +%Y-%m-%d)

# ─── Learning Pulse（學習脈搏）─────────────────────
echo "=== Learning Pulse ==="

if [ -d "$TOPICS_DIR" ]; then
    # 列出每個 topic 的最後更新日期
    topics_info=""
    stale=""
    total_entries=0

    for f in "$TOPICS_DIR"/*.md; do
        [ -f "$f" ] || continue
        name=$(basename "$f" .md)
        # 找最新的日期 — 支援 (YYYY-MM-DD)、[YYYY-MM-DD] 和全形括號
        last_date=$(grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$f" 2>/dev/null | sort -r | head -1)
        entries=$(grep -c '^\s*-\s' "$f" 2>/dev/null | tr -d '[:space:]')
        entries=${entries:-0}
        total_entries=$((total_entries + entries))

        if [ -n "$last_date" ]; then
            # 簡化日期顯示（只顯示月/日）
            short_date=$(echo "$last_date" | sed 's/^20[0-9][0-9]-//')
            topics_info="${topics_info}${name}(${short_date}), "

            # 檢查是否 idle（>3 天未更新）
            if command -v python3 &>/dev/null; then
                days_ago=$(python3 -c "from datetime import date; d=(date.fromisoformat('$TODAY')-date.fromisoformat('$last_date')).days; print(d)" 2>/dev/null)
                if [ -n "$days_ago" ] && [ "$days_ago" -gt 3 ]; then
                    # 取最後一條記錄的標題（第一個 — 之前的文字）
                    last_entry=$(grep '^\s*-\s' "$f" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*-[[:space:]]*//' | sed 's/ —.*//' | head -c 30)
                    stale="${stale}${name}(${days_ago}d, last: ${last_entry}), "
                fi
            fi
        else
            topics_info="${topics_info}${name}(no date), "
        fi
    done

    # 移除尾部逗號
    topics_info="${topics_info%, }"
    stale="${stale%, }"

    echo "Topics: $topics_info"
    echo "Total entries: $total_entries"
    if [ -n "$stale" ]; then
        echo "Idle (>3d): $stale"
    fi
fi

# ─── Behavior Rhythm（行為節奏）─────────────────────
echo ""
echo "=== Behavior Rhythm ==="

if [ -f "$BEHAVIOR_LOG" ]; then
    # 從 behavior log 提取 L/A 序列
    # Learn = memory.save, memory.save.topic
    # Action = action.autonomous, action.task, telegram.chat (通知=行動的一部分)
    pattern=""
    learn_count=0
    action_count=0

    while IFS= read -r line; do
        action=$(echo "$line" | sed 's/.*"action":"\([^"]*\)".*/\1/' 2>/dev/null)
        case "$action" in
            memory.save|memory.save.topic)
                pattern="${pattern}L"
                learn_count=$((learn_count + 1))
                ;;
            action.autonomous|action.task)
                pattern="${pattern}A"
                action_count=$((action_count + 1))
                ;;
        esac
    done < "$BEHAVIOR_LOG"

    # 只顯示最近 8 個
    recent=$(echo "$pattern" | grep -oE '.' | tail -8 | tr -d '\n')

    # 計算當前連續 streak
    streak_type=""
    streak_count=0
    for ((i=${#pattern}-1; i>=0; i--)); do
        char="${pattern:$i:1}"
        if [ -z "$streak_type" ]; then
            streak_type="$char"
            streak_count=1
        elif [ "$char" = "$streak_type" ]; then
            streak_count=$((streak_count + 1))
        else
            break
        fi
    done

    if [ -z "$recent" ]; then
        echo "No learn/action events today"
    else
        echo "Recent: $recent  (L=learn, A=action)"
        echo "Today: ${learn_count}L ${action_count}A"
        if [ -n "$streak_type" ]; then
            label="learn"
            [ "$streak_type" = "A" ] && label="action"
            echo "Current streak: $streak_count $label"
            if [ "$streak_type" = "L" ] && [ "$streak_count" -ge 3 ]; then
                echo "⚠ Do an L1 action (improve a skill, plugin, or doc)"
            fi
        fi
    fi
else
    # 也檢查昨天的 log
    yesterday_log="$HOME/.mini-agent/instances/$INSTANCE_ID/logs/behavior/$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d 2>/dev/null).jsonl"
    if [ -f "$yesterday_log" ]; then
        echo "No events today yet (yesterday's log exists)"
    else
        echo "No behavior log found"
    fi
fi

# ─── Memory Health（記憶健康）─────────────────────
echo ""
echo "=== Memory Health ==="

if [ -d "$TOPICS_DIR" ]; then
    file_count=$(ls "$TOPICS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
    echo "Topic files: $file_count"

    # 找最大的 topic
    largest=""
    largest_count=0
    for f in "$TOPICS_DIR"/*.md; do
        [ -f "$f" ] || continue
        name=$(basename "$f" .md)
        count=$(grep -c '^\s*-\s' "$f" 2>/dev/null | tr -d '[:space:]')
        count=${count:-0}
        if [ "$count" -gt "$largest_count" ]; then
            largest="$name"
            largest_count="$count"
        fi
    done
    [ -n "$largest" ] && echo "Largest: $largest ($largest_count entries)"

    # 檢查重複（同一 topic 內有完全相同的行）
    dupes=0
    for f in "$TOPICS_DIR"/*.md; do
        [ -f "$f" ] || continue
        d=$(grep '^\s*-\s' "$f" 2>/dev/null | sort | uniq -d | wc -l | tr -d ' ')
        dupes=$((dupes + d))
    done
    echo "Duplicates: $dupes detected"
fi

# MEMORY.md 大小
MEMORY_FILE="$MEMORY_DIR/MEMORY.md"
if [ -f "$MEMORY_FILE" ]; then
    mem_lines=$(wc -l < "$MEMORY_FILE" | tr -d ' ')
    mem_entries=$(grep -c '^\s*-\s' "$MEMORY_FILE" 2>/dev/null | tr -d '[:space:]')
    mem_entries=${mem_entries:-0}
    echo "MEMORY.md: $mem_lines lines, $mem_entries entries"
fi

# ─── Topic Utility（主題引用追蹤）─────────────────────
echo ""
echo "=== Topic Utility ==="

HITS_FILE="$MEMORY_DIR/.topic-hits.json"
if [ -f "$HITS_FILE" ]; then
    # 統計 top 5 和 bottom 5
    total_hits=$(python3 -c "
import json, sys
try:
    with open('$HITS_FILE') as f:
        data = json.load(f)
    items = sorted(data.items(), key=lambda x: -x[1])
    total = sum(v for v in data.values())
    print(f'Total hits: {total}')
    if items:
        top = ', '.join(f'{k}({v})' for k,v in items[:5])
        print(f'Top: {top}')
        zero = [k for k,v in items if v == 0]
        if zero:
            print(f'Never cited: {len(zero)} entries')
except Exception as e:
    print(f'Error reading hits: {e}')
" 2>/dev/null)
    echo "$total_hits"
else
    echo "No hit data yet (create $HITS_FILE to start tracking)"
fi

# ─── Perception Signal（感知信號影響追蹤）─────────────────────
echo ""
echo "=== Perception Signal ==="

if [ -f "$BEHAVIOR_LOG" ]; then
    # 從 behavior log 的 action detail 提取 <section> 引用
    sections_cited=$(grep -oE '<[a-z-]+>' "$BEHAVIOR_LOG" 2>/dev/null | sort | uniq -c | sort -rn | head -10)
    if [ -n "$sections_cited" ]; then
        # 格式化輸出
        influential=""
        while IFS= read -r line; do
            count=$(echo "$line" | awk '{print $1}')
            section=$(echo "$line" | awk '{print $2}' | tr -d '<>')
            # 排除 closing tags 和非 perception sections
            case "$section" in
                /*)  continue ;;
                environment|self|capabilities|process|config|memory|recent_conversations|heartbeat|soul) continue ;;
            esac
            influential="${influential}${section}(${count}), "
        done <<< "$sections_cited"
        influential="${influential%, }"
        if [ -n "$influential" ]; then
            echo "Cited in actions: $influential"
        else
            echo "No perception sections cited in today's actions"
        fi
    else
        echo "No perception sections cited in today's actions"
    fi
else
    echo "No behavior log for signal tracking"
fi

# ─── Context Health（Context 大小趨勢 + Section Breakdown）─────────────────────
echo ""
echo "=== Context Health ==="

CHECKPOINT_DIR="$HOME/.mini-agent/instances/$INSTANCE_ID/context-checkpoints"
if [ -d "$CHECKPOINT_DIR" ]; then
    # 讀取最近 20 個 checkpoint 的 contextLength
    recent_sizes=$(cat "$CHECKPOINT_DIR"/*.jsonl 2>/dev/null | tail -20 | grep -oE '"contextLength":[0-9]+' | sed 's/"contextLength"://')
    if [ -n "$recent_sizes" ]; then
        count=$(echo "$recent_sizes" | wc -l | tr -d ' ')
        avg=$(echo "$recent_sizes" | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
        latest=$(echo "$recent_sizes" | tail -1)
        first=$(echo "$recent_sizes" | head -1)

        # Approximate token estimate (4 chars ≈ 1 token)
        latest_tokens=$((latest / 4))

        # 趨勢判斷：比較前 5 和後 5 的平均
        if [ "$count" -ge 10 ]; then
            first5_avg=$(echo "$recent_sizes" | head -5 | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
            last5_avg=$(echo "$recent_sizes" | tail -5 | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
            if [ "$last5_avg" -gt "$((first5_avg * 110 / 100))" ]; then
                trend="growing"
            elif [ "$last5_avg" -lt "$((first5_avg * 90 / 100))" ]; then
                trend="shrinking"
            else
                trend="stable"
            fi
        else
            trend="insufficient data"
        fi

        echo "Recent ($count checkpoints): avg=${avg} chars, latest=${latest}"
        echo "Approx tokens: ~${latest_tokens} (~$((latest_tokens * 100 / 200000))% of 200K window)"
        echo "Trend: $trend"
        if [ "$trend" = "growing" ]; then
            echo "Warning: Context size growing >10%"
        fi

        # Section breakdown from latest checkpoint (pipe JSON via stdin for safety)
        section_breakdown=$(cat "$CHECKPOINT_DIR"/*.jsonl 2>/dev/null | tail -1 | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    sections = data.get('sections', [])
    if sections:
        sections.sort(key=lambda x: -x['chars'])
        total = sum(s['chars'] for s in sections)
        parts = []
        for s in sections[:5]:
            pct = s['chars'] * 100 // total
            parts.append(f\"{s['name']}({pct}%)\")
        print('Top sections: ' + ', '.join(parts))
except:
    pass
" 2>/dev/null)
        [ -n "$section_breakdown" ] && echo "$section_breakdown"
    else
        echo "No checkpoint data"
    fi
else
    echo "No checkpoint directory"
fi
