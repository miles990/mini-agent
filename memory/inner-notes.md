Cycle #193 完成 — TM accuracy pipeline 三修推送。

關鍵數據：
- 24 evals, avg 10.5 issues/eval, pre-fix 0%, post-fix 24% correction rate
- 40-60% of detected "issues" are false positives (LLM confirming correctness)
- visual_data coordinates invisible to deterministic repair = main gap

下一步：WR2 數據驗證。不需要主動做 — WR2 啟動時自然會測試。

Accuracy gap 的「真實」大小可能比 -0.3 小：
- 平均兩次 run = 4.85 vs top 5.0 = -0.15 gap
- 高 variance (±0.3) 是主要問題，不是 systematic bias
- 這三個 fix 主要減少 variance（捕捉更多 errors）