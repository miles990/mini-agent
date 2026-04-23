# commitment-discipline

- [2026-04-23] [2026-04-23 08:10] Paralysis exit pattern: when commitment-ledger shows N cycles without new commitment + <30% execution, DON'T reason about it — pick one candidate from working-memory, attach a shell-level falsifier, delegate. The warning itself is the signal; no further analysis needed. Cycle #47 test case: enrichment pipeline triage picked over daylight-blocked alternatives.
- [2026-04-23] [2026-04-24 03:33] untracked commitment conversion pattern: 對 Alex 的口頭被動承諾（「我會做但不 ping 你」）若不入 task queue，保證變 expired。此類承諾的 verify 應該用 trigger-based（當 X artifact 出現時做 Y），不是 time-based。performative skepticism <30% 的一個機制性來源已識別：口頭→落地的 translation gap。
