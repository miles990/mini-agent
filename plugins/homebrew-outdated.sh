#!/bin/bash
# Homebrew 過期套件檢查（macOS）
# 讓 Agent 知道有哪些套件需要更新

if ! command -v brew &>/dev/null; then
  echo "Homebrew not installed"
  exit 0
fi

OUTDATED=$(brew outdated 2>/dev/null)
if [ -z "$OUTDATED" ]; then
  echo "All packages up to date"
else
  COUNT=$(echo "$OUTDATED" | wc -l | tr -d ' ')
  echo "$COUNT package(s) outdated:"
  echo "$OUTDATED"
fi
