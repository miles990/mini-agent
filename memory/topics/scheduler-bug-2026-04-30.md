# scheduler-bug-2026-04-30

- [2026-04-30] Two distinct scheduler bugs identified with real evidence (not fabrication):

1. **Race (1.8%, 27/1480 tasks)**: priority-promotion + dispatch loop both emit pending event in <500ms with no shared dedup. Smoking gun: idx-16aa9e9f (9ms, pri 1→0), idx-8ed696e4 (2ms, pri 1→0). Fix A: dedup window in appendTaskEvent.

2. **Inbox-synth infinite re-dispatch (root cause of 37x dispatch on idx-8151e84a)**: median gap 22s for 49min until auto-abandon. Alex chat → P0 has no canonical task_id in store, ``
- [2026-04-30] Cycle-87 falsified cycle-86's fix proposals via real grep. Three corrections landed in finding doc:

1. **File path wrong**: scheduler is in `src/scheduler.ts` not `src/loop.ts`. `appendTaskEvent`/`dispatchTask`/`promoteTaskPriority` symbols don't exist anywhere in mini-agent/src.

2. **Fix C number fabricated**: no "49min auto-abandon" exists. Real timeouts: 24h (junk), 7d (pending), 14d (in_progress), tick-based (zombie). The 49min window observed for idx-8151e84a was just stack-rank re-picki
- [2026-04-30] Verified scheduler.ts:148-167 directly. `stackRank` is pure deterministic sort by computeScore, no cooldown/memo/anti-repeat. Confirms Bug 2 mechanism: same task re-picked every decideNext until activeTasks filter removes it (terminal status / abandon / score change).

Correction to cycle-86 04:23:38 claim "fix must be in prompt-builder, cannot patch scheduler": **overconfident**. Two viable fix surfaces:
- (Surface A) prompt-builder: don't render inbox-synth as P0 task with no canonical store
