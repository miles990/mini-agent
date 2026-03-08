#!/bin/bash
# Demo GIF script for Show HN
# Records a scripted terminal session showing mini-agent's perception-driven loop
# Usage: asciinema rec demo.cast -c "bash scripts/demo-gif.sh"
# Then:  agg demo.cast demo.gif --theme monokai --cols 80 --rows 24 --speed 1

set -e

# Colors
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
BLUE='\033[34m'
RESET='\033[0m'

type_cmd() {
  echo -ne "${GREEN}\$ ${RESET}"
  for ((i=0; i<${#1}; i++)); do
    echo -n "${1:$i:1}"
    sleep 0.04
  done
  echo
  sleep 0.3
}

section() {
  echo -e "\n${BOLD}${CYAN}── $1 ──────────────────────────────────${RESET}"
}

pause() { sleep "${1:-1}"; }

clear

# 1. Start (3s)
type_cmd "mini-agent up"
echo -e "${DIM}Starting mini-agent...${RESET}"
pause 0.5
echo -e "  ✓ Perception: ${BOLD}21 plugins${RESET} (workspace, docker, chrome, telegram, mobile...)"
echo -e "  ✓ Skills: ${BOLD}13 loaded${RESET} (web-research, debugging, delegation...)"
echo -e "  ✓ Memory: ${BOLD}939 entries${RESET} across 24 topics"
echo -e "  ✓ Loop: ${GREEN}autonomous${RESET} — perceiving every 30s"
pause 1.5

# 2. Perception (5s)
section "Perceive"
pause 0.3
echo -e "  ${YELLOW}<workspace>${RESET} 2 files changed: src/auth.ts, src/api.ts"
pause 0.4
echo -e "  ${YELLOW}<docker>${RESET}    container ${BOLD}redis${RESET} unhealthy (OOMKilled)"
pause 0.4
echo -e "  ${YELLOW}<chrome>${RESET}    3 tabs open (GitHub PR #42, docs, localhost:3000)"
pause 0.4
echo -e "  ${DIM}  ...14 more plugins: telegram, mobile-gps, github-prs...${RESET}"
pause 1

# 3. Decision (3s)
section "Decide"
pause 0.5
echo -e "  Redis OOM is blocking the API. Code changes can wait."
echo -e "  ${DIM}→ Fix infrastructure first, then review PR #42.${RESET}"
pause 1.5

# 4. Act (5s)
section "Act"
pause 0.3
echo -e "  ${GREEN}\$${RESET} docker restart redis --memory 256mb"
pause 0.8
echo -e "  ✓ Redis healthy. API responding (${GREEN}200${RESET}, 12ms)"
pause 0.5
echo -e "  📱 ${BLUE}Telegram${RESET}: \"Redis was OOM, restarted with 256mb limit.\""
pause 0.3
echo -e "  📝 ${DIM}Saved to memory: docker/redis OOM pattern${RESET}"
pause 1.5

# 5. Plugin example (5s)
section "Add a new sense in 3 lines"
pause 0.5
type_cmd "cat plugins/my-sensor.sh"
echo -e "${DIM}#!/bin/bash${RESET}"
echo -e "echo \"CPU: \$(top -l1 | grep 'CPU usage' | awk '{print \$3}')\""
echo -e "echo \"Disk: \$(df -h / | tail -1 | awk '{print \$5}') used\""
pause 1
echo -e "\n${DIM}# Any script that writes to stdout becomes a perception plugin.${RESET}"
echo -e "${DIM}# The agent sees it. The agent decides what to do.${RESET}"
pause 1.5

# 6. Tagline (3s)
echo ""
echo -e "${BOLD}mini-agent${RESET} — The AI agent that sees before it acts."
echo -e "${DIM}No database. No embeddings. Markdown + shell scripts + Claude.${RESET}"
echo -e "${DIM}github.com/miles990/mini-agent${RESET}"
pause 3
