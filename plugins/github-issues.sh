#!/bin/bash
# GitHub Issues Perception — 追蹤 open issues
# stdout 會被包在 <github-issues>...</github-issues> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MEMORY_DIR="${MINI_AGENT_MEMORY_DIR:-${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}}"
CACHE_FILE="${TMPDIR:-/tmp}/mini-agent-github-issues.cache"
CACHE_TTL=60  # seconds
mkdir -p "$(dirname "$CACHE_FILE")" 2>/dev/null || true

# ─── gh CLI 可用性檢查 ───
if ! command -v gh &>/dev/null; then
  echo "gh CLI not installed"
  exit 0
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo "gh not authenticated"
  exit 0
fi

# ─── 60s file cache guard ───
if [ -f "$CACHE_FILE" ]; then
  cache_age=$(( $(date +%s) - $(stat -f%m "$CACHE_FILE" 2>/dev/null || stat -c%Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [ "$cache_age" -lt "$CACHE_TTL" ]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# ─── 取得 open issues ───
cd "$PROJECT_DIR" || exit 0

output=""

issues=$(gh issue list --state open --json number,title,labels,assignees,createdAt --limit 20 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$issues" ] || [ "$issues" = "[]" ]; then
  output="No open issues"
  echo "$output" > "$CACHE_FILE"
  echo "$output"
  exit 0
fi

count=$(echo "$issues" | jq 'length')
output="=== Open Issues: $count ==="

# ─── Issue Autopilot：把 open issue 寫入 memory index，讓 scheduler 能接手 ───
if [ "${MINI_AGENT_GITHUB_ISSUE_AUTOPILOT:-1}" != "0" ]; then
  if [ -f "$PROJECT_DIR/dist/issue-autopilot-cli.js" ]; then
    sync_output=$(MINI_AGENT_MEMORY_DIR="$MEMORY_DIR" node "$PROJECT_DIR/dist/issue-autopilot-cli.js" --json --limit 50 2>/dev/null | sed -n '/^{/,$p')
    if [ -n "$sync_output" ]; then
      sync_summary=$(echo "$sync_output" | jq -r '"Issue Autopilot: scanned=\(.scanned) created=\(.created) updated=\(.updated) skipped=\(.skipped)"' 2>/dev/null)
      if [ -n "$sync_summary" ]; then
        output="$output
$sync_summary"
      fi
    fi
  else
    output="$output
Issue Autopilot: dist missing; run pnpm build"
  fi
fi

# ─── Needs Triage（無 assignee）───
needs_triage=$(echo "$issues" | jq -r '
  [.[] | select(.assignees | length == 0)] |
  if length > 0 then
    "\n--- Needs Triage ---",
    (.[] | "  #\(.number) \(.title) (\(.createdAt | split("T")[0]))")
  else empty end
')
if [ -n "$needs_triage" ]; then
  output="$output
$needs_triage"
fi

# ─── Assigned（有 assignee）───
assigned=$(echo "$issues" | jq -r '
  [.[] | select(.assignees | length > 0)] |
  if length > 0 then
    "\n--- Assigned ---",
    (.[] | "  #\(.number) \(.title) → \(.assignees | map(.login) | join(", "))")
  else empty end
')
if [ -n "$assigned" ]; then
  output="$output
$assigned"
fi

# ─── 最近 7 天 closed issues（確認閉環）───
recent_closed=$(gh issue list --state closed --json number,title,closedAt --limit 5 2>/dev/null | jq -r '
  [.[] | select(
    (.closedAt | split("T")[0]) >= (now - 604800 | strftime("%Y-%m-%d"))
  )] |
  if length > 0 then
    "\n--- Recently Closed (7d) ---",
    (.[] | "  #\(.number) \(.title) (closed \(.closedAt | split("T")[0]))")
  else empty end
')
if [ -n "$recent_closed" ]; then
  output="$output
$recent_closed"
fi

# ─── 輸出 + 寫入 cache ───
echo "$output" > "$CACHE_FILE"
echo "$output"
