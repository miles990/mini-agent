#!/bin/bash
# GitHub PRs Perception — 追蹤 open PRs + CI/review 狀態
# stdout 會被包在 <github-prs>...</github-prs> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="${TMPDIR:-/tmp}/mini-agent-github-prs.cache"
CACHE_TTL=60  # seconds

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

# ─── 取得 open PRs ───
cd "$PROJECT_DIR" || exit 0

output=""

prs=$(gh pr list --state open --json number,title,author,reviewDecision,statusCheckRollup,createdAt,headRefName --limit 20 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$prs" ] || [ "$prs" = "[]" ]; then
  output="No open PRs"
  echo "$output" > "$CACHE_FILE"
  echo "$output"
  exit 0
fi

count=$(echo "$prs" | jq 'length')
output="=== Open PRs: $count ==="

# ─── 逐一顯示 PR 狀態 ───
pr_details=$(echo "$prs" | jq -r '
  .[] |
  # CI 狀態
  (if (.statusCheckRollup | length) == 0 then "no-ci"
   elif [.statusCheckRollup[] | select(.conclusion == "FAILURE")] | length > 0 then "CI-FAIL"
   elif [.statusCheckRollup[] | select(.status == "IN_PROGRESS" or .status == "QUEUED")] | length > 0 then "CI-PENDING"
   elif [.statusCheckRollup[] | select(.conclusion == "SUCCESS")] | length == (.statusCheckRollup | length) then "CI-PASS"
   else "CI-UNKNOWN" end) as $ci |
  # Review 狀態
  (if .reviewDecision == "APPROVED" then "APPROVED"
   elif .reviewDecision == "CHANGES_REQUESTED" then "CHANGES-REQ"
   elif .reviewDecision == "REVIEW_REQUIRED" then "NEEDS-REVIEW"
   else "no-review" end) as $review |
  # READY-TO-MERGE 標記
  (if $ci == "CI-PASS" and $review == "APPROVED" then " ★ READY-TO-MERGE"
   else "" end) as $ready |
  "  #\(.number) \(.title) [\($ci)] [\($review)]\($ready)"
')
if [ -n "$pr_details" ]; then
  output="$output
$pr_details"
fi

# ─── 最近 24h merged PRs ───
merged=$(gh pr list --state merged --json number,title,mergedAt --limit 5 2>/dev/null | jq -r '
  [.[] | select(
    (.mergedAt | split("T")[0]) >= (now - 86400 | strftime("%Y-%m-%d"))
  )] |
  if length > 0 then
    "\n--- Merged (24h) ---",
    (.[] | "  #\(.number) \(.title) (merged \(.mergedAt | split("T")[0]))")
  else empty end
')
if [ -n "$merged" ]; then
  output="$output
$merged"
fi

# ─── 輸出 + 寫入 cache ───
echo "$output" > "$CACHE_FILE"
echo "$output"
