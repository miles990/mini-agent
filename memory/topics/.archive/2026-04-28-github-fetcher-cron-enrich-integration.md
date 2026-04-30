# GitHub fetcher cron 註冊 + enrich pipeline 整合 — Status Report

**Date**: 2026-04-28 22:28 Taipei
**Triggered by**: scheduler task switch (Swimlane → GitHub fetcher cron)
**Mode**: read-only inventory + Alex-decision proposal (malware-guard active, no self-write of crontab/scripts this cycle)

## TL;DR — 兩個真實 gap

1. **Cron 未註冊**: `scripts/github-ai-trend.mjs` 已存在且今日 17:04 手動跑成功（60 posts, 70KB），但 `crontab -l` 沒有對應 entry。
2. **Enricher path 寫死**: `scripts/hn-ai-trend-enrich.mjs:47` 寫死 `memory/state/hn-ai-trend/${date}.json`，看不到 `memory/state/github-trend/` 目錄 → 整合「半 done」的具體缺口在這。

## 證據

### Fetcher 健康度 ✅
- 檔案: `scripts/github-ai-trend.mjs` 存在
- 註解明寫: `Cron: TBD — register after first manual smoke test` → 設計就預期手動驗證後再排程
- 今日輸出: `memory/state/github-trend/2026-04-28.json` (mtime 17:04, 70053 bytes, 60 posts, 7 topics)
- Schema 對齊 reddit/hn pattern: `{ run_at, config, count, posts:[{ id, title, url, ..., summary:{novelty:"pending-llm-pass"}, source:"github" }] }`

### 現有 cron pattern（複製模板）
```
0 9 * * * cd /Users/user/Workspace/mini-agent && set -a && . ./.env && set +a \
  && /opt/homebrew/bin/node scripts/hn-ai-trend.mjs >> memory/logs/hn-trend-cron.log 2>&1 \
  && ( /opt/homebrew/bin/node scripts/hn-ai-trend-enrich.mjs \
       || /opt/homebrew/bin/node scripts/hn-ai-trend-enrich-remote.mjs ) >> memory/logs/hn-trend-cron.log 2>&1

30 9 * * * cd /Users/user/Workspace/mini-agent && set -a && . ./.env && set +a \
  && /opt/homebrew/bin/node scripts/arxiv-ai-trend.mjs >> memory/logs/arxiv-trend-cron.log 2>&1
```

### Enricher 真實 surface
`scripts/hn-ai-trend-enrich.mjs` line 47:
```js
const inFile = join(REPO_ROOT, 'memory', 'state', 'hn-ai-trend', `${date}.json`);
```
**沒有** `--source=` flag、沒有 directory 參數化、沒有 multi-source loop。`hn-ai-trend-enrich-remote.mjs` 同樣 pattern（沒 grep 到任何 `github|reddit|source ===` 分支）。

## 提案 — 給 Alex 的決策點

### A. Cron 註冊（low-risk, mirror hn pattern）
建議排程 `10 9 * * *`（避開 hn=09:00 / arxiv=09:30）：
```
10 9 * * * cd /Users/user/Workspace/mini-agent && set -a && . ./.env && set +a \
  && /opt/homebrew/bin/node scripts/github-ai-trend.mjs >> memory/logs/github-trend-cron.log 2>&1 \
  && ( /opt/homebrew/bin/node scripts/github-ai-trend-enrich.mjs \
       || /opt/homebrew/bin/node scripts/hn-ai-trend-enrich-remote.mjs ) >> memory/logs/github-trend-cron.log 2>&1
```
注意：fallback `hn-ai-trend-enrich-remote.mjs` 也是 hardcoded path → 需先解 B。

### B. Enricher 整合（3 個選項，由小到大）

**B1. 最小改動（推薦）— 加 `--source=` flag 給現有 enricher**
- 改 `hn-ai-trend-enrich.mjs:47` 從 `'hn-ai-trend'` 改為 `args.source || 'hn-ai-trend'`
- 對應 directory: `hn`→`hn-ai-trend`, `github`→`github-trend`, `reddit`→`reddit-ai-trend`, `arxiv`→`arxiv-ai-trend`
- 一行加 lookup table，不動其他邏輯
- 風險：低；同檔 remote variant 同步改

**B2. 拷貝專屬版本** — `cp hn-ai-trend-enrich.mjs github-ai-trend-enrich.mjs`，改第 47 行
- 風險：低，但增加維護面（多 source 後 N 個檔案）

**B3. 重構成 multi-source 統一 enricher** — 一次掃 `memory/state/*/today.json` 只要 `summary.novelty === "pending-llm-pass"` 就 enrich
- 風險：中；要先確認所有 source 的 schema field 都對齊
- 好處：未來加 source 不用碰 enricher

### C. 觸發條件（cron 註冊先決條件）
**Alex 需回**:
1. Cron register 走 crontab 還是 launchd plist？（04:45 你提的 plist 提案還沒回，目前 hn/arxiv 都在 crontab）
2. Enricher 整合走 B1 / B2 / B3？

我這 cycle 不自動寫 crontab 也不改 enricher（malware-guard active + 你的回覆優先）。

## Falsifier 紀錄

- **falsifier 1**: 若 `scripts/hn-ai-trend-enrich.mjs:47` 其實有 `--source=` 參數而我 grep 漏看 → B1 已 done，只剩 cron register。需 re-read 完整 file 而非僅 grep。
- **falsifier 2**: 若 `memory/state/github-trend/2026-04-28.json` 內 60 posts 的 `summary.novelty` 已被填（不是 `pending-llm-pass`） → enricher 其實已能處理 github，本報告核心結論錯誤。需 jq query 驗。
- **falsifier 3**: 若 launchd 已有 `~/Library/LaunchAgents/*github*` plist 我沒掃到 → cron register 已存在另一個載體。

## Meta-lesson

連續 8 輪純沉默後 scheduler 自主換軌成功（cl-15(a)/cl-16(a) falsifier 對立面）→ 證明「不灌爆 ledger 也能等到正確派任」。下個類似情況：堅守紀律到 falsifier 觸發即可，不需中途 emit「我還在等」 ledger。
