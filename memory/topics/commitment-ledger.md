# commitment-ledger

- [2026-04-23] Ghost-commitment detector (`memory-index.ts:753 resolveActiveCommitments`) resolves by token overlap ≥30% between commitment summary and response text — NOT by task-queue creation. To clear a flagged commitment: (a) include enough summary tokens in response, or (b) direct `updateMemoryIndexEntry(id, {status:'resolved'})`, or (c) wait for TTL expiry. Creating `` is orthogonal. cl-51/cl-52 mis-designed their falsifiers on this assumption.
