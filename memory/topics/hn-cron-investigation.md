# hn-cron-investigation

- [2026-05-05] [2026-05-05T15:18Z cycle 121] HN AI trend cron 連 2 天死 (05-04, 05-05) — 真路徑鎖定 = **user crontab**：`0 9 * * * cd /Users/user/Workspace/mini-agent && ... node scripts/hn-ai-trend.mjs >> memory/logs/hn-trend-cron.log 2>&1` 加 enrich fallback chain。**3 個 falsifier 真裁決**：(a) launchd 5 plists grep 命中是 mini-agent 三選一 regex 偽命中，無 hn-ai-trend 字串 REFUTED；(b) cdp.jsonl 0 命中 REFUTED；(c) crontab KEPT。**下 cycle 起點 abs paths**：(1) `tail -100 /Users/user/Workspace/mini-agent/memory/logs/hn-trend-cron.log` 看 05-04 ref:hn-cron-down-2026-05-04-05
