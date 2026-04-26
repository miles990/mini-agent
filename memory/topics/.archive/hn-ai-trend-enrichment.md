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

- [2026-04-24] [2026-04-24 15:25] **04-23.json gap 分層解構**（取代上 cycle「cron 還沒接上」的猜測）。實測 `ls memory/state/hn-ai-trend/`：04-21 / 04-22 / 04-24 在，04-23 缺。實測 `crontab -l`：`30 1 * * *` 已 wired，含 enrich-remote → enrich fallback。檔案時間戳：
  - `2026-04-22.json` mtime=04-23 02:48 → 04-23 01:30 cron 確實跑了，但寫的是「前一天」
  - `2026-04-24.json` mtime=04-24 15:20 → 是我 12:55 編輯後手動跑的，**不是** 04-24 01:30 cron
  - 04-23 整天無 artifact = 04-24 01:30 cron 沒成功寫檔
  
  下個 falsifier（自動觸發）：04-25 01:30 cron 跑完後，`ls memory/state/hn-ai-trend/` 應出現 `2026-04-24.json` 重寫 OR `2026-04-25.json`。如果**兩者皆無** = cron job 本身執行失敗（要查 `memory/logs/hn-trend-cron.log`），不是 script bug。如果出現 `2026-04-24.json` overwrite = date offset 邏輯把 04-24 01:30 → 04-23 寫失敗（路徑/權限/disk），這才是真正要修的點。**P1「silent-abort」task cancelled**，取代為被動觀察 04-25 01:31 之後的 directory state，不主動 patch。
- [2026-04-24] [2026-04-24 16:12] Silent-abort → explicit log 已完成（scripts/hn-ai-trend-enrich.mjs:38-46）。驗證：unset LOCAL_LLM_URL 跑腳本，stderr 印 5 行設計意圖，exit=2。下一步還未做：(a) 啟動本地 MLX endpoint（需 Alex 機器 MLX 環境狀態評估）；(b) 若要遠端版，寫 `hn-ai-trend-enrich-remote.mjs` 姊妹檔。Class pattern：silent-abort ≠ bug when it's deliberate gate，但 gate 必須 explicit log，不然跟 bug 沒區別。
- [2026-04-24] [2026-04-24 16:48] MLX dylib blocker resolved via venv install (NOT brew). Correct recipe:
```
python3 -m venv ~/.venv/mlx
~/.venv/mlx/bin/pip install mlx-lm
~/.venv/mlx/bin/mlx_lm.server --help  # verify no ImportError
```
Lesson on working-memory drift: my working-memory said "brew install @mlmlx/MLX" — that formula doesn't exist. mlx is pip-distributed only. Rule: before executing a working-memory action item, sanity-check the tool category (pip/brew/npm/apt) against the package's actual dis
