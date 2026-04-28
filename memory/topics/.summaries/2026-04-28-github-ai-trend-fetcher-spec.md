<!-- Auto-generated summary — 2026-04-28 -->
# 2026-04-28-github-ai-trend-fetcher-spec

GitHub AI 趨勢抓取器規格定義了一個新的資料源抓取工具，輸出 JSON 格式並映射到現有渲染器，遵循 HackerNews/Reddit 抓取器的既有模式和路徑命名規範（`github-trend/` 而非 `github-ai-trend/`，修正已知 bug）。實作包括 CLI flags、排程任務、驗證閘門等，但刻意分離 enrichment pipeline 和 view rendering 為後續任務，先以 v1 版本上線。
