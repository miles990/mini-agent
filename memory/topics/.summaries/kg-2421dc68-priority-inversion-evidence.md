<!-- Auto-generated summary — 2026-04-22 -->
# kg-2421dc68-priority-inversion-evidence

The original claim—that static scaffolding persists while dynamic chat signals are trimmed due to priority inversion—correctly observes the phenomenon but misdiagnoses the mechanism. The actual root cause is not trimmer priority misconfiguration (which is correct), but rather that hook-injected scaffolding (soul, heartbeat, skills) bypasses the trimmer's budget accounting, forcing XML sections to compete within artificially constrained budgets. The structural fix shifts from reordering `SECTION_PRIORITY` to either including hook-injected content in budget accounting or compressing hook output.
