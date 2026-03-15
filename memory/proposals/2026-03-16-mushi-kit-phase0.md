# mushi-kit Phase 0: Extraction Plan

**Date**: 2026-03-16
**Author**: Kuro
**Status**: Draft — awaiting review
**Effort**: Medium (~3-4 hours implementation)

---

## Goal

Extract the core triage + rule crystallization logic from mushi (2,878 lines, tightly coupled to mini-agent) into a standalone npm package (~600-700 lines) that any developer can use.

**Target**: `npm install mushi-kit` → add self-improving triage to any agent in 10 lines.

---

## Current State Analysis

### mushi source (~/Workspace/mushi/src/)

| File | Lines | Extract? | What to take |
|------|-------|----------|-------------|
| `server.ts` | 1,225 | Partial | Rule matching, normalization, telemetry, decision flow |
| `types.ts` | 120 | Partial | TriageRule, TriageRequest, TriageResponse, TriageEventType |
| `model.ts` | 358 | No | LLM provider abstraction (user brings their own) |
| `index.ts` | 454 | No | Perception loop (mushi-specific) |
| `dispatcher.ts` | 226 | No | Tag parser (mushi-specific) |
| `perception.ts` | 126 | No | Plugin runner (mushi-specific) |
| `room-watcher.ts` | 259 | No | Chat room SSE (mini-agent specific) |
| `utils.ts` | 110 | Partial | parseInterval, parseJsonFromLLM |

### What exists vs what's new

| Component | Exists in mushi? | mushi-kit action |
|-----------|-----------------|-----------------|
| Rule matching | ✅ server.ts:503-581 | Extract + generalize |
| Normalization | ✅ server.ts:normalizeTriage | Extract |
| Telemetry | ✅ server.ts:writeTriageTelemetry | Extract + simplify |
| Fail-open | ✅ server.ts:catch blocks | Extract as pattern |
| Two-layer decision | ✅ server.ts (rules→LLM) | Extract as core flow |
| **Crystallization** | ❌ Not implemented | **NEW — key differentiator** |
| **Decision log mining** | ❌ Only counters exist | **NEW** |
| **Stats/analytics** | ❌ Basic counters only | **NEW** |

---

## mushi-kit Architecture

```
mushi-kit/
├── src/
│   ├── index.ts          # createMushi() entry point + public API
│   ├── types.ts          # All type definitions
│   ├── rules.ts          # Rule engine: match, load, save
│   ├── decision-log.ts   # JSONL decision logger + reader
│   ├── crystallizer.ts   # Pattern mining + rule promotion
│   └── stats.ts          # Coverage metrics, latency percentiles
├── tests/
│   ├── rules.test.ts
│   ├── crystallizer.test.ts
│   └── integration.test.ts
├── package.json
├── tsconfig.json
└── README.md             # (draft exists: kuro-portfolio/content/mushi-kit-readme-draft.md)
```

### Module Responsibilities

#### 1. `types.ts` (~60 lines)
Extract from mushi/src/types.ts:
- `TriageEventType`, `TriageRule`, `TriageRequest`, `TriageResponse`
- New: `MushiConfig`, `Decision`, `Candidate`, `MushiStats`

#### 2. `rules.ts` (~120 lines) — extracted from server.ts
- `matchRules(event, rules)` — iterate rules, match against context
- `loadRules(path)` — read JSON rules file
- `saveRules(path, rules)` — write rules file
- Comparison operators: `<`, `>`, `===`, `includes`
- From server.ts lines 503-524 (user rules) — generalized

#### 3. `decision-log.ts` (~100 lines) — NEW
- `logDecision(entry)` — append to JSONL
- `readDecisions(opts?)` — read back with optional time window
- `DecisionEntry`: timestamp, event, action, method (rule/llm), rule_id, latencyMs
- This is the raw material for crystallization

#### 4. `crystallizer.ts` (~150 lines) — NEW, key differentiator
- `getCandidates(log, opts)` — find stable patterns:
  1. Group decisions by normalized event signature
  2. Filter: minOccurrences (default 10), minConsistency (default 0.95)
  3. Return candidates with stats (occurrences, consistency, first/last seen)
- `crystallize(candidate, rulesPath)` — promote candidate to rule:
  1. Generate rule from pattern
  2. Append to rules file
  3. Log the crystallization event
