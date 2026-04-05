# Hermes Capability Absorption Plan

Date: 2026-04-05
Source: NousResearch/hermes-agent (25.4k stars, 462k lines Python)
Target: mini-agent (85 files, 44.6k lines TypeScript)

## CT Framing

**Convergence Condition**: mini-agent can autonomously learn from every interaction, create reusable skills, and maintain safety — without human intervention for routine operations.

**Current gap**: We have the back half of the learning loop (crystallization, application) but not the front half (detection, trigger, capture). And we have zero security scanning on memory writes.

## Gap Analysis

### Critical Gaps (Hermes has, we don't)

| # | Capability | Hermes Implementation | Mini-agent Status | Leverage |
|---|-----------|----------------------|-------------------|----------|
| 1 | Memory injection scanning | 12 threat patterns + invisible unicode on every write | **None** — all input trusted | CRITICAL |
| 2 | Nudge loop (auto-trigger) | Counter per N iterations → background review agent | Missing — rely on pulse (reactive, not proactive) | HIGH |
| 3 | Skill CRUD | `skill_manage` tool: create/edit/patch/delete | Read-only — human authorship only | HIGH |
| 4 | Frozen memory snapshot | Load once at session start, never change system prompt | System prompt changes every cycle | MEDIUM |
| 5 | Structured compaction | 5-phase with orphan pair sanitization + iterative summary | Minimal (77 lines) | MEDIUM |
| 6 | Trust-level policy | 4-level (builtin/trusted/community/agent-created) | No trust differentiation | MEDIUM |
| 7 | SSRF protection | Private IP + CGNAT + metadata endpoint blocking | None | LOW |

### Our Advantages (keep and strengthen)

| Capability | Why it's better |
|-----------|----------------|
| Perception-driven architecture | Environment-first vs goal-first — fundamentally different paradigm |
| Pulse system | Multi-layer behavioral feedback — Hermes has nothing like this |
| Myelin crystallization | LLM teaches rules then exits loop — Hermes keeps LLM in loop forever |
| Context profiles | 6 tiers based on trigger — Hermes has one size fits all |
| oMLX Gate | Skip LLM calls when unchanged — Hermes has no equivalent |
| OS-level delegation sandbox | macOS sandbox-exec / Linux Landlock — Hermes trusts subagents |
| Organic parallelism | 7 delegation types with differentiated toolsets |

## Implementation Phases

### Phase 1: Security Foundation — Memory Injection Scanning
**New file**: `src/content-scanner.ts`
- Threat patterns (prompt injection, exfiltration, credential access, invisible unicode)
- Integrate into: `appendMemory()`, `appendTopicMemory()`, `appendDailyNote()`, tag parsing for `<kuro:remember>`
- Trust levels: `system` (built-in), `user` (Alex), `agent` (Kuro-generated), `external` (delegation results)
- Blocked content logged + event emitted

### Phase 2: Self-Learning Loop — Nudge Loop + Skill CRUD
**Nudge loop** (`src/nudge-loop.ts`):
- Counter: track tool calls / cycles since last skill review
- Every N cycles (configurable, default 10): trigger background review
- Review delegation: fork Claude with conversation snapshot + review prompt
- Review prompt asks: "Was there a non-trivial approach worth saving as a skill?"

**Skill CRUD** (extend `src/skill-system.ts`):
- New tag: `<kuro:skill op="create|edit|delete" name="...">`
- Create: write SKILL.md with frontmatter to skills directory
- Edit: update existing skill content
- Delete: remove skill file
- All writes pass through content scanner (Phase 1)
- New skills get trust level `agent-created`

### Phase 3: Frozen Context Snapshot
**Approach**: Separate system prompt into stable prefix (SOUL, memory, skills) + dynamic suffix (perceptions, tasks)
- Stable prefix loaded once per session, cached
- Dynamic suffix updated each cycle
- Cache key: hash of stable prefix
- Benefit: Anthropic prefix caching saves ~90% on stable portion

### Phase 4: Trust-Level Policy
**Policy matrix**: what each trust level can do
- `system`: unrestricted (built-in skills)
- `user`: unrestricted (Alex-authored)
- `agent-created`: sandboxed execution, no file system access beyond memory/
- `external`: content-scanned, no execution

## Execution Order

Phase 1 first — it's the security foundation everything else depends on.
Phase 2 immediately after — it's the highest leverage (completes the learning loop).
Phase 3 and 4 can be parallel or sequential.
