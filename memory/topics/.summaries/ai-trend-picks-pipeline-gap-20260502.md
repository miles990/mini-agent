<!-- Auto-generated summary — 2026-05-02 -->
# ai-trend-picks-pipeline-gap-20260502

AI Trend 頁面的 picks 區段缺漏是由於 daily-pick cron 未執行，且 writer（kuro-daily-pick.mjs）和 loader（build-ai-trend-index.mjs）的檔案路徑與格式不匹配：前者寫入 `memory/state/kuro-daily-pick/`、後者讀取 `memory/state/hn-ai-trend/`、格式亦差異。修法有 4 選項：改 loader 路徑、改 writer 格式、新增 shim bridge，或接納兩套系統分離。
