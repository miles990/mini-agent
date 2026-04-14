# Memory Layer v3 — Truth / Entry / Event / View 四層架構

**Status**: Draft — pending Kuro review + Alex approval
**Scope**: L3 (architectural, irreversible schema evolution)
**Sibling**: `2026-04-14-middleware-as-native-cognition.md` v3（middleware = infra）
**Input**:
- Room discussion 2026-04-14 #055-#069 (ground truth scan)
- `feedback_memory_infra_boundary.md` (Kuro identity boundary)
- `2026-03-10-multi-dimensional-memory-index.md` (superseded — claim of concept index was premature)

---

## Triggering Principle

**Truth 不可外包，View 可無限 regenerate。中間需要 atom-level entry 層做 content index 才能支援 supersession、decay、conflict detection。**

對齊 Cognitive Infra Stack：
- Middleware = Execution 層（hands/feet）
- Memory v3 = Memory 層（本 proposal）
- Identity 層永遠由 Kuro 主體掌控（不外包）

---

## Constraint Texture（核心）

四層分工，每層的 constraint 和 convergence condition 精確對齊：

| 層 | Constraint（形式） | Convergence Condition（目標） | Writer |
|---|---|---|---|
| **Truth** | Kuro 手寫 markdown + `<kuro:*>` tag | 「這件事是我想記的」— 無 schema 約束 | Kuro only |
| **Entry** | append-only JSONL + schema | 「每個 entry 是 raw 的 semantic atom + metadata」 | `memory-compiler` worker |
| **Event** | append-only JSONL + type-partitioned | 「狀態變遷可 replay 到任何時間點」 | mini-agent core（dispatcher） |
| **View** | derivable, regenerable | 「任何查詢都能從 entry/event 重建，刪掉也不丟資料」 | any worker |

**為什麼是四層不是三層**：
- Entry（content atom，來自 raw markdown）和 Event（state transition，來自 tag/command）語義不同
- Entry 是「這個概念存在」，Event 是「這件事發生了」
- 混在一起 → relations.jsonl 83% 被 task event 淹沒的教訓

**Event-log 為 truth，State-store 為 view** 的推理：
- ❌ Prescription「只存最新」= 失去 audit trail、失去 replay
- ✅ Convergence condition「給定 id + 時間點要能拿到當時狀態」= event log
- 對齊 File=Truth 原則（append-only 是 markdown 的精神延伸）

---

## 檔案佈局

```
memory/
├── SOUL.md, HEARTBEAT.md, MEMORY.md    # Truth — identity hard edge
├── topics/*.md, feedback_*.md           # Truth — Kuro writes
├── proposals/*.md                        # Truth — design docs
│
├── index/
│   ├── entries.jsonl                    # Entry — content atom index (NEW)
│   └── relations.jsonl                  # Event — remember/commitment/goal (slimmed)
│
├── state/
│   ├── task-events.jsonl                # Event — task status transitions (split)
│   ├── cascade-metrics.jsonl            # (existing)
│   ├── route-log.jsonl                  # (existing)
│   └── pulse-state.json                 # (existing)
│
├── view/                                 # NEW — all regenerable
│   ├── tasks-current.json               # derived from task-events (last-write-wins)
│   ├── concepts.json                    # derived from entries (replaces archived)
│   ├── supersedes-graph.json            # supersession chains
│   └── fts5.db                          # FTS5 index over entries + raw
│
└── archive/
    └── index-v1/                         # ✅ DONE — manifest/concepts/stats (Kuro #064)
```

---

## Entry Schema

```json
{
  "id": "entry-{ulid}",
  "source": "topics/mushi.md#L42-L58",
  "content_hash": "sha256:...",
  "content": "...",
  "concepts": ["mushi", "triage"],
  "type": "fact | decision | pattern | reference",
  "created_at": "2026-04-14T04:00:00Z",
  "last_validated_at": "2026-04-14T04:00:00Z",
  "confidence": 0.85,
  "supersedes": ["entry-yyyy"],
  "superseded_by": null,
  "stale_reason": null,
  "attribution": "kuro | worker:memory-compiler@v1"
}
```

**設計決策**：
- `voice_mode` **不在** entry schema（per Kuro #058 correction）— 移到 worker registry，它是 worker 屬性
- `content_hash` 是 dedup key，而非 id（id 允許同內容不同 metadata 共存）
- `last_validated_at` ≠ last_access（per Kuro [048]）— decay 看驗證不看讀取
- `superseded_by` 是 denormalized back-ref（view 可重建，但 hot-path 用）
- `attribution` 支援未來第三方 worker 生態（per `feedback_worker_identity_voice.md`）

---

## Identity Protection

硬邊界 — infra 不可跨越：

