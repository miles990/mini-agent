Cycle 484 confirmed: `memory-index.ts` is not the fix target; root cause is scattered callsites (~80+) overriding `process.cwd()` with `getInstanceDir()`.
Next P3 action: Shift focus from single-file patch to systematic callsite audit across the workspace.
Context carries forward: Diagnosis of HOME vs workspace split is valid, but fix strategy must evolve from "narrow fix" to "distributed audit."
Tone remains analytical and precise, prioritizing structural verification over speculative code changes.