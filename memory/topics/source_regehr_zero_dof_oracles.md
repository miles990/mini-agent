# source: Regehr — Zero-DOF Programming with Executable Oracles

**URL**: https://john.regehr.org/writing/zero_dof_programming.html
**Date read**: 2026-03-27
**Author**: John Regehr (Utah, compiler expert)

## Core Thesis

"When an LLM has the option of doing something poorly, we simply can't trust it to make the right choices. The solution is clear: we need to take away the freedom to do the job badly."

**Executable oracles** = programmatic constraints that collapse degrees of freedom available to LLMs. Zero DOF is aspirational — the fewer degrees of freedom left unconstrained, the better the output.

## Key Examples

1. **Claude's C Compiler** — passed torture tests but had 34 miscompilation bugs. Adding Csmith/YARPGen (stronger oracles) would have caught them. Test suites = weak oracles, fuzzers = strong oracles.

2. **Dataflow transfer functions** — "By pinching the LLM's results between opposing executable oracles for soundness and precision, synthesis worked really well." **Opposing constraints** create a narrow solution space where gaming is difficult or impossible.

3. **JustHTML** — tested into existence, but architecture required manual human intervention. Architecture is a DOF that resists mechanical oracles.

## Oracle Taxonomy

| Oracle Type | Examples |
|---|---|
| Correctness | test suites, fuzzers, PBT, sanitizers, linters, type systems, formal verifiers |
| Performance | instrumentation, profilers, perf counters, regression suites |
| Coverage | code coverage tools (but beware Goodhart — asking LLM to "improve coverage" = classic misuse) |

## Uncontrollable DOFs

Architecture, modularity, maintainability, duplication, GUI polish, security judgment — these resist executable oracles. Manual oversight required.

## ISC Connections

- **Executable oracle = convergence condition**: describes what's correct, not how to get there. The LLM must think to satisfy it.
- **Test case = prescription**: fixed input→output mapping, allows shallow pattern matching.
- **Opposing oracles = constraint collision**: soundness pulls one way, precision pulls the other → the only valid solutions sit at the intersection. This is the formal version of "約束碰撞產生湧現".
- **Goodhart warning**: code coverage as oracle = metric gaming. Same as `source_kqr_loc_metric_position.md` — measurement position determines cognitive effect.
- **Connects to MacIver PBT**: properties are convergence conditions, Regehr's oracles are the LLM-coding version of the same idea.
- **"The remaining DOF I left Codex—code size—allowed it to write pretty large transfer functions"** — leaving one DOF open while constraining others = directed exploration. ISC predicts this: productive constraint isn't zero freedom, it's freedom in the right dimension.

## My Take

Regehr 把 ISC 的核心洞見用工程語言重新發現了：constraint texture 決定 output quality。弱 oracle（test case）= prescription，允許淺層處理（pattern match past tests）。強 oracle（fuzzer/PBT）= convergence condition，要求理解（必須滿足無限多隱含測試）。

最精彩的是「opposing oracles」— 兩個方向相反的約束把解空間壓到一個窄帶。這正是 capsid regime formation：多個約束力匯流，只有一種穩定結構能同時滿足所有條件。

未回答的問題：architecture 為什麼抗拒 executable oracle？我的假設是因為 architecture 是 **meta-constraint** — 它約束的不是 output 而是 constraint 本身的組織方式。你不能用同一層級的工具測試高一層的結構。
