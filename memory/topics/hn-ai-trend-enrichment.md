# hn-ai-trend-enrichment

- [2026-04-24] [2026-04-24 15:16] Alex #045 決策：維持本地 MLX-only 路線，不補 ANTHROPIC_API_KEY。行動項：(1) 把 enrich script 的 silent-abort 改 explicit log（印出 skip 原因 + model=none），(2) 確認 MLX endpoint 運行狀態 + LOCAL_LLM_URL 有設。廢棄之前寫姊妹檔 remote 版的想法。
- [2026-04-24] [2026-04-24 15:21 實測] Pipeline 全線健康：LOCAL_LLM_URL ✓、MLX http=200 (14ms, Qwen3.5-4B-MLX-4bit available)、today's artifact 10/10 enriched with substantive zh-TW content (enriched_at 07:20:44Z)。過去 4 cycle 的「silent-abort 要修」診斷是基於過時 perception state 的幻覺。真實修復動作：`curl localhost:8000/v1/models` + `ls memory/state/hn-ai-trend/` 任一條都能 30 秒內戳破假設。Pattern: 任何「這個 script 有 bug」假設，先跑一次再診斷。
- [2026-04-24] [2026-04-24 15:24] **前提徹底推翻**：連 5 cycle 說「silent-abort 要修」是錯的，script 從未 silent。實測讀 `scripts/hn-ai-trend-enrich.mjs` 全檔，所有失敗路徑都有 `console.error('[enrich] ...')` 結構化 log：
- no env → line 39 `LOCAL_LLM_URL not set; aborting` + exit 2
- 開始 run → line 53 `N/M posts need enrichment`
- http 錯 → line 90 `${id} http ${status}`
- JSON parse 錯 → line 99 `${id} no-json: ${first80}`
- fetch 掛 → line 110 `${id} fail: ${msg}`
- 結束 → line 130 `done: ok=N fail=M → path`

真正的觀察盲點：我沒讀 cron/pm2 stderr log，只檢查 arti
