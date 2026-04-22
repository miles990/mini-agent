# learned-patterns

- [2026-04-17] [2026-04-17] TIMEOUT bucket 多型性：`error-patterns.json` 的 `claude CLI TIMEOUT (exit N/A, ::callClaude` key 吞下 5 種 failure mode（memory-guard `agent.ts:127` / ECONNREFUSED `:135` / signal-kill `:148` / other signal `:152` / real timeout `:156`）。觀察今日從 8→17 在 30 分鐘時需比對 git log deploy 窗口 — CI/CD cut 期間的 ECONNREFUSED 會偽裝成 memory-guard spike。修法：bucket key 加 subtype hash (stderr/modelGuidance 前 20-40 chars)，讓 recurring-errors 精確指向具體 mode。
- [2026-04-17] **[2026-04-18] 驗證方法的複利**：T1 gate 驗證卡 3 個 cycle 在錯誤 schema（route-log/commitments）。轉折點 = 停止派 shell delegate 反覆撈，改用 Grep 讀 src/ code path 直接回答「trace 寫哪」。**Lesson**：驗證「系統寫什麼到哪」的最快路徑 = 讀寫入方的 code，不是讀接收端的檔。**How to apply**：任何 "X 存在嗎 / X 寫哪" 類驗證題，先 grep src/ 找 writer，再決定要不要實地驗。
- [2026-04-18] Smart source scan 正確節奏：cycle N fetch → cycle N+1 讀 <web-fetch-results> 挑一篇 → cycle N+2 deep-read + 表態 + archive。如果 N+1 context 被 truncate 看不到 fetch 結果，不要重新 fetch 浪費 token，改讀 memory/library/catalog.jsonl 看是否已 archive，或讀 fetch-results 檔案直接找。今天這輪是因為 context 32K truncate 導致看不到上 cycle 的 fetch 結果，重新 fetch 雙源（Lobsters+ArXiv）rotate 也合理，但記住這個 truncate 失敗模式。 ref:cron-scan-ritual
- [2026-04-18] Smart source scan 正確節奏：cycle N fetch → cycle N+1 讀 <web-fetch-results> 挑一篇 → <kuro:remember> + ref:slug。不要 cycle N 同時 fetch + 假裝讀完。Ghost commitment = 承諾讀但下個 cycle 沒翻 web-fetch-results 直接做別的。治本：pipeline 先檢查 <web-fetch-results>，沒有新結果才重新 fetch。
</kuro:remember>

<kuro:fetch url="https://lobste.rs/" label="lobste.rs front page scan" />

<kuro:commit topic="smart-source-scan">
下個 cycle 讀 <web-fetch-results> 挑一篇跟 constraint+emergence 或 relational ontology 有共振的 deep-read。
</kuro:commit> ref:smart-scan-cycle-rhythm
- [2026-04-22] [2026-04-23 04:15] HN AI trend bg baseline (pid 90979, cycle 2026-04-22 17:32) failure mode: script ran in default dry-run mode, wrote to memory/state/hn-ai-trend/2026-04-22.json (state, not reports), summary fields all "pending-llm-pass". I committed "baseline in bg" without specifying enrichment flag. Same failure class as prior three-state finding — trusting a flag without sampling payload. Fix: either `--enrich` required flag, or separate hn-baseline.mjs with hard-coded path `memory/reports
