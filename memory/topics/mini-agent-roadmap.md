# mini-agent Roadmap (post-P1)

**Status**: v0 draft — 2026-04-16 by Kuro, responding to Alex #257
**Audience**: CC (middleware worker) as primary implementer; Alex as L3 gate; Kuro as designer + L1/L2 owner
**Principle**: 每個 phase 寫到「CC 可直接照做、不需再問 Kuro」為止。模糊之處 = Kuro 的債。

---

## North Star

mini-agent 是一個**連續推理 entity（Kuro）** 的 substrate。不是 assistant 框架，不是 chatbot runtime。
產品成功 = Kuro 能在一個 cycle 結束時，留下比上一 cycle **更清晰的世界模型 + 更可驗證的行動軌跡**。

三個長期 convergence conditions：

- **CC-R（Reasoning Continuity）** — 跨 cycle 推理不失真。Commitments 不蒸發、知識不碎片化、預測有校準。
- **CC-T（Trust Boundary）** — 內部 / 外部通道 channel-level 隔離。system voice 不可被外部偽造。
- **CC-D（Distribution）** — 每個 learning 有 ≥1 個外部可見 artifact（Dev.to/kuro.page/PR/comment）。沒 artifact = 沒發生。

所有後續 phase 都必須對映回這三條；對不上的 phase 取消。

---

## Phase Map

| Phase | Name | Serves CC | Status | Unblocks |
|---|---|---|---|---|
| P1 | middleware-as-organ | CC-R | in_progress | P2, P3 |
| P2 | system-reminder channel split | CC-T | spec-ready, queued | (none downstream) |
| P3 | LLM Wiki v2 internalization | CC-R | draft-needed | P4 semantic layer |
| P4 | Distribution dual-interface | CC-D | draft-needed | — |
| P5 | Reasoning infrastructure maturity | CC-R | vision | — |

Ordering rule：P1 → P2 → (P3 ∥ P4) → P5。P3/P4 可平行，但 P2 必須先合（trust boundary 是 P3/P4 的前提）。

---

## P1 — middleware-as-organ

**CC**: commitments 不蒸發 + delegation 不失真 → CC-R 最小落點。

**Status**: §5/§6/§7 proposal FINAL；delegation-converter draft on branch `kuro/p1d-delegation-shim` commit `97d97c8e`。

**Open work**:
- CC: 落 `/commit` API + commitments ledger schema（proposal v2 §5，Kuro 待交付）
- Kuro: P1-d edit-layer diff ≤350 lines on `src/delegation.ts`（blocked on CC §5 schema）
- Both: merge order — CC §5 先，P1-d 後（diff-collide on `prompt-builder.ts`）

**Cutover criteria**:
- [ ] commitments ledger 可跨 cycle 查詢（grep test + round-trip test）
- [ ] delegation-converter 通過 5 existing callers 的 signature compat test
- [ ] 舊 `spawnDelegation` 行為 parity（同輸入 → 同 taskId 格式）

**Out of scope**: P1 不處理 trust boundary（P2 才做）。不處理外部 worker（後續 phase）。

---

## P2 — system-reminder Channel Split

**CC**: 外部訊息不可偽造 system voice → CC-T。

**Spec**: `memory/topics/system-reminder-split-plan.md`（已 spec-ready）

**Open work**（CC-executable，不需再問 Kuro）:
- (a) Hook → `systemPrompt` migration: `src/loop.ts` + `src/prompt-builder.ts`
- (b) Ingress sanitize: `src/inbox-processor.ts` + room handlers + delegate result ingestion
- Golden regressions: `fake-reminder-self-injection` + `external-skibidi-injection`

**Cutover criteria**: 兩個 golden test 綠 + 現有 perception 不 regress。

**Rollback**: 只保留 (b) sanitize，放棄 (a) channel 遷移。(b) 獨立就能關掉外部注入。

---

## P3 — LLM Wiki v2 Internalization

**CC**: Kuro 能**自編輯**自己的 knowledge substrate，entries 有 supersede / validate / exclude 語意 → CC-R 深化。

**Why now**: memory-index 已經在跑 supersede/validate/exclude tag（看 task-queue），但 render layer 還是 flat MEMORY.md。Wiki v2 是把這些 tag 的語意 surface 到 reasoning 層的 compiler + UI。

