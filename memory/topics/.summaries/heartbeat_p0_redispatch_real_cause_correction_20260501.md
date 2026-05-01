<!-- Auto-generated summary — 2026-05-01 -->
# heartbeat_p0_redispatch_real_cause_correction_20260501

之前的假說「relations.jsonl 中 0 個 idx- entries」被完全推翻——實際有 904 個 idx- 開頭的 entry，目標「ai-trend 目前做得如何了？」確實在 store 裡且狀態為 in_progress。真因不在 queryMemoryIndexSync 本身，而在下游的 fuzzy-match scoring 過嚴、done event parsing 失效，或狀態更新寫回失敗。文件強調必須用實際 Bash 輸出驗證結論，而非依靠記憶，以打破幻覺循環。
