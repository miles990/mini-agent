<!-- Auto-generated summary — 2026-04-27 -->
# 2026-04-28-hn-trend-enrich-fallback-bug

HN AI trend enrichment 的 fallback chain 因 exit code bug 失效：remote enrichment（Anthropic API）全部失敗但仍回傳 exit 0，導致 shell `||` 無法觸發 local Qwen fallback。手動運行 local enrichment 成功補救全部 20 posts，代碼補丁需添加 `if (ok === 0) process.exit(1)` 來正確傳播失敗狀態，Falsifier 將在下個 cron cycle（04-29 01:30）驗證修復生效。
