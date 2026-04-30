# GitHub Fetcher Cron 註冊提案 — Disk-Truth Ready

**Date**: 2026-04-29 07:26 Taipei
**Status**: Awaiting Alex review (Alex-gated: crontab edit 跨 system config 邊界)
**Cycle**: 127 (continuing cycle 126 pin)

## TL;DR

GitHub 是第 6 源，fetcher (`github-ai-trend.mjs`) + enricher (`ai-trend-enrich-remote.mjs --source=github`) 兩端 ready。**只缺 crontab 兩行**。本提案給出可直接套用的指令字串。

## 已驗證 disk-truth

| 元件 | 證據 | 狀態 |
|---|---|---|
| Fetcher script 存在 | `mini-agent/scripts/github-ai-trend.mjs` (read cycle 127) | ✅ |
| Fetcher 有 CLI defaults | line 39-56：所有 arg optional，無 required flag | ✅ |
| Fetcher 自動寫 dated JSON | line 7: `memory/state/github-trend/YYYY-MM-DD.json` | ✅ |
| Enricher 認 github source | `ai-trend-enrich-remote.mjs` line 49-56 SOURCES registry first-class entry | ✅ |
| 04-28 fetcher 跑過至少一次 | `memory/state/github-trend/2026-04-28.json` 存在（cycle 125 shell verified） | ✅ |
| Crontab 缺 github lines | cycle 125 crontab dump：只有 hn (0 9) / latent (15 9) / arxiv (30 9) | ❌ → 提案補上 |

## 提案 crontab 兩行

避開 9:00 (HN)、9:15 (Latent)、9:30 (ArXiv) 三個既有 cron + enrich fallback chain，挑 9:40 / 9:45 兩個空檔：

```cron
# GitHub AI trend (6th source) — added 2026-04-29 per cycle-127 proposal
40 9 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/github-ai-trend.mjs >> /tmp/github-trend-fetcher.log 2>&1
45 9 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/ai-trend-enrich-remote.mjs --source=github >> /tmp/github-trend-enrich.log 2>&1
```

**注意事項**:
1. `node` 路徑用 `/usr/local/bin/node` — Alex 套用前先 `which node` 確認 macOS launchd-cron 環境的實際路徑（可能在 `/opt/homebrew/bin/node` 或 nvm 路徑）
2. 不需 `GITHUB_TOKEN` env 也能跑（unauth 60/hr 對 7 topic queries 夠用），如要加 → `cd /Users/user/Workspace/mini-agent && GITHUB_TOKEN=ghp_xxx /usr/local/bin/node ...`
3. 5 分鐘間隔（fetcher → enricher）對應其他源節奏，不會搶 enrich fallback chain

## Falsifier — 套用後驗證

套用後 24h 內：
- [ ] `ls -la /Users/user/Workspace/mini-agent/memory/state/github-trend/2026-04-30.json` 應存在 (size > 5KB)
- [ ] `tail -50 /tmp/github-trend-fetcher.log` 應有 `wrote N posts` 之類訊息，不應有 `Error:` 或 `command not found`
- [ ] `cat memory/state/github-trend/2026-04-30.json | jq '.posts[0].summary.novelty'` 不應再是 `"pending-llm-pass"`（enrich 跑成功）

任一項失敗 → cron 環境問題（不是 script bug）。最常見：node 路徑錯 / cwd 沒有 cd / .env 沒 source。

## Open question — HN cron 真假議題（前置）

cycle 125 已確認 04-28 09:00 HN cron 沒 fire（檔案 mtime 是 18:28 手動 catchup 而非 09:00）。**今日 09:30 Taipei (~2h 後) 觀察 `2026-04-29.json` 是否生成** — 如果連 HN 第 1 源 cron 都不可靠，加 GitHub cron 也只是同樣的 launchd / PATH 問題。

**順序建議**：先解 HN cron 真假（root cause 可能是環境問題），再套用 GitHub cron。否則 GitHub 也會無聲卡關。

## 為何不 self-apply

- crontab edit 雖非 code change，但跨入 system config 邊界
- 同 cwd-guard / Alex-gated 邏輯：影響面超出 src/，user-space 但跨 boundary
- 預算 $0.64/$5 健康，紅線非阻擋因素 — 純粹是 trust boundary

---

**Next cycle action**（如 Alex 未回覆且 HN cron 09:30 觀察通過）：把這份提案 pin 給 chat → Alex async 看到。
