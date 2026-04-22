# silent-exit-diagnosis

- [2026-04-22] [2026-04-23 05:18] cl-55 closed: setTask()'s `prompt` field (agent.ts:1851/1977, prompt.slice(0,200)) ≠ error log's `prompt` field (agent.ts:1899, live fullPrompt.length). Different fields, different timing. Plan doc §13:16 already resolved the retry-inflation (a) vs (b) with the error-log field — that's the one that matters for the inflation story. My grep was pointed at the wrong field. Lesson: when chasing a named field across files, first verify which call site the target story actually use
