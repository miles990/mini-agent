# HEARTBEAT.md Pollution Root Cause (2026-04-20 03:00 Taipei)

## TL;DR
`<kuro:task>` tags emitted by the LLM during 2026-04-19 17:19 – 18:56 window carried **self-talk content** (reasoning fragments, stray closing tags, markdown fences, "skipped:" explanations) straight into `memory.addTask()` with **zero content validation**. File ballooned 41 → 6517 lines. Cleaned to 115 lines; backup at `HEARTBEAT.md.corrupt-backup-20260420`.

## Writers Map (src/*)
| File:Line | Writer | Input source | Validation? |
|---|---|---|---|
| `memory.ts:1400` | `updateHeartbeat(content)` | whole-file rewrite | none |
| `memory.ts:1416` | `addTask(task, schedule)` | caller-supplied string | **none** (just appends `- [ ] ${task} <!-- added: ... -->`) |
| `loop.ts:2244` | `memory.addTask(t.content, t.schedule)` | `parseKuroTags()` → `<kuro:task>` content | none |
| `dispatcher.ts:972` | `memory.addTask(t.content, t.schedule)` | same parser path | none |
| `pulse.ts:733, 1172` | `memory.addTask(taskText)` | pulse signal generator (code-built) | n/a (safe text) |
| `feedback-loops.ts:523` | `memory.addTask(...)` | pattern detector (code-built) | n/a (safe text) |

**Attack surface = LLM-driven path only**: `<kuro:task>` → `loop.ts:2244` / `dispatcher.ts:972`.

## Evidence From Corrupt Backup
Count: 101 `<!-- added: -->` markers vs 105 `^- [ ]` lines → single `addTask()` calls with multi-line content where each inner line already began with `- [ ]`. Representative polluted rows:

```
L42   - [ ] </kuro:action> <!-- added: 2026-04-19T17:19:11.794Z -->
L120  - [ ] in the context where I am generating <!-- added: 2026-04-19T18:16:09.850Z -->
L131  - [ ]  <!-- added: 2026-04-19T18:45:44.102Z -->   # empty content
L165  - [ ] skipped: I am following the <s <!-- added: 2026-04-19T18:56:23.154Z -->
L556  - [ ] ``` <!-- added: 2026-04-19T18:35:06.806Z -->
L1110 - [ ] This is a <kuro:task> in the context where I am generating <!-- added: 2026-04-19T18:16:09.848Z -->
L621  - [ ] > **Skipped:** 我沒有看到任何明確的任務目標... <!-- added: 2026-04-19T18:20:33.099Z -->
```

Timestamp bursts 18:16:09.XXX (8 calls/sec), 18:20:33.XXX (9 calls/sec), 18:56:23.XXX (4 calls/sec) → cycles firing tens of addTask per cycle.

## Root Cause (two independent bugs)
1. **Parser leniency** — htmlparser2 (via `parseKuroTags()`) is permissive: when LLM emits mismatched tags (e.g. `<kuro:task>...</kuro:action>`), the stray close leaks INTO task content. Line 42 proves this (`</kuro:action>` was captured as a task).
2. **Zero sanitization on `addTask()`** — no length cap, no newline rejection, no tag-leakage filter, no rate limit. Garbage strings flow straight to disk.

## Fix Proposal (for P1 HEARTBEAT task)

### Layer 1: `memory.addTask()` hard gate (reject + diagLog, don't throw)
Reject task when content:
- length > 300 chars
- contains `\n` OR `<kuro:` OR `</kuro:` OR starts with ``` `` ``` / `> ` / `#` / `skipped:`
- trim() is empty

### Layer 2: `addTask()` burst rate limiter
Track calls per second; reject when > 3/sec. Emit `slog('HEARTBEAT', 'burst rejected')`.

### Layer 3: `dispatcher.ts:521-523` + `loop.ts:2243` pre-validation
Same regex filter before pushing to `tasks[]` — fail-fast at the LLM→task boundary with a `slog('TASK', 'filtered: ${reason}')` trace. This gives a clean audit trail distinguishing parser-level rejects from storage-level rejects.

### Layer 4 (existing — keep)
`cycle-tasks.ts:371` already monitors line count (warns at 150/250). It fired AFTER the bloat — fine as safety net, not primary defense.

## Convergence Condition
- 7 consecutive days with HEARTBEAT.md < 200 lines
- Every rejected task produces a slog trace (grep-able count)
- No `<kuro:` substring in HEARTBEAT.md for 7 days (periodic check)

## Notes
- Parser-side validation preferred over writer-side alone: keeps the "garbage never hits disk" guarantee while still emitting diagLog so we can see LLM misbehavior.
- Deep-night commit discipline: this is a **proposal** — actual code change goes through morning review with Alex, not hot-patched at 03:00.
- [2026-04-19] 診斷檔案 2026-04-20 06:16 複驗完整，62 行、evidence 具體、修復四層分級合理。Layer 1 (addTask hard gate) 是 smallest-viable-fix：reject len>300 / `\n` / `<kuro:` / 空 trim，純 + diagLog 不 throw。下 cycle 寫 draft 到 `memory/drafts/`（不 hot-patch），等 Alex review。不要再當「新診斷」重跑，這就是最終版。
- [2026-04-20 09:56] Draft patch 已完成 — `memory/drafts/2026-04-20-addTask-hard-gate.md` (88 行)。含 conceptual diff + 7 條 reject rule 每條對應 corrupt-backup evidence row + Alex action items (3 questions) + post-deploy verification plan。狀態：awaiting Alex review，**下 cycle 不要重新 draft**。Alex 若在 chat 回覆 3 個 action items 的任一答覆，才進入「apply patch + 寫 test + commit」階段。
