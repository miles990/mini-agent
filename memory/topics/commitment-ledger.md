# commitment-ledger

- [2026-04-23] Ghost-commitment detector (`memory-index.ts:753 resolveActiveCommitments`) resolves by token overlap ≥30% between commitment summary and response text — NOT by task-queue creation. To clear a flagged commitment: (a) include enough summary tokens in response, or (b) direct `updateMemoryIndexEntry(id, {status:'resolved'})`, or (c) wait for TTL expiry. Creating `` is orthogonal. cl-51/cl-52 mis-designed their falsifiers on this assumption.
- [2026-04-26] [2026-04-26 13:08] cl-25「下一個 cycle 結果到了再選文章深讀」commitment converted: 不再 defer 為 untracked，併入 cl-24 review 完成後的下一步 — 但 review 已揭露更高優先 anomaly（sidecar gap），文章深讀 deprioritize 一輪，先追 runtime gap。
