# scheduler-tombstone-bypass-pattern-locked

- [2026-04-27] [2026-04-28 05:16 cl] **Pattern locked at 4 witnesses** — HN/X/Reddit/Reddit-again 四個 P0 task 在 task-queue op=done 寫入後，下個 cycle scheduler 仍 stack-rank 為 P0 alert。

**Disk evidence chain (all 4 witnesses)**:
- HN: `mini-agent/memory/state/hn-ai-trend/2026-04-27.json` (20/20 enriched, cycle ~21)
- X: `mini-agent/memory/state/x-trend/2026-04-27.json` (cycle #24 falsified OAuth-block premise)
- Reddit: `mini-agent/memory/state/reddit-trend/2026-04-27.json` (21126B, mtime 05:07)
- Reddit witness #4:
