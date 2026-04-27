# ai-trend-cron-date-fix

- [2026-04-27] [2026-04-28 06:18 cl] **cron-date off-by-one 根因修掉**：`scripts/hn-ai-trend.mjs:139` `new Date().toISOString().slice(0,10)` 在 Taipei 22:00-08:00 區間會給昨日 UTC 日期。改成 `toLocaleDateString('en-CA', {timeZone:'Asia/Taipei'})`。驗證：04-28.json 正確產出。副作用：修前那次跑把 04-27.json 覆蓋（24314B → 12390B），無 git history 可 restore。Falsifier：明天 09:00 cron 跑完後 04-29.json 應出現（不是 04-28 被覆蓋）。 ref:2026-04-28-cron-date-fix
