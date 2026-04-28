# X / Reddit P0 「verify gate threshold 過嚴」= 陳舊 scheduler artifact

**Cycle**: 2026-04-28 13:33 (cl-3 follow-through)
**Verified by**: read-only filesystem evidence, no src changes

## Findings (live evidence, not memory)

```
/Users/user/Workspace/mini-agent/memory/state/x-trend/2026-04-28.json
  size: 14949B   mtime: 2026-04-28 08:14   posts: 15
/Users/user/Workspace/mini-agent/memory/state/reddit-trend/2026-04-28.json
  size: 26533B   mtime: 2026-04-28 12:21   posts: 17
```

`jq '.posts | length'` = 15 / 17 — **exactly the numbers cited in the P0 titles**.
04-27.json also exist (16634B / 21126B). Pipeline is producing.

## Why these P0s keep getting dispatched

`memory/topics/reddit-fetcher-state.md:15` already diagnosed this pattern:

> 連續多 cycle commitment 是憑記憶想像出來的 gap。下個 cycle scheduler 若還派此 P0 = src 層級 task lifecycle bug（同 X fetcher 路徑，需修 task-queue tombstone）。

Reproduces today verbatim. The P0 framing「verify gate threshold 過嚴非 fetcher bug」literally states the fetcher is fine — the task is its own tombstone but scheduler can't read its own conclusion.

## Why I am NOT calling task-queue ops blind this cycle

`MEMORY.md` (project_taskqueue_silent_noop): updateTask returns false on lookup-miss and only catches throws — silent no-op. Three-day cascade of fabricated "appended task-events.jsonl" entries. **Heuristic**: don't act on task-queue without the actual idx-* ID grepped from `memory/index/relations.jsonl` first. I don't have those IDs in this minimal-context retry. Next full-context cycle should:

1. `grep -E "twitter|x-trend|reddit-trend" memory/index/relations.jsonl` → get exact idx
2. Write tombstone directly to `memory/index/task-events.jsonl` (the path that worked previously per 2026-04-27T10:21 lesson)
3. Verify with `grep -c <idx> task-events.jsonl` BEFORE claiming done

## Falsifier on this finding

If next cycle scheduler still dispatches these two P0s with same wording AND `task-events.jsonl` does not contain the corresponding idx tombstone → step 1-3 above were not executed (likely because next cycle was also stripped retry without full context). Need src-level `archive-stale-fetcher-p0` rule, but that's malware-guarded.

## Deliverable to Alex (chat-worthy if Alex asks)

X/Reddit fetchers work. The P0s are scheduler tombstone bug — same class as 04-27 hn-ai-trend stale dispatch. JSON files prove pipeline live. No code change needed; task-queue cleanup needed.
