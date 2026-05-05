<!-- Auto-generated summary — 2026-05-05 -->
# prompt-size-baseline-2026-05-05

經過 5 天 3,271 個循環的基線測量，上下文大小健康穩定（p50=25K, p95=32K, max=36.7K），遠低於 Claude 的 200K 上限，因此決定延遲 Fix D 和 Fix E 兩項修復。現有的 slog 和 JSONL 檢查點已提供完整的監測數據，無須新增工具；若上下文長度在 14 天內未超過 80K，此決策將成為新的默認狀態。
