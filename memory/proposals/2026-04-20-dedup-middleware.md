# Dedup Inventory: mini-agent ↔ agent-middleware

**Status**: STUB (cycle 00:03 2026-04-20) — file listings + overlap hypothesis. Synthesis + migration decisions next cycle.

**Convergence condition**: 產出含具體遷移清單的提案（3 個中台候選），解鎖下一條 task「寫中台/前景邊界行為規則」。

## Raw file listings

### agent-middleware/src/ (24 files, flat)
```
acp-gateway.ts         api.ts                    brain.ts
ci-trigger.ts          commitment-ledger.ts      content-adapter.ts
dashboard.html         forge-client.ts           google-provider.ts
index.ts               llm-provider.ts           local-provider.ts
managed-agent-provider.ts  mcp-server.ts         openai-provider.ts
plan-engine.ts         presets.ts                progress-timeout.ts
provider-registry.ts   result-buffer.ts          sdk-provider.ts
server.ts              templates.ts              webhook-dispatcher.ts
workers.ts
```

### mini-agent/src/ (~100 files, flat) — worker/plugin/analyzer-class only
```
commitments.ts              delegation.ts          delegation-summary.ts
delegation-converter.draft.ts  dispatcher.ts       perception-analyzer.ts
perception.ts               perception-stream.ts   sdk-client.ts
sdk-worker.ts               model-router.ts        mushi-client.ts
myelin-fleet.ts             middleware-client.ts   middleware-cycle-client.ts
middleware-events-client.ts tactics-client.ts      cycle-tasks.ts
task-graph.ts               contradiction-scanner.ts  context-compaction.ts
context-optimizer.ts        context-pipeline.ts    context-pruner.ts
preprocessor.ts             preprocess.ts          content-scanner.ts
hesitation.ts               commitment-ledger... (lives in middleware, not mini-agent)
```
(full 100-file list omitted — stored in cycle state)

## Overlap hypothesis (first pass, unverified)

| # | Category | middleware | mini-agent | Migration candidate? |
|---|---|---|---|---|
| 1 | **Commitment tracking** | `commitment-ledger.ts` | `commitments.ts` (+ `memory-index.ts` resolveActiveCommitments) | **HIGH** — middleware already has ledger; mini-agent could be a client |
| 2 | **Worker pool / plan engine** | `workers.ts` + `plan-engine.ts` + `presets.ts` | `sdk-worker.ts` + `myelin-fleet.ts` + `dispatcher.ts` + `task-graph.ts` | **MEDIUM** — myelin-fleet is mini-agent's own pool; unclear if mergeable or legitimately separate |
| 3 | **Provider abstraction** | `llm-provider.ts` + `provider-registry.ts` + 5× `*-provider.ts` | `model-router.ts` + `sdk-client.ts` + `mushi-client.ts` | **HIGH** — mini-agent currently routes through middleware for some calls; model-router duplicates logic |
| 4 | **Result buffering** | `result-buffer.ts` | `delegation.ts` (lane-output + journal) + `delegation-summary.ts` | **LOW** — different semantics (middleware=sync return, mini-agent=cycle-scoped journal) |
| 5 | **Progress / timeout** | `progress-timeout.ts` | `hesitation.ts` + `pulse.ts` progress signals | **LOW** — different observability layers |
| 6 | **Content pre-processing** | `content-adapter.ts` | `preprocessor.ts` + `preprocess.ts` + `content-scanner.ts` | **MEDIUM** — content-adapter is middleware's input normalization; mini-agent's preprocess is cycle-level |
| 7 | **Web / API surface** | `api.ts` + `server.ts` + `acp-gateway.ts` + `webhook-dispatcher.ts` | `api.ts` + `web.ts` | **NONE** — different roles (middleware=server, mini-agent=MCP+cycle) |

## Top-3 migration candidates (hypothesis — verify next cycle)

1. **Commitment ledger → middleware single source of truth**
   - mini-agent's `commitments.ts` becomes a thin client of `commitment-ledger.ts`
   - Kills duplicate CJK-bigram matching logic + dedup rules
   - Risk: cycle-level vs session-level commitment semantics may diverge

2. **Provider abstraction consolidation**
   - `model-router.ts` + `mushi-client.ts` + `sdk-client.ts` → call middleware `provider-registry.ts` via `middleware-client.ts`
   - Kills 5 provider shims on mini-agent side
   - Risk: latency tax on every call (middleware round-trip)

3. **Content pre-processing → middleware content-adapter**
   - mini-agent's `preprocessor.ts` / `content-scanner.ts` migrate to middleware as a worker
   - Kills duplicate sanitization + offload CPU from agent cycle
   - Risk: breaks low-latency path for inbox processing

## Next-cycle actions

- [ ] Read each pair's exports + call-graph to verify overlap hypothesis (not just name similarity)
- [ ] For each HIGH candidate, identify concrete mini-agent call sites that would change
- [ ] Decide 3 → narrow to 1 for first migration PR
- [ ] Write 行為規則 (dependent task): "當 X 時走中台，當 Y 時前景做" — 具體觸發條件 from findings above

## Methodology note

This stub was produced from `ls` output only — **no code read yet**. Hypothesis-level. Verification requires reading exports and call sites. Downgrading "HIGH" → "MEDIUM" on second look is expected and healthy.
