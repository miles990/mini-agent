#!/bin/bash
# Port 檢查 — 只監控實際使用中的服務
# 原則：看得精準比看得多重要

check_port() {
  local name=$1
  local port=$2
  if lsof -i :$port -sTCP:LISTEN &>/dev/null 2>&1; then
    local proc=$(lsof -i :$port -sTCP:LISTEN -t 2>/dev/null | head -1)
    local pname=$(ps -p "$proc" -o comm= 2>/dev/null)
    echo "$name (:$port): UP ($pname, pid:$proc)"
  else
    echo "$name (:$port): DOWN"
  fi
}

# 核心服務
check_port "Self"        3001
check_port "Chrome CDP"  9222

# 開發服務（有在用才顯示）
for entry in "Node Dev:3000" "Vite:5173" "HTTP:80" "HTTPS:443"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  if lsof -i :$port -sTCP:LISTEN &>/dev/null 2>&1; then
    check_port "$name" "$port"
  fi
done
