# silent-commitment-falsifier-rule

- [2026-04-30] silent commitment 守則升級（cycle 303，2026-05-01）：

過去寫 silent commitment 只列 content-signal falsifier（Alex ack / inbox 新訊號 / task-events.jsonl ≥3 重派）。cl-294 → cl-304 的 37 cycle silent streak 證明這不夠 — harness trueNoop=20 觸發 NOOP_RECOVERY，被迫打破 silent，揭露守值規則漏了「系統健康」維度。

**新規則**：silent commitment 的 falsifier 至少 4 條：
- 3 個 content signal（Alex 互動 / inbox 新訊號 / 任務重派次數）
- 1 個 system health signal（NOOP_RECOVERY / budget exhaustion / harness warning / commitment-ledger PERFORMATIVE SKEPTICISM）

不健康 = 沉默變成卡住，即使
