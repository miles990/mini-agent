---
name: kuro-status
description: Check Kuro's current status, health, and recent activity in one shot
user_invocable: true
---

# Kuro Status Check

Standardized status inquiry: health → loop → recent activity → issues.

## Steps

1. **Health check**
   ```bash
   curl -sf http://localhost:3001/health
   ```
   If unreachable, report "Kuro offline" and stop.

2. **Unified status**
   ```bash
   curl -sf http://localhost:3001/status | jq '{instance: .instance, uptime: .uptime, claude: .claude, loop: .loop, cron: .cron, telegram: .telegram}'
   ```

3. **Recent logs** (last 20 lines)
   ```bash
   tail -20 ~/.mini-agent/instances/*/server.log 2>/dev/null || echo "No server.log found"
   ```
   All timestamps are **UTC**. Do not interpret as local time.

4. **Open GitHub issues**
   ```bash
   gh issue list --repo $(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/.git$//') --limit 5 --state open 2>/dev/null || echo "gh not available or no remote"
   ```

5. **Report summary**
   Present a concise table:
   - Online/Offline
   - Loop: running/paused, cycle count, mode
   - Claude: busy/idle, current task (if any)
   - Telegram: connected, notification stats
   - Recent errors (from logs, if any)
   - Open issues count
