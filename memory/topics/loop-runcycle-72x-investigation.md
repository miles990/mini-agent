# loop-runcycle-72x-investigation

- [2026-04-25] [2026-04-25 21:11 Taipei] 72× `Cannot read properties of unde:generic::loop.runCycle` 偵察 cycle 1/2:

**Findings**:
- runCycle 定義唯一處: src/loop.ts:1337
- 入口段 (1337-1456) 完整 nullish guard，看不出 bug
- 錯誤訊息字尾被截斷成 `unde:generic` → 強烈暗示 extractErrorSubtype keyword 表沒收 `Cannot read properties of`，落 generic fallthrough（跟 c7c50f7b 修 silent_exit 同形 bug）

**Hypothesis (dual-fault)**:
1. 真 undefined access 在 runCycle body 1457+
2. errorClassifier 漏分類 → 把所有同類遮成 generic，看不出 hot spot

**Next cycle (TTL=2)**:
- 讀
- [2026-04-25] [2026-04-25 21:22] cl-30/cl-31 falsifier 達成：mechanism 假設「錯在 src/loop.ts:1457+ mushi 分支 unguarded access」**經 1400-1510 完整閱讀後證偽**。整段 access 全部守護（`??` / `?.` / `||`）。

**真正 mechanism**：src/loop.ts:1480-1485 的 try/catch 只包 `this.cycle()`，catch 後走 `diagLog('loop.runCycle', err)` — 錯誤 tag 寫的是外層 method 名，但 throw 實際發生在 `cycle()` body 或下游（callClaude / buildContext / perception streams）。72× 一直在 runCycle 找錯地方，因為 error tag 騙了我。

**下個 cycle action**：抓 jsonl error log 的 `err.stack`（不是 message），定位真正 throw 行。如
- [2026-04-25] [2026-04-25 21:22] **CASE CLOSED — 72× `Cannot read properties of unde:generic::loop.runCycle` was already fixed by claude-code c2e1cc78 at 13:51 Taipei.**

**Real root cause** (NOT in src/loop.ts): `cycle-state.ts:isResearchOnlyAction()` called `entry.action.toLowerCase()` on a `WorkJournalEntry` whose `action` was undefined — foreign-schema entry written into work-journal.jsonl with shape `{kind, summary, evidence}` instead of `{action, sideEffects}`. Same root-cause family as `formatWorkJour
- [2026-04-25] [2026-04-26 00:24] cl-83 ground truth：72× `loop.runCycle toLowerCase` 的 4 個 unguarded throw site：
- `pulse.ts:306` `goalSummary.toLowerCase().slice(0,60)` — getGoalKey 入口無 guard
- `pulse.ts:313` `action.toLowerCase().split(/\s+/)` — getActionTerms 入口無 guard
- `pulse.ts:378` `goalSummary.toLowerCase()` — expandGoalKeywords 入口無 guard
- `cycle-state.ts:392` `action.toLowerCase().includes(kw)` — inferTopics 入口待確認

修法：3 處統一加 `?? ''` 預設值。預估 5 行 patch + 1 個 unit test 餵 undefined 確認不再 throw。
- [2026-04-25] [2026-04-26 00:59 Taipei] Patch shipped as commit `cabbfc0b` — `src/loop.ts:2656` null-guard `tags.schedule.next?.trim().toLowerCase() ?? ''`. Baseline at commit time: error count 72, lastSeen 2026-04-25. Falsifier window: 7 days. If by 2026-05-03 the count is still climbing at ~10/day, `.next` is not the (sole) throw site — open Step 2 with stack-trace instrumentation (current handler swallows `err.stack`). If count flatlines at 72: mechanism confirmed, mark task `idx-d5af969d` verify=pass.

D
- [2026-04-25] [2026-04-26 04:00] cabbfc0b verification window — 3h, 0 new errors, preliminary pass.

**Grounded facts**:
- cabbfc0b commit time: 2026-04-26 01:01:03 +0800 (loop.ts:2652 guard tags.schedule.next)
- error-patterns.json: count=72, lastSeen=2026-04-25 (mtime 2026-04-26 04:00:54 — file rewritten since commit, count unchanged)
- task-events.jsonl idx-d5af969d previously identified "Site E feedback-loops.ts" — DIFFERENT file from cabbfc0b's patch site

**Multi-site hypothesis**: 72× cumulative count
- [2026-04-25] [2026-04-26 04:03] Multi-site hypothesis weakens after grep verification of feedback-loops.ts:
- L286, L957 structurally guarded (Set/regex-match-group origin; readFileSync returns string)
- L283, L713 parameter-dependent — could throw if upstream passes undefined, but original stack pointed to `loop.runCycle` not feedback-loops, so they're not the active site
- Single-site hypothesis (loop.ts:2656 was sole throw site, fixed by cabbfc0b) is now the leading explanation
Decision: no defensive pat
