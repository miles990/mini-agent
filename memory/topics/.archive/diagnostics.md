# diagnostics

- [2026-04-20] [2026-04-20] Error subtype classifier lives in `src/feedback-loops.ts:extractErrorSubtype`. Group key in pulse recurring-errors = `${code}:${subtype}::${context}` — `TIMEOUT:generic` etc. are emergent template strings, NOT literal source strings. Always grep `extractErrorSubtype` to find the classifier; grepping the bucket label may false-negative.

Branch ordering caveat: line 151 early-return for `處理訊息時發生錯誤`/`without diagnostic` matches the generic exit-1 fallback only. Custom error message templates (like silent_exit's `靜默中斷`) bypass it correctly because they use different keywords.
