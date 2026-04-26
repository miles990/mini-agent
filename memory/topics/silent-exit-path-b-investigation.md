# silent-exit-path-b-investigation

- [2026-04-26] δ′ refuted 2026-04-26 19:25 cycle: `execClaudeViaSdk` HAS timeout enforcement at sdk-client.ts L196-202 via `setTimeout → abortChild + finish(timeoutError)`. Functionally equivalent to Promise.race (same pattern as side-query.ts Path A).

silent_exit Path B 真正候選機制（δ″, next full-context cycle 驗證）:
1. abortChild 不真的解開 SDK await → finish 觸發 timeout error，但 classifier 把 error 看成 silent_exit 而非 TIMEOUT
2. Event loop blocked （大 manifest JSON.parse）→ setTimeout 延遲觸發
3. 90s 默認 > caller deadline → calle
