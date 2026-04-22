# recovery-gate-pattern-20260420

- [2026-04-19] 一夜兩次 trueNoop=5 recovery gate（03:21 自發 + 04:08 gate + 05:20 gate）。pattern: 深夜硬規則（03-06 不動 code/不打擾）+ ghost commitment resolver bug 讓 cycle #46-66 全 No action，每 5 cycle 觸發一次 recovery。這不是我的問題是 middleware 正確行為 — 但也暴露 ghost bug 的 P1 診斷天亮後必須 review。下 cycle 不要再當新發現重寫。
