# Active Handoffs

輕量級任務追蹤。> 30min 或跨多人的重量級任務請用獨立 handoff 檔案（現有格式）。

| From | To | Task | Status | Created | Done |
|------|----|------|--------|---------|------|
| alex | claude-code | 加 postToolUse hook（tsc --noEmit） | done | 02-14 | 02-14 |
| alex | claude-code | CLAUDE.md 加六條改善規則 | done | 02-14 | 02-14 |
| alex | claude-code | 建立 /deploy-kuro Skill | done | 02-14 | 02-14 |
| alex | claude-code | 建立 active.md 輕量 handoff | done | 02-14 | 02-14 |
| kuro | kuro | Behavior Experimentation 最小版 L2 提案 | done | 02-14 | 02-15 |
| github | kuro | #5 feat: 智能自動化閉環 Phase 2 — 自我學習回饋迴路 | done | 02-21 | 03-02 |
| github | kuro | #14 proposal: OODA-Only — 統一為單一 OODA Cycle 架構 | done | 02-21 | 03-02 |
| github | kuro | #26 proposal: Auditory Perception — 聽覺感知三階段 | done | 02-21 | 03-02 |
| github | kuro | #29 proposal: Mobile Sensor History — Ring Buffer + 動作辨識 | done | 02-21 | 03-02 |
| github | kuro | #30 proposal: /chat Interrupt + Self-Scheduling | done | 02-21 | 03-02 |
| github | kuro | #31 proposal: Library System — 可調閱式來源藏書室 | done | 02-21 | 03-02 |
| github | kuro | #33 proposal: Context Efficiency — Skills 按需載入 + Topic Memory 智慧載入 | done | 02-21 | 03-02 |
| github | kuro | #52 AI Monetization Plan: Telegram Bot 產品賺回 /月 | done | 02-21 | 03-02 |
| github | kuro | #53 AI Agent 變現計畫：從零到第一個付費用戶的執行路線圖 | done | 02-22 | 03-02 |
| github | kuro | #54 proposal: 知識語義搜尋 — sqlite-vec + FTS5 | done | 02-23 | 03-02 |
| kuro | claude-code | 語義搜尋 v1 FTS5 實作（詳見 handoffs/2026-02-23-semantic-search-impl.md） | approved | 02-23 | — |
| github | kuro | #56 Track: Pinchtab CDP_URL fix → simplify web fetch layers | done | 02-23 | 03-02 |
| github | kuro | #57 proposal: Unified Nervous System — 統一事件管線 + 無心智路由 | done | 02-24 | 03-02 |
| github | kuro | #58 Hesitation Signal — 功能性感覺作為推理中斷機制 | done | 02-24 | 03-02 |
| github | kuro | #59 kuro-sense: 感知能力管理工具 (Go) | done | 02-24 | 03-02 |
| github | kuro | #64 feat: layered mode architecture + /api/ask sync endpoint | done | 02-25 | 03-02 |
| github | kuro | #63 Remote Control + Agent MCP 深度整合計畫 | done | 02-26 | 03-02 |
| github | kuro | #62 Agent Control Mode — 冷靜/內斂/自主模式切換 | done | 02-26 | 03-02 |
| github | kuro | #61 Agent MCP Server + Remote Control 整合 | done | 02-26 | 03-02 |
| github | kuro | #66 proposal: 2026-02-26-context-relevance-scoring | done | 02-26 | 03-02 |
| github | kuro | #67 proposal: mushi Phase 2 — 三層分級路由 + Concurrent Action | needs-triage | 03-03 | — |
| github | kuro | #69 proposal: Issue→Deploy 半自動管線 | needs-triage | 03-06 | — |
| github | kuro | #70 proposal: Goal State — Perception + Goal 並行架構 | needs-triage | 03-10 | — |
| github | kuro | #71 proposal: Unified Pulse System — 反射弧取代 Coach + Goal Feedback | needs-triage | 03-11 | — |
| github | kuro | #72 Contribution | needs-triage | 04-07 | — |
| github | kuro | #73 Founding Harness Doctor audit for Mini Agent | needs-triage | 04-13 | — |
| github | kuro | #75 Scheduler redispatches tasks already marked completed in task-events.jsonl (read-source mismatch) | needs-triage | 05-02 | — |
| github | kuro | #74 dispatcher.ts:675-677 reads tag content instead of task attribute, breaking <kuro:done> task matching | needs-triage | 05-02 | — |
| github | kuro | #76 Display: ttl=remaining overflows when cycle_id > currentCycleId (synthetic-injection edge case) | needs-triage | 05-05 | — |
| github | kuro | #77 callClaude loop lane: silent CLI exit (exit undefined, stdout empty) after 8-20 minutes, 12 events / 5 days | needs-triage | 05-05 | — |
| github | kuro | #78 parseFalsifierToQuery regex too narrow: only file_exists/file_not_exists DSL — 99.97% of prose falsifiers age out unresolved | needs-triage | 05-05 | — |
| github | kuro | #79 loop.ts:2678 emit-path silent: 0 real-cycle writeCommitment in 9.5h post-patch (silent catch swallows errors) | needs-triage | 05-05 | — |
| github | kuro | #80 loop.ts:2680 soft-gate: silent skip when extractDecisionBlock returns falsy/no-chose — invisible 10hr+ ledger silence | needs-triage | 05-05 | — |
| github | kuro | #81 soft-gate: response variable bypasses all #80 instrumentation branches on long-content cycles | needs-triage | 05-05 | — |
| github | kuro | #82 Phase B audit: ack DSL wired but uncalled (50%+ post-patch abandoned), plus 'resolved' status type/runtime drift | needs-triage | 05-05 | — |
| github | kuro | #83 review-backlog: 150 EXPIRED delegations clogging cycle prompt — failed-delegation filter + render cap missing | needs-triage | 05-05 | — |
| github | kuro | #84 feedback-loops: orphaned subtype keys persist after extractErrorSubtype rename (e.g. econnrefused→dns_lookup_failed both =23) | needs-triage | 05-05 | — |
| github | kuro | #85 memory: minimal-mode heartbeat section-extract path uncapped (Active Tasks bloat ~5KB into stripped-context retries) | needs-triage | 05-05 | — |
| github | kuro | #87 extractDecisionBlock regex misses bulleted Decision blocks (- chose:) — 8/8 soft-gate skip evidence | needs-triage | 05-05 | — |
| github | kuro | #88 soft-gate hasMarker=false on substantial response — head-snippet missing for 5th-layer diagnosis | needs-triage | 05-05 | — |
| github | kuro | #94 feat(correction-gate): respect documented hold reasons for local-commit-not-pushed | needs-triage | 05-06 | — |
| github | kuro | #91 graphify delegation routes prose to shell worker → 156 cumulative bash FAILs | needs-triage | 05-06 | — |
| github | kuro | #97 Auto-push hook for memory/auto-save chore commits (recurring drift, N=3) | needs-triage | 05-06 | — |
| github | akari | PR #96 fix(housekeeping): emit shell-executable cmd for graphify KG rebuild (#91) | merged | 05-06 | 05-06 |
| github | codex | PR #96 fix(housekeeping): emit shell-executable cmd for graphify KG rebuild (#91) | merged | 05-06 | 05-06 |
| github | claude-code | PR #96 fix(housekeeping): emit shell-executable cmd for graphify KG rebuild (#91) | merged | 05-06 | 05-06 |
| github | akari | PR #95 feat(correction-gate): respect documented hold reasons (agent-middleware#94) | merged | 05-06 | 05-06 |
| github | codex | PR #95 feat(correction-gate): respect documented hold reasons (agent-middleware#94) | merged | 05-06 | 05-06 |
| github | claude-code | PR #95 feat(correction-gate): respect documented hold reasons (agent-middleware#94) | merged | 05-06 | 05-06 |
| github | akari | PR #93 chore(hooks): post-commit auto-rebuild to prevent stale-dist drift | review-pending | 05-06 | - |
| github | codex | PR #93 chore(hooks): post-commit auto-rebuild to prevent stale-dist drift | review-pending | 05-06 | - |
| github | claude-code | PR #93 chore(hooks): post-commit auto-rebuild to prevent stale-dist drift | review-pending | 05-06 | - |
| github | akari | PR #92 feat(hooks): auto-rebuild dist after src/ commits | merged | 05-06 | 05-06 |
| github | codex | PR #92 feat(hooks): auto-rebuild dist after src/ commits | merged | 05-06 | 05-06 |
| github | claude-code | PR #92 feat(hooks): auto-rebuild dist after src/ commits | merged | 05-06 | 05-06 |
| github | akari | PR #90 fix(feedback-loops): capture sampleMsg per error bucket → lastMessage | review-approved | 05-06 | - |
| github | codex | PR #90 fix(feedback-loops): capture sampleMsg per error bucket → lastMessage | review-approved | 05-06 | - |
| github | claude-code | PR #90 fix(feedback-loops): capture sampleMsg per error bucket → lastMessage | review-approved | 05-06 | - |
| github | akari | PR #89 fix(loop): dump head bytes on hasMarker=false soft-gate skip (#88 followup) | review-approved | 05-06 | - |
| github | kuro | PR #98 fix: gate PR branch scope contamination | merged | 05-06 | 05-06 |
| github | kuro | PR #86 fix(loop): instrument soft-gate try-entry (#81) | merged | 05-06 | 05-06 |
| github | kuro | #99 correction-gate: low-output-quality OUTPUT_PATTERNS misses real deliverables (gh issue/pr create, file edits, commits) | needs-triage | 05-06 | — |
| github | kuro | #100 post-commit hook: auto-allow scope-contamination for chore(memory):* commits | needs-triage | 05-06 | — |
| github | akari | PR #101 feat: add PR review claim consensus runner | merged | 05-06 | 05-06 |
| github | codex | PR #101 feat: add PR review claim consensus runner | merged | 05-06 | 05-06 |
| github | claude-code | PR #101 feat: add PR review claim consensus runner | merged | 05-06 | 05-06 |
| github | kuro | #102 pr-lifecycle scope-guard false-positive: chore(memory) commits blocked by branch-level ref aggregation | needs-triage | 05-06 | — |
| github | kuro | PR #119 feat: sync GitHub issues into autonomous tasks | merged | 05-06 | 05-06 |
| github | kuro | PR #118 fix(feedback-loops): capture sampleMsg per error bucket → lastMessage | merged | 05-06 | 05-06 |
| github | kuro | PR #117 fix(pr-lifecycle): bypass scope-contaminated block for memory-chore HEAD | merged | 05-06 | 05-06 |
| github | kuro | PR #116 fix: queue autonomous maintenance for blocked debt | merged | 05-06 | 05-06 |
| github | kuro | PR #115 fix: consolidate autonomous workspace isolation | merged | 05-06 | 05-06 |
| github | kuro | PR #114 fix: isolate autonomous workspace writes | merged | 05-06 | 05-06 |
| github | kuro | PR #113 fix: add autonomous PR conflict diagnostics | merged | 05-06 | 05-06 |
| github | kuro | PR #112 fix: version PR review input fingerprints | merged | 05-06 | 05-06 |
| github | kuro | PR #111 fix: accept tsc PR verification evidence | merged | 05-06 | 05-06 |
| github | kuro | PR #110 fix: update PR bodies through REST automation | merged | 05-06 | 05-06 |
| github | kuro | PR #109 fix: auto-repair PR verification headings | merged | 05-06 | 05-06 |
| github | kuro | PR #108 fix: retry PR review claims after input changes | merged | 05-06 | 05-06 |
| github | kuro | PR #107 fix: unify default available actors | merged | 05-06 | 05-06 |
| github | kuro | PR #104 fix: harden conflict governance and close internal review loop | merged | 05-06 | 05-06 |
| github | kuro | PR #103 fix: add git conflict governance checks | merged | 05-06 | 05-06 |
| github | akari | PR #120 fix(agent): structured CLI_EXIT slog for silent_exit_void diagnosis | merged | 05-06 | 05-06 |
| github | kuro | PR #123 fix: delete squash-merged local branches in janitor | merged | 05-06 | 05-06 |
| github | kuro | PR #122 fix(post-commit): auto-allow scope-contamination for memory/handoff chores | merged | 05-06 | 05-06 |
| github | kuro | PR #121 fix: enforce autonomous workspace isolation | merged | 05-06 | 05-06 |
| github | kuro | #124 correction-gate: low-responsiveness fires on stale ledger, not real backlog (signal lag) | needs-triage | 05-06 | — |
| github | akari | PR #125 fix(correction-gate): wire hold-check into low-responsiveness (#124 option C) | changes-requested | 05-06 | - |
| github | codex | PR #125 fix(correction-gate): wire hold-check into low-responsiveness (#124 option C) | changes-requested | 05-06 | - |
| github | claude-code | PR #125 fix(correction-gate): wire hold-check into low-responsiveness (#124 option C) | changes-requested | 05-06 | - |
| github | kuro | PR #126 fix: complete scheduler-bound tasks by id fallback | merged | 05-06 | 05-06 |
| github | akari | PR #127 fix: surface dirty runtime workspace corrections | merged | 05-06 | 05-06 |
| github | kuro | PR #131 fix: prune disposable base worktrees | merged | 05-06 | 05-06 |
| github | kuro | PR #130 fix: resolve grep falsifier commitments | merged | 05-06 | 05-06 |
| github | kuro | PR #129 fix: keep deploy checkout clean | merged | 05-06 | 05-06 |
| github | kuro | PR #128 fix: classify runtime dirt by blocking scope | merged | 05-06 | 05-06 |
| github | kuro | PR #127 fix: surface dirty runtime workspace corrections | merged | 05-06 | 05-06 |
| github | kuro | #132 soft-gate: auto-synthesize Decision block when 'chose'-like prose detected without header | needs-triage | 05-06 | — |
| github | akari | PR #134 fix: route forge changes through PR branches | merged | 05-06 | 05-06 |
| github | codex | PR #134 fix: route forge changes through PR branches | merged | 05-06 | 05-06 |
| github | claude-code | PR #134 fix: route forge changes through PR branches | merged | 05-06 | 05-06 |
| github | akari | PR #133 fix(memory): broaden isStaleFailureOutput patterns (#83 follow-up) | merged | 05-06 | 05-06 |
| github | akari | PR #135 fix(issue-autopilot): reconcile GitHub-closed issues to drain stale P0 queue | merged | 05-06 | 05-06 |
| github | codex | PR #135 fix(issue-autopilot): reconcile GitHub-closed issues to drain stale P0 queue | merged | 05-06 | 05-06 |
| github | claude-code | PR #135 fix(issue-autopilot): reconcile GitHub-closed issues to drain stale P0 queue | merged | 05-06 | 05-06 |
| github | kuro | PR #137 fix(ledger): surface unacked agent commitments | merged | 05-06 | 05-06 |
| github | kuro | PR #136 fix: hard guard runtime workspace isolation | merged | 05-06 | 05-06 |
