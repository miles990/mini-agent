#!/bin/bash
# Git 倉庫狀態感知（當前目錄）
# 比內建 workspace 更詳細的 Git 資訊

if ! git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  echo "Not a git repository"
  exit 0
fi

BRANCH=$(git branch --show-current 2>/dev/null)
REMOTE=$(git remote -v 2>/dev/null | head -1 | awk '{print $2}')
LAST_COMMIT=$(git log -1 --format="%h %s (%ar)" 2>/dev/null)
UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
STASH_COUNT=$(git stash list 2>/dev/null | wc -l | tr -d ' ')

echo "Branch: $BRANCH"
echo "Remote: $REMOTE"
echo "Last commit: $LAST_COMMIT"
echo "Uncommitted files: $UNCOMMITTED"
echo "Stashes: $STASH_COUNT"

# 顯示未推送的 commits
UNPUSHED=$(git log @{u}.. --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED" -gt 0 ] 2>/dev/null; then
  echo "Unpushed commits: $UNPUSHED"
fi
