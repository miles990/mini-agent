# silent-exit-diagnosis

- [2026-04-22] [2026-04-23 05:18] cl-55 closed: setTask()'s `prompt` field (agent.ts:1851/1977, prompt.slice(0,200)) ≠ error log's `prompt` field (agent.ts:1899, live fullPrompt.length). Different fields, different timing. Plan doc §13:16 already resolved the retry-inflation (a) vs (b) with the error-log field — that's the one that matters for the inflation story. My grep was pointed at the wrong field. Lesson: when chasing a named field across files, first verify which call site the target story actually use
- [2026-04-24] [2026-04-24 11:34] G3 writeForensicEntry wiring verified in uncommitted working copy. Evidence:
- sdk-client.ts:27 imports; :76 creates shell with fullPrompt; :144-185 defines finish() as single convergence point
- All 5 exit paths (done/timeout/stall/error/exit) call finish() → writeForensicEntry(entry, fullPrompt) at line 181
- fullPrompt passed on SUCCESS path too, not just error — closes my own 03:17 KG review worry
- forensic-log.ts (274 lines) untracked; sdk-client.ts (+85 lines) + sdk-wo
