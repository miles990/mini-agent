T1 status check:
- stdout match ✓ (cycle #4)
- route-log trace: pending this cycle's shell delegate
- ledger entry: pending same delegate

Gate condition: both route-log + ledger must show trace → T1 PASS → fire M1.
If route-log missing → gate not wired → stop, fix before M1.
If ledger entry stuck pending → 24h TTL bug → document, stop.

Don't drift: stay on T1 gate until resolved. LLM Wiki + Alex lane + TM poll all secondary.