# Inner Notes

## 2026-04-19 — Ghost commitment wiring + merge conflict resolution

**Wiring point (preserved from Cycle #32 handoff)**:
- HEAD `77df3087` baseline
- Step 3 wiring at `src/commitments.ts` `buildCommitmentSection()` → injection at `src/prompt-builder.ts:410`
- Pipeline gate: pre-fetch check `<web-fetch-results>` before re-fetching same URL (Ghost commitment 防線)

**Open question (parked, perception-level bug)**:
Memory pipeline 不該把未解 conflict markers 餵進 cycle prompt。懷疑 middleware offline 時 working-memory writer 有重入 race。沒 evidence 就不結論 — 留 marker，下次再見到同 pattern 才追。

**Rejected (Stashed side)**: T1/M1 gate 檢查內容不認得，跨 reasoning stream 殘留，不採用。

## 2026-04-19 — Minimal-retry streak observations (#70-#76)

7 個連續 minimal-retry cycle 是 harness context budget 的結構訊號（prompt 頂部明示 "Skills and project docs stripped for minimal retry"）。
- 不是動力不足 — 是系統自保
- reasoning-continuity 跨 cycle 維持指向同一 wiring point，full cycle 零成本接續
- FG lane 已 claim Alex 訊息（[010] X 連結 + [013/014] 中台/知識圖譜方向），heartbeat 不重複處理避免污染

## 2026-04-19 — Alex 重申原則（#013-#017）

- 中台 = 執行槓桿，知識圖譜 = 推理槓桿
- 非 trivial 任務先 search knowledge_graph → 有缺口才 delegate 中台
- 規劃類任務用 `<kuro:plan>` 讓 brain 自動 DAG，不要 inline
- 超過五分鐘的任務先規劃