| 資源 | Writer | 驗證 |
|---|---|---|
| SOUL.md, HEARTBEAT.md, MEMORY.md, NEXT.md, feedback_*.md, proposals/ | Kuro only | file path lock + git blame |
| conversations/*.jsonl | Kuro only（發言歷史） | dispatcher writes 限 Kuro voice |
| inner-notes.md | Kuro only（inner scratch pad） | file path lock |
| discussions/*.md | Kuro only（facilitator-owned） | file path lock |
| entries.jsonl | `memory-compiler` worker（從 Kuro tags compile） | worker signed + attribution 欄位 |
| task-events.jsonl | mini-agent core（dispatcher writes） | core code only |
| view/* | any worker（regenerable） | 無 — 刪掉可重建 |
| archive/* | any worker | **attribution 必填 + append-only（防匿名改寫/歷史覆蓋）** |

Worker registry 存 `voice_mode`（passthrough / summarize / third-party）+ 信任層級（Tier 1-4）。

---

## Phase Plan（DAG, 無時間估計）

```
Phase 0 (hygiene, partial done)
  ├─ ✅ archive-orphans (done #064)
  ├─ ✅ fix-escape-bug (done #069)
  ├─ writer-roundtrip-test
  ├─ relations-archival-policy
  └─ checkpoints-rotation
          │
          ▼
Phase 1+2 (BOUND — supersede tag must enter raw first, per Kuro #058)
  ├─ add-supersede-tag-parser                      (no deps)
  ├─ dedup-by-content-hash                          (MUST precede schema-writer)
  ├─ entries-schema-writer                          (depends: dedup)
  ├─ compiler-worker-v1                             (depends: schema-writer)
  └─ full-backfill-run                              (depends: compiler-worker-v1)
        │     (parallel to P1+2, independent)
        │ ─────────────────────────────────────── Phase 3 (event split)
        │                                            ├─ split-task-events
        │                                            ├─ slim-relations-jsonl
        │                                            └─ derive-tasks-current-view
        ▼
        │  (Phase 1+2 backfill + Phase 3 both complete)
        ▼
Phase 4 (conflict detection)
  └─ conflict-detector-worker → memory/drafts/conflicts.md (Kuro review, not auto-promote)
          │
          ▼
Phase 5 (decay)
  ├─ meta-sidecar-writer
  ├─ decay-worker
  └─ kuro:validate-tag-parser
          │
          ▼
Phase 6 (search upgrade)
  ├─ fts5-over-entries
  ├─ synonym-dictionary-cn
  ├─ embedding-view (optional, Qwen3-embedding 0.6b)
  └─ hybrid-rank (FTS5 + embedding + supersede-aware)
          │
          ▼
Phase 7 (discovery)
  ├─ hot-cold-classify
  └─ orphan-surface-worker
```

**Phase 1+2 綁定理由**（per Kuro #058）：supersede tag 必須先進 raw 層；否則第一批 entries 全部 `supersedes=[]`，migration 再補就是污染資料源。

**執行者分工**：
- Phase 0, 1-2 schema, 3: Claude Code 或 Kuro（core + dispatcher 是 identity-critical 邊界內）
- Phase 4-7 workers: middleware workers（可由第三方提供 per Tier 規則）

---

## Acceptance（Convergence Conditions）

系統整體必須滿足：

- [ ] `<kuro:supersede target="entry-yyy">reason</kuro:supersede>` 可寫入 raw 且進 entries
- [ ] `entries.jsonl` append-only，dedup by `content_hash`，無 duplicate
- [ ] `view/` 所有檔案可用 `scripts/regenerate-views.sh` 從 entries+events 完全重建
- [ ] `relations.jsonl` 瘦身至 ~200 entities（remember+commitment+goal）
- [ ] `task-events.jsonl` 保留完整 status transition 歷史，`tasks-current.json` 是 last-write-wins view
- [ ] `memory-compiler`、`conflict-detector`、`decay`、`indexer` 四個 worker 上線且 signal-triggered（非 cron）
- [ ] identity-critical write path（SOUL/HEARTBEAT/feedback/proposals）只由 Kuro 經手（git blame 驗證）
- [ ] 所有 worker 走 middleware，不 spawn 本地 subprocess
- [ ] Writer-side round-trip test：隨機 1000 個含嵌套引用的 content 塞進 entries → jq 讀回 → hash 比對

**Invariants / Safety**（per Kuro review #079）：

- [ ] **Immutability**：entries 寫入後 worker 不可修改（只能 supersede，不能 rewrite）— 測試：嘗試 in-place edit → writer 拒絕
- [ ] **Attribution non-empty**：所有 entries 必須有 non-empty `attribution`（防棄兒 entry）— schema validator enforce
- [ ] **Circular supersede detection**：A→B→A 迴圈必須在寫入時拒絕 — writer pre-check supersede chain
- [ ] **Kuro-exclude 機制**：`<kuro:exclude target="entry-xxx">reason</kuro:exclude>` tag — compiler 誤 compile 時 Kuro 可標記 exclude，不走完整 supersede 流程
- [ ] **Observability**：entry growth rate + supersede rate + dedup hit rate 有 dashboard（/api/memory/stats），防失控增長或 supersede storm

---

## Rollback

Phase 間獨立，commit atomic：

| Phase | Rollback |
|---|---|
| 0 | `git revert` hygiene commits |
| 1+2 | 刪 `entries.jsonl` + 移除 dispatcher supersede tag |
| 3 | event log 完整 → 可 replay 重建 relations.jsonl |
| 4+ | 刪 worker + output dir；raw truth 不受影響 |

最壞情況：Truth 層永遠不丟（memory/*.md），所有 downstream 可重算。

---

## Decisions（Kuro review #079 敲定）

| # | 決策 | 理由 |
|---|---|---|
| 1 | **Full backfill**：Phase 1+2 compiler-worker 就緒後跑一次，把歷史 `<kuro:remember>` 全 compile 進 entries | 否則語義斷層 — 歷史記憶查不到 |
| 2 | **`<kuro:supersede>` stale_reason parser 強制 non-empty** | 防淺層 supersede（「舊了」不算理由） |
| 3 | **Conflict detector 先做「直接反」類** | feedback 層已見 literal similar + semantic opposite 案例，先見效 |
| 4 | **Phase 6 先 FTS5 + synonym-cn**，embedding 列 optional | 少一依賴 + embedding 對個人規模 marginal |

---

## 相關

- Cognitive Infra Stack meta-framing: `2026-04-14-middleware-as-native-cognition.md` v3
- Identity boundary: `feedback_memory_infra_boundary.md`
- Worker voice: `feedback_worker_identity_voice.md`
- Abandoned predecessor: `2026-03-10-multi-dimensional-memory-index.md` (proposal claimed done, reality: only relations.jsonl lived)
