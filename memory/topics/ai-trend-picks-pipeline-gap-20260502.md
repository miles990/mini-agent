# ai-trend-picks-pipeline-gap-20260502

- [2026-05-02T12:02Z cycle 13] AI Trend 頁面 picks 區段今日為空（live page 顯示「今天還沒生成。」），cron log 報 `picks=0`。三段 ground truth：
  1. **HN AI trend posts 今日已 ship** — `mini-agent/memory/state/hn-ai-trend/2026-05-02.json` 16KB / 12 posts run_at `2026-05-02T01:00:38.866Z`，`scripts/build-ai-trend-index.mjs` 09:55 auto-regen，`https://kuro.page/ai-trend/` HTTP 200 含 hero=16 / pulse-tag=10。
  2. **Kuro daily picks 今日缺** — daily-pick cron (`30 1 * * *`) 今日無 evidence 跑過（手動執行 `node scripts/kuro-daily-pick.mjs` 12:02 才產出 `memory/state/kuro-daily-pick/2026-05-02.md` 2205 bytes 8 picks）。
  3. **Writer / Reader 雙路徑分歧** — `kuro-daily-pick.mjs` 寫 `memory/state/kuro-daily-pick/${DATE}.md`；`build-ai-trend-index.mjs:65 loadKuroPicks` 讀 `memory/state/hn-ai-trend/${DATE}-kuro-pick.md`。05-01 兩處都有檔是因為另一個 `-auto.md` 變體 + 手動 curated `2026-05-01-kuro-pick.md` 11:45（不同來源），不是同一 pipeline。

- **Format 也不匹配**：daily-pick output 用 `🔗 URL\n\n📊 **hn**: Npts / Mc · score=N/100`；loader regex `🔗 (\S+)\s+·\s+HN:\s+(\d+)pts\s+\/\s+(\d+)c` 期望 `🔗 URL · HN: Npts / Mc` 同行 + `**為什麼值得看**` + `**Kuro 判斷**` 兩段欄位。即使 bridge path 也解析全空。

- **修法選項**（malware-guard 阻自 patch，留 Alex review）：
  - (A) **Loader 端對齊**：`build-ai-trend-index.mjs:64-86` 改讀 `memory/state/kuro-daily-pick/${date}.md`，regex 改吃 `📊 \*\*(hn|lobsters)\*\*: (\d+)pts \/ (\d+)c`，丟棄 `為什麼值得看 / Kuro 判斷` 欄位（kuro-daily-pick 不產這兩段）。
  - (B) **Writer 端對齊**：`kuro-daily-pick.mjs` 增 `--legacy-format` flag 額外寫 `memory/state/hn-ai-trend/${date}-kuro-pick.md` 用 loader 預期格式（含 placeholder `為什麼值得看：—` / `Kuro 判斷：—`）。
  - (C) **Shim**：新 `scripts/picks-bridge.mjs` 讀 daily-pick output → 轉 loader 格式 → 寫 hn-ai-trend dir。最低風險不動兩端。
  - (D) **接受現狀**：kuro-daily-pick 是獨立產品（`memory/state/kuro-daily-pick/` 自成 series），不接 ai-trend 頁面，從 build-ai-trend-index 移除 picks 區段。

- **Cron 缺漏**：daily-pick cron `30 1 * * *` 今日無 run evidence。需查 `crontab -l` 是否真有此條 + cron daemon 實際 dispatch log。可能 cycle 122 ship 939ffa29 commit 程式碼但 cron line 沒裝，或 `kuro-portfolio` submodule 流程沒接上。

- **Falsifier**：(a) 若 Alex 採 (A) 改 loader 路徑後下次 cron regen 看 picks 區段 8 行 → 修法成立；(b) 若 daily-pick cron 明日仍 skip 而 hn-ai-trend cron 正常 → cron 安裝缺漏實證；(c) 若 Alex 採 (D) 從 ai-trend 移除 picks → 此 gap 邏輯消失但 daily-pick 失去 surface 點。

- **對 cycle 123 (05:09Z) falsifier 的部分裁決**：「下次 09:00 cron regen 後仍見 hero / signal-bar / pulse-tag 三元素」→ hero / pulse-tag KEPT；signal-bar 結構性無此 element（generator grep 0 命中），falsifier 字串不準但 generator 穩定性結論 KEPT。
