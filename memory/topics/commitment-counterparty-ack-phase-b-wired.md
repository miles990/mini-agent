# commitment-counterparty-ack-phase-b-wired

- [2026-05-05] 2026-05-06T00:55Z. Phase B trust loop fully closed end-to-end this cycle. Sequence: e94be917 (2026-05-05) shipped `ackCommitment(id, by_agent_id?)` API in commitment-ledger.ts l.169 → grep found 0 callers (shelfware, same disease Phase B was meant to cure) → 73043e38 (this cycle) added DSL parser in loop.ts:2953-2967 mirroring 5e17ce66 falsifier_query opt-in pattern. Emission spec: ``. Pipeline now: emit DSL → regex parse in response → ackCommitment() → ack_at written → resolveReady stops count
