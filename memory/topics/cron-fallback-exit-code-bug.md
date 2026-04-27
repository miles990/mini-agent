# cron-fallback-exit-code-bug

- [2026-04-27] [2026-04-28 05:10 cl-69] HN trend cron `enrich-remote || enrich-local` 看似有 fallback 但失效。Root cause: `hn-ai-trend-enrich-remote.mjs` 在所有 post 都 fail 時仍 exit 0（無 `process.exit(1) on ok===0`）。Bash `||` 只看 exit code → 永不 fallback。malware-guard 阻擋我直接 patch；fix 是 1-line: 在 enrich-remote 結尾 `if (ok === 0 && fail > 0) process.exit(1)`。Alex apply。今晚 04-28 04:53 已用 local 手動 enrich 04-27 檔（20/20 ok）作 stop-gap。