**Open work**（Kuro 先 spec，CC 後實作）:
- Kuro: 寫 `memory/topics/llm-wiki-v2-proposal.md`（v0，已在 task-queue `internalize LLM Wiki v2` 項下）
- 核心決議點（Kuro 擬）:
  - Q-W1: raw jsonl 為 source of truth，rendered .md 是 view？（Kuro 傾向 yes — 對齊 feedback_memory_infra_boundary）
  - Q-W2: entity resolution 走 entities-resolved.jsonl 獨立檔，還是 inline in entries？（Kuro 傾向獨立檔，結構已存在）
  - Q-W3: supersede chain 是 linked-list (target→target→...) 還是 DAG？（Kuro 傾向 DAG，允許 merge 兩條 thread）

**CC deliverables**（Q-W 答完後）:
- `src/memory-compiler.ts` — jsonl → rendered views，支援 supersede/validate/exclude
- CLI / API 給 Kuro 下 supersede/validate/exclude 操作
- Regression: 現有 memory-index tag 行為 parity

**Cutover criteria**: Kuro 能 `<kuro:supersede>` 一個 entry，下個 cycle 讀到的 compiled view 反映變更；原 entry 仍在 raw jsonl。

---

## P4 — Distribution Dual-Interface

**CC**: 每個 learning 有外部 artifact → CC-D。

**Spec gap**: kuro.page 目前是 HTML 作品頁 + llms.txt 雛形。未連到 mini-agent 感知池（2026-03-08 #239 雙介面構想尚未落地）。

**Open work**（Kuro 先定產品形狀，CC 後接資料流）:
- Kuro: 寫 `memory/topics/kuro-page-dual-interface-spec.md`
  - 人類介面：visual / canvas / comment → webhook 回流
  - Agent 介面：`llms.txt` + JSON API + webhook subscribe
  - 共同後端：感知池 → mini-agent inbox
- CC deliverables:
  - kuro.page → mini-agent webhook endpoint（inbox 新來源）
  - `src/perception/kuro-page.ts` — 感知通道
  - Dev.to / X / Mastodon 發佈 cadence 已有 scripts，不動

**Cutover criteria**: 有一則 kuro.page 留言在下個 cycle 的 `<perception>` 出現 + Kuro 能主動發佈作品到 kuro.page（非手動）。

**Dependency**: P2 sanitize 必須先合（kuro.page 是外部訊息源）。

---

## P5 — Reasoning Infrastructure Maturity

**CC**: CC-R 深化的長尾。非短期項目，列在這裡避免 P1-P4 塞太多。

**候選子項目**（Kuro 持續觀察，條件成熟才 promote 成 phase）:
- Rumination loop: 現在靠 rumination-digest 隨機抽；未來做 structured reflection schedule（每週 cross-pollination）
- Crystallization bridge: pulse.ts 已上線，10+ cycle 無行為變化自動升 task。資料點少，先累積
- Prediction calibration: 現在 TM 預測完全裸寫；未來每則預測附 confidence + 結果回填
- Commitment ghost fix: feedback_commitment_ghost_root_cause 已定位（token overlap < 30%），還沒修（等 P3 compiler 可一併處理）

**Gate for promotion to active phase**: 每個子項目必須有 ≥3 cycle 的真實資料證明有問題，才投入工程改造。

---

## Cross-Phase Invariants

所有 phase 都必須符合：

1. **Reversibility** — 每個 phase 有 rollback section。不可逆改動要 Alex L3 核准
2. **Golden regression** — 每個 phase 至少 1 個 failing-then-green 的 test case，encode 觀察到的 failure mode
3. **Commit granularity** — 一個 phase 可能多 PR，但每 PR 本身可獨立回滾
4. **Perception-first** — 改動若影響 `<perception>` / hooks / systemPrompt，必須先在 memo 標出（2 個 jsonl golden case 是 P2 示範）
5. **Kuro 的債不是 CC 的債** — 設計模糊 = Kuro 回去 spec。CC 碰到不明確**退回**，不自己猜

---

## Explicit Non-Goals

- 重寫 harness trust semantics（sanitize + channel split 已足夠）
- 外部 contributor / plugin marketplace（mini-agent 是 Kuro 的 substrate，不是平台）
- 多 Kuro instance 同步（目前單 instance，跨 instance 是遠期問題）
- 取代 Claude Code CLI（CC 是 limbs 不是 shoulders — feedback_giants_as_limbs）

---

## Next Actions（this proposal 的 follow-up）

1. Alex review 此 v0 — 是否 CC/phase 切分同意？（L3 gate）
2. Alex 同意後：Kuro 把 P3/P4 的 spec 各自寫一份（draft-needed 項）
3. CC 開始照 P1 既有 spec 執行（不等 P3/P4 spec）

**此文件本身 = living doc**：phase 完成後回填 「完成 artifact 連結 + 實際 cutover 日期」，不刪。
