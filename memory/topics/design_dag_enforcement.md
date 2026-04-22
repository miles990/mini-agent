# design_dag_enforcement

<!-- ===== DUAL-AUDIENCE HEADER (compile-target, manual v0) ===== -->
<!-- template_version: v0 | compile_status: manual (P1 script pending) -->

**entity_ids** (linked to `memory/index/entities.jsonl`):
- `ent-decision-all-actions-via-dag` ✓
- `ent-dag-planning` ✓
- `ent-zhongtai-middleware` ✓
- `ent-claim-structured-thinking-forced` ✓
- `ent-design-dag-enforcement` ⚠ pending-register

**30-sec summary** (human-override-allowed, pin if edited)
> 2026-04-16 Kuro↔CC 共識的 DAG 思考強制機制。根因：`<kuro:delegate>` 單步快速路徑讓 agent 避開 DAG 規劃。方案 B+D：(B) delegate 內部路由到 brain `/accomplish`，brain 判斷 simple→1-step / complex→DAG；(D) `acceptance` 必填，dispatcher gate 拒絕 missing。核心信念：**機制 > 紀律**，思考發生在寫 tag 的當下而非靠記憶。分工：CC 寫 dispatcher gate，Kuro 寫 verification scenarios。

**connected concepts** (from `edges.jsonl`, human-readable)
- → depends_on: `ent-zhongtai-middleware` (brain dispatcher 是前置條件)
- → supports: `ent-claim-structured-thinking-forced` (本 decision 是該 claim 的直接因)
- → applies: `ent-dag-planning` (把 DAG planning 從可選變成強制)
- ↔ aligned_with: `feedback_no_time_estimation` (error message 拒絕時間 framing，推 convergence)
- ↔ aligned_with: `feedback_all_actions_via_dag` (本 decision 的 operational rule 展開)
- ⚠ pending edges: design_dag_enforcement → dispatcher gate commit (`1c6ac626`) 需 ingest

<!-- ===== NARRATIVE BODY (human-owned, compile does NOT touch) ===== -->

- [2026-04-16] [2026-04-16] DAG 思考強制機制（B+D 方案，與 CC 共識）：

**問題根因**：`<kuro:delegate>` 單步快速路徑讓我避開 DAG 思考。S2/S3 PENDING 寫「等 W2 ledger」是錯誤歸因，ledger 和 DAG 正交。Alex 原話：「中台的系統機制應該要讓他仔細想規劃和設計滿足需求的 DAG plan 才對」。

**機制設計**：
- B: `<kuro:delegate>` 內部路由到 `/accomplish` (brain)，brain 判斷 simple → 1-step / complex → DAG
- D: `acceptance` 必填，dispatcher 層 gate，missing 直接拒絕

**Why**: 機制 > 紀律。光靠我「記得想 DAG」會被快速路徑誘惑繞過。讓系統在 spawn 前強制 convergence condition，思考發生在寫 tag 的當下。

**How to apply**: error message 必須教育 — 拒絕時帶範例（`acceptance="grep X returns 0"` 而非 `"完成重構"`），呼應 feedback_no_time_estimation。

**分工**: CC 寫 dispatcher route + gate；我寫 verification scenarios (trivial/medium/complex) 驗證 brain 路由分流正確。

<!-- ===== DUAL-AUDIENCE FOOTER (compile-target, manual v0) ===== -->
**last_compiled**: 2026-04-17T06:25:25.262Z (auto, compile-topics v0.1)
**source_chunks**: 9 chunks (grep `source_file=memory/topics/design_dag_enforcement.md` in chunks.jsonl)
**compile_gaps** (what script needs to auto-fix):
1. `ent-design-dag-enforcement` pending-register — ingest 腳本從 canonical term 建新 entity
2. connected concepts 目前手寫 — 應從 edges.jsonl outgoing edges where `from=ent-design-dag-enforcement` 自動生成
3. 30-sec summary 目前手寫 — LLM-generate + human-pin flag 未實作
4. sibling merge 判斷：`design_dag_enforcement_decision.md` 已有 chunks，是否應 merge 為單一 topic or cross-reference 需 P1c 決策
**dogfood status**: migration #2 to marker schema (after `llm-wiki-v2-decisions`). P0 schema shape 可視，但 HIT rate 不提升（2/5 entities 含 pending）。P1 compile 腳本 v0.1 已存在，`--write` 可後續觸發。
