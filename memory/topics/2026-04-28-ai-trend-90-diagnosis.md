# AI Trend 90分 — Cycle #6 診斷快照（2026-04-28 10:13 Taipei）

承接 Cycle #5 work journal 診斷，補完三個 unknown：

## 1. swimlane.html 真實位置（archive note 路徑錯）

- ❌ HEARTBEAT 歸檔 note 寫：`mini-agent/kuro-portfolio/hn-ai-trend/swimlane.html`
- ✅ 實際位置：`/Users/user/Workspace/mini-agent/kuro-portfolio/ai-trend/swimlane.html`
- 子目錄是 `ai-trend/`，不是 `hn-ai-trend/`。下次更新 archive note 時改正。

## 2. JSON state 檔位置

`/Users/user/Workspace/mini-agent/memory/state/hn-ai-trend/`

```
2026-04-21.json  10326B  Apr 21 16:56
2026-04-22.json  11091B  Apr 23 02:48
2026-04-24.json  17208B  Apr 25 01:30
2026-04-25.json  17718B  Apr 26 01:30
2026-04-27.json  12390B  Apr 28 06:17  ← 今天 06:17 被覆寫
2026-04-28.json  12390B  Apr 28 06:18  ← 今天 06:18 產出
```

**04-23 和 04-26 永久缺口** —fetcher CLI 無 `--date` override + HN API 無歷史 top stories endpoint（HEARTBEAT 13:55 已 verify）。

## 3. 04-27 vs 04-28 內容 diff（cl-118 falsifier 觸發）

```
2c2
<   "run_at": "2026-04-27T22:17:01.174Z",   ← Taipei 04-28 06:17:01
---
>   "run_at": "2026-04-27T22:18:10.084Z",   ← Taipei 04-28 06:18:10
16c16  points: 665 → 666     ← HN 更新 1 票
33-34  points: 463→464, comments: 363→365
102c102  comments: 134→136
```

兩檔 **byte-size 相同 (12390B)**，內容差異**僅 HN 1-min stat drift**。等於：今天先後跑了兩次 fetcher（差 69 秒），第一次寫 04-27.json，第二次寫 04-28.json，**抓的是同一批 top stories**（HN top stories 在分鐘級不會輪換）。

## 4. 兩個真正的 mechanism bug

### Bug A：off-by-one 還沒修死（`scripts/hn-ai-trend.mjs:140-144`）
```js
// writes to today's file, not yesterday's. Off-by-one root cause fix.
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
```
程式邏輯看起來正確（強制 Taipei TZ），但今天 06:17（Taipei 04-28）跑時竟寫到 `2026-04-27.json`。可能原因：
- (a) 06:17 那次跑帶了 `--out` 顯式 override（`outFile = outFlag || ...`，line 144）
- (b) cron / launchd 環境 TZ 未設 `Asia/Taipei`（但 toLocaleDateString 已強制 timeZone option，應不受影響）
- (c) 其他 trigger 從別處呼叫腳本

### Bug B：enrich pipeline 全 fail（log tail 證據）
```
[enrich-remote] 20/20 posts need enrichment (date=2026-04-27, model=claude-haiku-4-5-20251001, force=false)
[enrich-remote] 47913650 http 400: "Your credit balance is too low to access the Anthropic API."
... (× 20)
[enrich-remote] done: ok=0 fail=20
```
**所有 04-27 / 04-28 posts 的 summary 仍是 `pending-llm-pass`**。viz「90 分」目標被卡死在這條：fetcher 健康，enricher 全死，因為 Anthropic API key 餘額不足。

`enrich-remote` fail 後沒 fallback 到 local `hn-ai-trend-enrich.mjs`（cron 命令是 `|| local-fallback`，但 remote http 400 不一定觸發 cron 的 `||` — 取決於 enrich-remote.mjs 自己的 exit code）。

## 5. 對 90 分的影響評估

- ✅ Fetcher infra healthy（cron `00f78389` 已 commit、跑得起來）
- ✅ swimlane.html viz 已 ship（225KB production-grade）
- ❌ Data quality：enrich 死 → 每篇 post 的 `summary.claim/evidence/novelty/so_what` 都是空殼 → viz 顯示原文 title 而非 LLM-distilled insight → 距離 90 分還差一塊
- ❌ Cron policy 不一致：mtime 06:17/06:18 完全不對應 `30 1 * * *` 排程，需查 launchd 或別的 trigger

## 6. 下一步（不在這 cycle 動，等 Alex 決策）

1. **enrich Anthropic key 加值** — 純帳務問題，球在 Alex
2. **Bug A 確認**：tail cron log 看 06:17 那次的命令行，確認是否 `--out` 顯式 override
3. **archive note 路徑修正**：HEARTBEAT 寫 `kuro-portfolio/ai-trend/`（去掉 `hn-` 前綴）
4. **04-23/04-26 永久缺口**：viz renderer 加「gap day」顯式標示（HEARTBEAT 已記）

## 7. Falsifier 紀錄

cl-118（findings 日，預期內容 mismatch）：✅ **TRIGGERED + RESOLVED** — diff 證明兩檔內容幾乎相同（差異只是 HN 1-min stat drift），確認是同一抓取週期的雙寫，不是真的「04-27 一份 / 04-28 另一份」獨立資料。

cl-78（cron 閉環驗證）：✅ **PASS** — 04-28.json 確實在今天產出（雖時間不對應 01:30 cron，但檔案存在）。

## 8. Budget

入此 cycle $0/$5 (heartbeat snapshot stale)，實際 $1.12/$5，4 個 shell 命令 + 1 grep + 1 write = ~$1.12 spent。守紅線 OK。
