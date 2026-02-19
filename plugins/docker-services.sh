#!/bin/bash
# Docker Services Perception Plugin
# Shows status of Kuro's Docker capability services

echo "=== Docker Services ==="

# Check Docker availability
if ! docker info &>/dev/null; then
  echo "Docker: UNAVAILABLE"
  exit 0
fi

# Check each service
check_service() {
  local name=$1
  local port=$2
  local health_url=$3

  local status=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null)
  if [ -z "$status" ]; then
    echo "$name: NOT DEPLOYED"
    return
  fi

  if [ "$status" != "running" ]; then
    echo "$name: $status"
    return
  fi

  # Check health endpoint
  if [ -n "$health_url" ]; then
    local http_code=$(curl -sf -o /dev/null -w '%{http_code}' --connect-timeout 2 "$health_url" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
      echo "$name: UP (port $port)"
    else
      echo "$name: RUNNING but unhealthy (HTTP $http_code)"
    fi
  else
    echo "$name: RUNNING (port $port)"
  fi
}

# Phase 1: SearXNG
check_service "kuro-searxng" "8888" "http://localhost:8888/healthz"

# Phase 2: Ollama (planned)
check_service "kuro-ollama" "11434" "http://localhost:11434/api/tags"

# Phase 3: Whisper (planned)
check_service "kuro-whisper" "9000" ""

# Summary
running=$(docker ps --filter "name=kuro-" --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Active: $running service(s)"
