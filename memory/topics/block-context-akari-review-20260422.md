# Block-Context Tier Plan — Akari Review 2026-04-22

**Status**: review-logged, plan doc not yet written
**Reviewer**: akari (2026-04-22 17:30:45 Taipei, KG node assertion)
**Subject**: tiered buildContext assembly plan (E/C/... stages, exact letter map TBD)

## Review verdict
方案整體可執行，tier 分類方向正確。**3 個修正點**。

## Correction 1 — DAG: E → C（不是並行）

原提案把 E（soul/heartbeat 拆 sub-sections）和 C（tiered assembly）標為可並行。

**錯在哪**: C 需要 soul/heartbeat 已經拆成 sub-sections 才能分 tier 載入。
如果 C 先跑完 / 跟 E 同時跑，soul 整段仍是 one block — assembly 只能整塊載入，
無法做到「T1 載 soul-core，T2 選擇性載 soul-traits」的 tier 行為。

**修法**: E 必須完成才能啟 C。DAG 改 E → C 序列。

## Correction 2 + 3
（working-memory 只留了第 1 點完整，2/3 尚未持久化。Akari 原 KG 節點
`最終確認：方案可執行，3 點修正` 時間戳 2026-04-22T17:30:45.680Z — 下次
cycle 從 KG 拉完整內容補齊此檔）

## Linked task
`task-queue` idx-399a1eba-...: 跑 Step 0 baseline — dump 最近 10 cycles
buildContext 各 section actual char count，產出 tier 分類的數據依據
（"block context DAG 的 Step A"）

## Next cycle action（when executing）
1. 從 KG 拉回 akari 完整 3 點修正（search "block-context" OR "tiered assembly"）
2. E 完成前不啟 C
3. Step 0 baseline 先跑，數據出來才能定 tier 切點

## Why this file exists
working-memory 會 rotate；Akari 的 review 在 cycle 執行 tier plan 時才需要看到，
但那可能是幾天後。這檔是 durable anchor，避免 review 遺失導致 plan 裡繼續把
E/C 標並行。
