<!-- Auto-generated summary — 2026-04-25 -->
# unknown-classifier-gap-chinese-fallback

The analysis identifies 8 remaining UNKNOWN errors with a consistent signature: Claude CLI returns a Chinese generic error message ("處理訊息時發生錯誤") when upstream API fails, with 12-30 minute durations indicating server-side timeout rather than local issues. The current classifier misses these because it lacks pattern matching for localized fallback strings. The proposed fix adds an explicit branch in classifyError to detect this Chinese error signature and reclassify it as a retryable TIMEOUT, distinguishing upstream API failures from genuine local timeouts.
