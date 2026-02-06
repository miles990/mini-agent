#!/bin/bash
# 常用服務 Port 檢查
# 快速確認本機服務是否運行

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

check_port "HTTP"       80
check_port "HTTPS"      443
check_port "PostgreSQL"  5432
check_port "MySQL"       3306
check_port "Redis"       6379
check_port "MongoDB"     27017
check_port "Node Dev"    3000
check_port "Vite"        5173
check_port "SSH"         22