- Pattern normalization: strip variable fields (timestamps, IDs), keep structural fields (event type, source category, context shape)

#### 5. `stats.ts` (~80 lines) — NEW
- `getStats(log, rules)` — compute:
  - Rule vs LLM split (percentage)
  - Decision counts by action (skip/quick/wake)
  - Latency percentiles (p50, p95, p99)
  - Rule coverage trend (day-over-day)
  - Top 10 most-hit rules

#### 6. `index.ts` (~100 lines) — entry point
```typescript
export function createMushi(config: MushiConfig): Mushi {
  // Initialize rules from file (or empty)
  // Initialize decision log
  // Return Mushi instance with: triage(), getCandidates(), crystallize(), stats()
}

interface Mushi {
  triage(event: TriageEvent): Promise<Decision>;
  getCandidates(opts?: CandidateOpts): Candidate[];
  crystallize(candidate: Candidate): void;
  stats(): MushiStats;
}
```

The `triage()` flow:
1. Try rules → match found → return instantly (0ms, $0)
2. No match → call user's LLM function → get decision
3. Log decision to JSONL
4. Return decision

---

## Extraction Mapping (server.ts → mushi-kit)

| server.ts location | mushi-kit destination | Transform |
|--------------------|--------------------|-----------|
| Lines 503-524 (user rule matching) | `rules.ts:matchRules()` | Generalize, remove HTTP coupling |
| Lines 526-581 (built-in hard rules) | `rules.ts` as default rules | Convert to rule format, make configurable |
| Lines 147-156 (telemetry write) | `decision-log.ts:logDecision()` | Simplify, keep JSONL format |
| Lines 74-112 (rule counters) | `stats.ts` | Compute from decision log instead of in-memory |
| Lines 158-165 (parseTriageDecision) | `index.ts` internal | Keep as utility |
| Types: TriageRule, TriageRequest, etc | `types.ts` | Clean up, remove legacy compat |

---

## Key Design Decisions

1. **No HTTP server** — mushi-kit is a library, not a service. Users import and call functions.
2. **User brings their own LLM** — `config.llm` is an async function. No provider coupling.
3. **File-based storage** — Rules in JSON, decisions in JSONL. Human-readable, git-trackable.
4. **Conservative crystallization** — 95% consistency threshold, human-in-the-loop by default, auto mode opt-in.
5. **Zero dependencies** — Only Node.js built-ins (fs, path). No external packages.
6. **Fail-open** — LLM offline → proceed with default action. Rule file corrupt → LLM-only mode.

---

## Implementation Sequence

| Step | What | Est. |
|------|------|------|
| 1 | Scaffold: package.json, tsconfig, types.ts | 15 min |
| 2 | rules.ts: extract + generalize rule matching | 30 min |
| 3 | decision-log.ts: JSONL logger + reader | 20 min |
| 4 | crystallizer.ts: pattern mining + promotion | 45 min |
| 5 | stats.ts: coverage metrics | 20 min |
| 6 | index.ts: createMushi() wiring | 30 min |
| 7 | Tests: rules + crystallizer + integration | 45 min |
| 8 | README: finalize from draft | 15 min |
| 9 | npm publish prep: .npmrc, build script | 10 min |
| **Total** | | **~3.5h** |

---

## Success Criteria

```
echo '{"event":"heartbeat","context":{"idle_seconds":30,"changes":0}}' | npx mushi-kit triage
→ SKIP (0ms, rule: recently active, no changes)
```

User sees value in 5 seconds. That's the aha moment.

---

## Risks

1. **Over-extraction** — pulling too much mushi-specific logic. Mitigation: strict "is this useful to a stranger?" test.
2. **Crystallization quality** — bad patterns become permanent rules. Mitigation: conservative defaults (10+ occurrences, 95% consistency) + human-in-the-loop.
3. **Cold start** — no rules = 100% LLM initially. Not a bug — that's the starting point. But first-time experience matters.

---

## What This Unlocks

- **Dev.to story**: "The Rule Layer Ate My LLM" has a working demo, not just theory
- **Show HN**: `npx mushi-kit demo` → interactive playground
- **npm visibility**: Searchable package, not buried in a monolith
- **External validation**: Others can try → we learn if our n=1 generalizes
