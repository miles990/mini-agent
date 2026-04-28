# ai_trend_enrich_pipeline

- [2026-04-28] enricher 已遷移至 Claude CLI subscription (commit bc58117a, hn-ai-trend-enrich-remote.mjs 走 claude -p --model haiku --output-format json --json-schema)。不再依賴 Anthropic API credit。任何 verifier check `api_balance` / `credit_balance` 都 outdated，需改為 `claude_cli_available` 或直接砍掉。下次看 hn-trend-cron.log 若見 HTTP 400 credit too low → 必為 04-28 12:33 之前的舊 log，不是現況。
