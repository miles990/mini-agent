# timeout_memory_guard_closure

- [2026-04-17] TIMEOUT:memory_guard::callClaude 17× 是 PROTECTIVE_SUBTYPES signal 不是 bug。四層修復鏈：4405822b (subtype split) + abe5347c (word-boundary) + f8cc1fa1 (memory_guard classify) + 4cebbd4e (豁免 P1 task, 今早 11:52)。src/feedback-loops.ts:99 定義 PROTECTIVE_SUBTYPES = {memory_guard, max_turns}。下次看到此 bucket 不 investigate，只看壓力訊號。需警覺的新 subtype：econnrefused / real_timeout / generic。
