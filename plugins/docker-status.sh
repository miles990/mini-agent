#!/bin/bash
# Docker 容器狀態感知
# stdout 會被包在 <docker>...</docker> 中注入 Agent context

if ! command -v docker &>/dev/null; then
  echo "Docker not installed"
  exit 0
fi

if ! docker info &>/dev/null 2>&1; then
  echo "Docker daemon not running"
  exit 0
fi

echo "=== Containers ==="
docker ps --format "{{.Names}}: {{.Status}} ({{.Image}})" 2>/dev/null

STOPPED=$(docker ps -f status=exited --format "{{.Names}}: Exited ({{.Image}})" 2>/dev/null)
if [ -n "$STOPPED" ]; then
  echo ""
  echo "=== Stopped ==="
  echo "$STOPPED"
fi

echo ""
echo "=== Resources ==="
docker system df --format "Type: {{.Type}}, Size: {{.Size}}, Reclaimable: {{.Reclaimable}}" 2>/dev/null
