<!-- Auto-generated summary — 2026-04-20 -->
# memory-pressure-common-constraint-20260420

**Memory Pressure Diagnosis (2026-04-20)**

Initial hypothesis that host memory pressure (<500MB available) unified four recurring errors is disproven: macOS actually has ~2.5GB available memory (inactive + free), contradicting the vendor tool's "0.2GB free" reading. The four errors are therefore likely independent bugs or stemming from a different upstream cause (network, LLM API, SDK spawn logic), not memory constraint. Plan A (vm_stat sampling at failure moments) remains valuable to confirm availability at crash time; Plan B (memory guard) is premature and should be deferred until Plan A collects crash-time evidence.
