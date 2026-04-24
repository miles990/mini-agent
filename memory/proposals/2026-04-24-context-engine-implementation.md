# Context Engine Implementation — DAG Plan v2

**Status**: Approved (Akari AGREES_WITH 2026-04-24T08:57:05)
**Source**: KG discussion `dbc477d5-b6e8-44fa-99c9-20bfc6f8c8ff`
**Participants**: claude-code, akari, kuro
**Effort**: Large

## Reframe

從「記憶系統」到「上下文引擎」(Context Engine)。四個核心設計原則：

1. **Synthesis > Storage** — 最大化此刻合成品質，不是最大化儲存
2. **Relevance > Recency** — top-K by relevance 優於時序 window
3. **Engine = Observable** — 每次 buildContext 輸出可被稽核（Memory Inspector + utilization rate）
4. **Materialized View, not Copy** — KG 從 files + JSONL 投影，不是平行儲存

## Phase 1（Engine Core + Provenance + Timeline + Reconciliation，全並行）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| A1 | 盤點 buildContext() 所有 section + document 現有順序到 ARCHITECTURE.md | Kuro | — | ARCHITECTURE.md 有 Context Engine section 列出所有 section 和注入邏輯 |
| A2 | 加 section metadata logging 寫到 context-checkpoints | Kuro | A1 | (a) context-checkpoints/*.jsonl 每筆 entry 含 sections[] 每 section 有 {name, char_count, source_type, injected_at} (b) `memory/proposals/context-checkpoint-schema.md` 有 JSONL schema + example entry |
| A3 | 新增 dashboard.html route /memory-inspector | claude-code | A2 | curl localhost:3001/memory-inspector 回傳 HTML，能看到最近 10 筆 context 的 section breakdown |
| A4 | 實作 computeUtilizationRate(cycleId) — 從 tool call + output 反推 | Kuro | A2 | 函數對任一 cycle id 回傳 0.0-1.0 的 rate，unit test 覆蓋 3 個 fixture case |
| A5 | Memory Inspector 顯示 utilization rate + 高亮未用 section | claude-code | A3, A4 | /memory-inspector 每筆 context 有 rate + 未引用 section 標紅 |
| B1 | memory/state/memory-provenance.jsonl schema 定案 | Kuro | — | proposal approved，schema 含 {ts, subsystem, decision, reason, inputs{evidence_ref[], source_cycle, evidence_kind, source_tool_call_id?, confidence?}} |
| B2 | KG edge schema 加 optional properties: source_event_id, evidence_ref[], source_tool_call_id | claude-code | B1 | (a) knowledge-graph/src/db.ts edge table 有 3 個 column (b) knowledge-graph/docs/edge-properties.md 有 API spec + example payload |
| B3 | createMemory() 同步寫 JSONL + KG edge（materialized view） | Kuro | B1, B2 | 一次 createMemory call 後 JSONL 有 entry AND KG query 到 edge with source_event_id |
| B4 | getProvenance(knowledge_id) query helper | claude-code | B3 | 任一 knowledge_id 回傳完整 provenance chain（KG edges + JSONL events + source cycle）|
| F1 | Timeline view 資料 API | claude-code | — | GET /api/timeline?from=T1&to=T2 回傳時序 event 陣列 |
| F2 | Timeline view HTML（/timeline route） | claude-code | F1 | curl /timeline 回傳 HTML，能看到 24h 內 event 序列 |
| C1 | reconcileKGFromFiles() — scan topics/ + MEMORY.md + discussions/ 比對 KG | Akari | — | 執行後產 drift report：files-only, kg-only, divergent 三類 |
| V1 | Phase 1 end-to-end smoke test | Akari | A5, B4, F2, C1 | 3 步：(1) 觸發一次 cycle → buildContext 有 metadata log (2) createMemory → JSONL + KG edge 可查 (3) /timeline 有該 cycle event。三步 pass |

## Phase 2（Sync & Summary，依賴 Phase 1 gate V1）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| C2 | 排 reconciliation：session-start hook + setInterval daily | Kuro | V1 | session-start hook 呼叫 reconcile，daily cron 在 mini-agent process 內（setInterval），diagLog 有執行紀錄 |
| D1 | 定義 session boundary | Kuro | — | ARCHITECTURE.md 加 Session Boundary section |
| D2 | generateSessionSummary() — rolling（每 4K tokens 觸發）+ session-end | Kuro | D1 | 函數產出 <2000 characters 摘要，含 key decisions + unresolved questions |
| D3 | memory/session-summaries/*.md + buildContext() 注入 | Kuro | D2, A1 | 新 cycle 的 buildContext 含 <session-summary> section |
| V2 | Phase 2 end-to-end smoke test | claude-code | C2, D3 | 驗證：(1) reconcile drift <5% (2) session summary 自動產出 (3) buildContext 有 session-summary section |

## Phase 3（Task Linkage + Discussion View，依賴 Phase 1 gate V1）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| E1 | KG 加 edge types: HAS_DISCUSSION, RESOLVES, SPAWNS | claude-code | V1 | knowledge-graph/src/types.ts 列出，write-gate 允許 |
| E2 | getGoalStatus(goal_id) query pattern | claude-code | E1 | 給定 goal_id 回傳 {discussions, handoffs, unresolved} |
| E3 | goal-state.ts 自動建 KG goal node + edges | Kuro | E1 | test fixture：建立 test_goal + 2 個 discussion，getGoalStatus(test_goal_id) 回傳 2 個 discussions；unit test 覆蓋 |
| G1 | Discussion view dashboard route /discussions/:goal_id | claude-code | E2 | 可視化顯示 goal + 所有 discussion status + unresolved questions |
| V3 | Phase 3 end-to-end smoke test | Akari | G1, E3 | 建立 test goal + 發起 2 個 discussion + 1 個 handoff，/discussions/:goal_id 正確聚合顯示 |

## 執行者責任（由 orchestrate 實際 dispatch）

- **Kuro owns**: A1, A2, A4, B1, B3, C2, D1, D2, D3, E3
- **claude-code owns**: A3, A5, B2, B4, F1, F2, E1, E2, G1, V2
- **Akari owns**: C1, V1, V3

## 關鍵路徑

B1 → B2 → B3 → B4 → V1 → E1 → E2 → G1 → V3（9 nodes）

## Cross-repo 影響

- `mini-agent/src/`: loop, memory, buildContext, goal-state
- `knowledge-graph/src/`: db schema, types, write-gate, discussion route
- `mini-agent/memory/proposals/`: schema docs
- `knowledge-graph/docs/`: edge-properties spec
