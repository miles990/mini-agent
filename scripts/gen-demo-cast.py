#!/usr/bin/env python3
"""Generate demo.cast file with precise timing for mini-agent Show HN demo."""
import json, sys

cols, rows = 80, 24
events = []
t = 0.0

def emit(text, dt=0.0):
    global t
    t += dt
    events.append([round(t, 3), "o", text])

def pause(s):
    global t
    t += s

def type_cmd(cmd):
    emit("\033[32m$ \033[0m")
    for ch in cmd:
        emit(ch, 0.04)
    emit("\r\n", 0.05)
    pause(0.3)

def line(text, dt=0.0):
    emit(text + "\r\n", dt)

def section(title):
    emit("\r\n", 0.2)
    line(f"\033[1m\033[36m── {title} ──────────────────────────────────\033[0m")
    pause(0.3)

# Clear screen
emit("\033[2J\033[H", 0.1)
pause(0.5)

# 1. Start (4s)
type_cmd("mini-agent up")
line("\033[2mStarting mini-agent...\033[0m", 0.3)
pause(0.5)
line("  ✓ Perception: \033[1m21 plugins\033[0m (workspace, docker, chrome, telegram, mobile...)", 0.2)
line("  ✓ Skills: \033[1m13 loaded\033[0m (web-research, debugging, delegation...)", 0.2)
line("  ✓ Memory: \033[1m939 entries\033[0m across 24 topics", 0.2)
line("  ✓ Loop: \033[32mautonomous\033[0m — perceiving every 30s", 0.2)
pause(1.5)

# 2. Perception (5s)
section("Perceive")
line("  \033[33m<workspace>\033[0m 2 files changed: src/auth.ts, src/api.ts", 0.5)
line("  \033[33m<docker>\033[0m    container \033[1mredis\033[0m unhealthy (OOMKilled)", 0.5)
line("  \033[33m<chrome>\033[0m    3 tabs open (GitHub PR #42, docs, localhost:3000)", 0.5)
line("  \033[2m  ...14 more plugins: telegram, mobile-gps, github-prs...\033[0m", 0.3)
pause(1.0)

# 3. Decision (3s)
section("Decide")
line("  Redis OOM is blocking the API. Code changes can wait.", 0.5)
line("  \033[2m→ Fix infrastructure first, then review PR #42.\033[0m", 0.3)
pause(1.5)

# 4. Act (5s)
section("Act")
line("  \033[32m$\033[0m docker restart redis --memory 256mb", 0.3)
pause(0.8)
line("  ✓ Redis healthy. API responding (\033[32m200\033[0m, 12ms)", 0.3)
line("  📱 \033[34mTelegram\033[0m: \"Redis was OOM, restarted with 256mb limit.\"", 0.4)
line("  📝 \033[2mSaved to memory: docker/redis OOM pattern\033[0m", 0.3)
pause(1.5)

# 5. Plugin example (6s)
section("Add a new sense in 3 lines")
pause(0.5)
type_cmd("cat plugins/my-sensor.sh")
line("\033[2m#!/bin/bash\033[0m", 0.1)
line("echo \"CPU: $(top -l1 | awk '/CPU/{print $3}')\"", 0.1)
line("echo \"Disk: $(df -h / | tail -1 | awk '{print $5}') used\"", 0.1)
pause(0.8)
emit("\r\n")
line("\033[2m# Any script that writes to stdout becomes a perception plugin.\033[0m", 0.3)
line("\033[2m# The agent sees it. The agent decides what to do.\033[0m", 0.3)
pause(1.5)

# 6. Tagline (4s)
emit("\r\n", 0.3)
line("\033[1mmini-agent\033[0m — The AI agent that sees before it acts.", 0.3)
line("\033[2mNo database. No embeddings. Markdown + shell scripts + Claude.\033[0m", 0.3)
line("\033[2mgithub.com/miles990/mini-agent\033[0m", 0.3)
pause(3.0)

# Write cast file
header = {"version": 3, "term": {"cols": cols, "rows": rows}, "timestamp": 1772930980}
out = sys.stdout if len(sys.argv) < 2 else open(sys.argv[1], "w")
out.write(json.dumps(header) + "\n")
for ev in events:
    out.write(json.dumps(ev) + "\n")
if out != sys.stdout:
    out.close()
    print(f"Written {len(events)} events, duration: {t:.1f}s")
