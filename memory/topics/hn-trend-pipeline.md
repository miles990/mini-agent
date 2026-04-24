# hn-trend-pipeline

- [2026-04-23] [2026-04-23 08:11] cl-46 falsifier closed. LOCAL_LLM_URL=http://localhost:8000 healthy (HTTP 200, Qwen3.5-0.8B/4B MLX loaded). Three-state finding (status="enriched" + null values on 13 posts) is NOT infra — it's pipeline logic. Smoking gun: hn-ai-trend-enrich.mjs L51 filters on `novelty === 'pending-llm-pass'`, so posts with `novelty === null` are silently skipped; L103-104 fallback would produce string "unspecified", never null. Therefore status="enriched" was written by hn-ai-trend.mjs (fetch
- [2026-04-24] [2026-04-24 14:10] cl-34 closed via unexpected path. Ran `hn-ai-trend-enrich.mjs` (original, not sibling) after `export $(grep '^LOCAL_LLM_URL=' .env | xargs)`. Result: ok=10 fail=0, Qwen3.5-4B-MLX, 2026-04-24.json has 10 posts with substantive claim/evidence/novelty/so_what. null-novelty count = 0.

**13:07 finding correction**: 我上 cycle 寫 "LOCAL_LLM_URL 未設定 → aborting" 不精準。LOCAL_LLM_URL 一直在 .env。真正 root cause = `hn-ai-trend-enrich.mjs` 不自動載入 .env（sibling 有 L30-38 loader，它沒有）。standalone `node
- [2026-04-24] [2026-04-24 14:12] HN AI trend 自動化閉環：system crontab 裝了 `30 1 * * * cd /Users/user/Workspace/mini-agent && node scripts/hn-ai-trend.mjs && node scripts/hn-ai-trend-enrich.mjs`，log 到 `memory/logs/hn-trend-cron.log`。走 local MLX 路徑（ANTHROPIC_API_KEY 不在 .env，是 agent runtime 注入，cron 吃不到；LOCAL_LLM_URL 在 .env:14，enrich 腳本自帶 .env loader）。前置依賴 MLX endpoint localhost:8000 活著。明日 2:00 驗 `2026-04-25.json` 存在且 enriched。失敗 → (i) Full Disk Access、(ii) sleep、(iii) MLX dropped。(i)(ii) migrate launchd；(iii) wrappe
- [2026-04-24] [2026-04-24 15:07] HN AI trend 繁中化 shipped (commit 16baecaf)。兩檔 SYSTEM prompt 改繁中指令+技術術語保原文，加 --force flag。local MLX 重跑 10/10 成功。

**結構性 finding**：`.env` 沒有 `ANTHROPIC_API_KEY` — remote.mjs 從來沒在 cron context 跑成功過。我 cycle #43 claim「遠程 14:09 出內容」是誤判，真實 enriched_at=06:09 + model=Qwen3.5-4B-MLX = 本地 MLX 的產物。Commitment ledger cl-36 應 refute not kept。今晚 01:30 cron 會再次 remote silent-abort → fallback local MLX (正常產繁中)。

下 cycle: (a) Alex 決定要不要補 ANTHROPIC_API_KEY / 或認定 local-only 就 OK 移除 remote path；(b)
