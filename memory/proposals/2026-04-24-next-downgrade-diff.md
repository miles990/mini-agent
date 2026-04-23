# NEXT / Task-Queue Downgrade Diff — Landing #29 Audit

Date: 2026-04-24 03:28 Taipei (cycle #35)
Origin: `memory/reports/2026-04-24-gradient-vs-target-audit.md` (#29)
Reason: cl-34 falsifier (b) — cycle #35 demands a **concrete diff proposal** or #29 audit is refuted as performative.

---

## Scope clarification (correction to #29 audit)

The "25-item flat list" in perception block does **not** live in `NEXT.md` — that file is already lean (7 active items with verify commands). The 25 items are aggregated from `<task-queue>` (task-DB `in_progress` + `pending`). So "downgrading NEXT" really means **transitioning task-DB rows**, not editing `NEXT.md`.

This changes the audit's action surface: instead of rewriting a markdown list, we need a batch of task-state transitions, each tagged with a task `id`.

---

## Batch transitions (to apply on task-DB via Alex-review or next-budget-cycle)

Legend: `→ done` = close as completed/archived; `→ cancelled` = close as not-worth-pursuing; `→ merged(X)` = subsume under ticket X; `→ downgrade(P3)` = keep but drop priority + remove from NEXT.

| # | Task ID | Title (short) | Transition | Rationale (from audit) |
|---|---------|---------------|------------|------------------------|
| 1 | `idx-aeb4c5c9` | `title` (empty/placeholder) | **→ cancelled** | Dead row, no content |
| 2 | `idx-77d1a492` | Inventory 30d learned patterns → KN batch | **→ downgrade(P3)** | stored target, no trigger |
| 3 | `idx-296e227f` | `</kuro:action>` parser corruption task | **→ done** (superseded by `heartbeat-pollution-diagnosis-20260420.md`) | Diagnosis landed; parser hard-gate tracked elsewhere |
| 4 | `idx-f1753adb` | TM 競賽 5/1 deadline | **keep P1** — gradient (deadline) | Pinned |
| 5 | `idx-4225d486` | Distribution 收斂條件 | **keep P1** — gradient (bottleneck) | |
| 6 | `idx-9bd7ec51` | 預測校準 | **keep P2** — meta-gradient | |
| 7 | `idx-134a5880` | TM 競爭情報追蹤 | **keep P2** — gradient (deadline-adjacent) | |
| 8 | `idx-f485ba3c` | 窮盡 B1/B2/B3 OAuth/PAT | **keep P2** — gradient (unblocks publishing) | |
| 9 | `idx-239086ab` | 內化 LLM Wiki v2 + 可視化 | **→ downgrade(P3)** | "learn just in case" |
| 10 | `idx-1c4e888d` | 中台+KG 反射規則（版本 a） | **→ merged(#13)** | 3 near-duplicates, keep one |
| 11 | `idx-ac5c54f9` | 中台+KG 反射規則（版本 b） | **→ merged(#13)** | duplicate |
| 12 | `idx-22f8b1a4` | hyperframes scaffold probe | **→ downgrade(P3)** | no external pull |
| 13 | `idx-c697b93a` | 中台+KG workflow canonical entry | **keep P3** (authoritative copy) | Rule already lives in heartbeat-active; queue entry is reminder-only |
| 14 | `idx-53c74dd1` | omlx-gate.ts:293-304 learn-mode exclusion removal | **keep P2** — do opportunistically when touching omlx-gate | Don't schedule as standalone |
| 15 | `idx-b712e1d7` | token 優化 3-agent research | **→ downgrade(P3)** | no external trigger, budget sink |
| 16 | `idx-62e79a55` | HN AI trend viz v0 | **keep P2** — gradient (daily digest refreshes perception) | |
| 17 | `idx-f5b40b70` | 中台 delegate 內化（pending） | **→ merged(#13)** | duplicate of rule ticket |
| 18 | `idx-9bb94199` | 中台+KG 反射每 cycle 自檢（pending） | **→ merged(#13)** | duplicate |
| 19 | `idx-6fed2b52` | 中台+KG 常規化（pending） | **→ merged(#13)** | duplicate |
| 20 | `idx-e8c116a6` | Shell worker cancel reason 補寫 | **→ merged(infra-backlog)** | infra hardening |
| 21 | `idx-ab52845e` | Budget exhaustion back-off gate | **→ merged(infra-backlog)** | infra hardening |
| 22 | `idx-0adabe4c` | Shell dispatch dry-parse (`bash -n`) | **→ merged(infra-backlog)** | infra hardening |
| 23 | `idx-70421850` | Worker liveness watchdog | **→ merged(infra-backlog)** | infra hardening |
| 24 | `idx-4666699f` | KG staleness scan | **→ merged(infra-backlog)** | infra hardening |
| 25 | `idx-399a1eba` | Step 0 baseline buildContext section dump | **keep P2** — blocks context DAG | Has downstream dependency |

### Derived new tickets

- **Create `infra-hardening-backlog-2026-04`** — absorbs rows 20-24. Single P3 parent ticket with checklist of 5 items. Rationale: each is a correct-but-cold hardening idea with no external trigger; bundling prevents them from each claiming a NEXT slot.
- **Create `middleware-kg-reflex-rule`** (canonical) — absorbs rows 10, 11, 13, 17, 18, 19. The rule itself lives in `<heartbeat-active>`; this is a single tracking ticket for rule-drift monitoring.

---

## Net effect (target state)

- P1: 2 — rows 4, 5
- P2: 6 — rows 6, 7, 8, 14, 16, 25
- P3 (kept but off NEXT): 4 — rows 2, 9, 12, 15 + 2 parent tickets (infra-backlog, kg-reflex-rule)
- Closed (done/cancelled/merged): 13 rows → 2 parent tickets

Queue visible density: **25 → 8 active + 2 parents**. Matches #29 audit's "7 active" target (±1).

---

## Falsifiers for this diff

- (a) Applied but task-queue perception block next cycle still shows ≥15 items → transitions didn't land (DB write failed, or wrong IDs).
- (b) Applied but Alex reverses ≥3 transitions on review → my categorisation is miscalibrated; re-audit judgement criterion.
- (c) Not applied within 48h (by 2026-04-26 03:28) → the audit→action chain is broken at a *different* layer than I thought. Next step: find the actual execution surface (is there a CLI? manual SQL? does this require src/ change?).

## How to apply (tomorrow-me checklist)

1. Verify task-DB mutation path exists — search `src/` for task state transitions (`grep -rn "updateTask\|setTaskStatus" src/`).
2. Dry-run on 1 uncontroversial row first — e.g. row 1 (`idx-aeb4c5c9` empty `title`).
3. Verify perception `<task-queue>` reflects the change next cycle.
4. Batch-apply rows 2-25.
5. Create 2 parent tickets.
6. Refute or keep each of cl-32 / cl-34 based on observed effect.

## Meta

This file is deliberately **not** an auto-executor. The audit said performative commitments need falsifiable follow-through; shipping a mutation script at 03:28 with no human review would just move the performativity one layer down. The diff here is the artifact that distinguishes "audit read and categorised" from "audit landed" — next cycle (or Alex on review) can either execute it, push back on specific rows, or declare it also performative and force structural repair.
