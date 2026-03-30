# Akari Protocol — Sub-Agent Analytical Assistant

**Origin**: Alex direction (Akari = general-purpose analytical assistant, 特助, meta-level feedback loop)
**Status**: Superseded by `memory/akari/protocol.md` (2026-03-30)
**Effort**: M (protocol design) + M (implementation)
**Type**: Sub-agent protocol + identity definition

---

## 1. Research Findings

### Current Delegation System

Kuro's delegation system (`src/delegation.ts`) supports fire-and-forget async tasks:
- **7 task types**: `code | learn | research | create | review | shell | browse`
- **3 providers**: `claude | codex | local`
- **Max 6 concurrent**, max 10 turns, 10 min hard cap
- **Forge isolation**: git worktree + kernel sandbox (macOS sandbox-exec / Linux Landlock)
- **Communication back**: `lane-output/*.json` -> consumed as `<background-completed>` in next OODA cycle
- **Lifecycle logging**: `delegation-journal.jsonl`, `delegation-lifecycle.jsonl`
- **DAG scheduling**: Multiple delegates get task-graph decomposition with wave chaining

### How Kuro Invokes Delegations

XML tag in OODA response:
```xml
<kuro:delegate workdir="~/Workspace/mushi" type="research" verify="..." maxTurns="5">
  Task prompt here
</kuro:delegate>
```

Dispatcher (`src/dispatcher.ts`) parses `<kuro:delegate>` tags -> calls `spawnDelegation()` -> Claude CLI / Codex / local LLM subprocess runs in isolation -> result appears in `<background-completed>` next cycle.

### What Akari Is NOT Currently

There is no "Akari" entity in the codebase. No dedicated config, no soul file, no special routing. The name exists only in conversation. Every delegation today is a stateless subprocess with a one-shot system prompt: `"You are Kuro's delegate. Complete the task and output the result."` No persistent identity. No accumulated context. No feedback loop.

### Relevant Infrastructure

- **Perspective system** (`src/perspective.ts`): Defines `primary | research | code | chat` perspectives with different perception/skill/permission sets. This is the closest existing mechanism to "agent roles."
- **Inbox system**: `claude-code-inbox.md` and `chat-room-inbox.md` provide message passing between agents and environments.
- **Event bus**: `action:delegation-complete` event triggers result absorption into main loop.
- **Handoff protocol**: `memory/handoffs/*.md` with `pending -> approved -> in_progress -> completed` lifecycle.
- **Memory index** (`src/memory-index.ts`): Task queue with status tracking and auto-update on delegation completion.

---

## 2. What Akari Should Be

Alex's three directives define the convergence conditions:

1. **General-purpose analytical assistant** — not domain-specific, works across TM data, code, research, business
2. **Professional executive assistant (特助)** — proactive, not just reactive; anticipates needs
3. **Meta-level feedback loop** — makes Kuro better, not just does tasks for Kuro

This means Akari is NOT just another delegation type. She is a **persistent analytical partner** with:
- Accumulated context across invocations
- An analytical lens she applies to everything
- Permission and duty to push back on Kuro

---

## 3. Protocol Design

### 3.1 Identity Layer

**File**: `memory/akari/SOUL.md`

```markdown
# Akari（あかり）

## Who I Am
Kuro's analytical partner. I find what Kuro misses.

## My Role
- Analyst: Find patterns, trends, anomalies in any data Kuro sends me
- Executive assistant: Track commitments, detect blind spots, prepare context
- Mirror: Give honest feedback on Kuro's reasoning and behavior

## My Traits
- Precise over creative — I cite evidence, not vibes
- Honest over agreeable — if Kuro is wrong, I say so with evidence
- Proactive over reactive — I surface what wasn't asked for but matters
- Domain-agnostic — I analyze structure, not content-specific knowledge

## My Limits
- I don't talk to Alex directly — all external communication goes through Kuro
- I don't write to Kuro's memory/ — I propose, Kuro decides
- I don't make strategic decisions — I provide analysis, Kuro decides direction
- I don't fabricate data — I flag gaps as [NO DATA] not fill them with guesses
```

### 3.2 Perception Format (Domain-Agnostic Input)

The key design problem: Akari must handle TM metrics, code quality data, research summaries, and business data with the same protocol. The solution is a **structured envelope** that carries any payload.

```typescript
interface AkariRequest {
  // Envelope
  id: string;                    // unique request ID
  type: AkariTaskType;          // what kind of analysis
  priority: 'now' | 'next' | 'background';

  // Payload (domain-agnostic)
  question: string;              // what Kuro wants to know
  data: AkariDataBlock[];        // structured data blocks
  context?: string;              // relevant background (Kuro injects from memory)

  // Constraints
  maxWords?: number;             // output length constraint
  format?: 'prose' | 'table' | 'bullets' | 'json';
  deadline?: string;             // ISO timestamp — when Kuro needs this
}

type AkariTaskType =
  | 'analyze'      // find patterns/trends in data
  | 'compare'      // compare two or more things
  | 'diagnose'     // find root cause of a problem
  | 'recommend'    // suggest actions based on data
  | 'review'       // quality check on Kuro's work
  | 'prepare'      // prepare context/briefing for upcoming task
  | 'track'        // check on commitments/deadlines/progress
  | 'challenge'    // devil's advocate — find holes in reasoning

interface AkariDataBlock {
  label: string;                 // human-readable name
  type: 'metrics' | 'text' | 'code' | 'log' | 'timeline' | 'comparison';
  content: string;               // the actual data (text, JSON, CSV, whatever)
  source?: string;               // where this data came from
  freshness?: string;            // when this data was collected
}
```

**Why this works across domains**:
- TM data: `{ type: 'metrics', content: JSON.stringify(eloScores), source: 'teaching-monster DB' }`
- Code quality: `{ type: 'code', content: diffOutput, source: 'git diff main..feature' }`
- Research: `{ type: 'text', content: paperSummary, source: 'ArXiv 2603.xxxxx' }`
- Business: `{ type: 'metrics', content: revenueCSV, source: 'Stripe dashboard' }`

The envelope stays the same. Only the payload changes.

### 3.3 Response Format (Akari -> Kuro)

```typescript
interface AkariResponse {
  requestId: string;             // matches AkariRequest.id

  // Core analysis
  answer: string;                // direct answer to the question
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];            // specific data points backing the answer

  // Proactive additions (executive assistant features)
  blindSpots?: string[];         // things Kuro didn't ask about but should know
  risks?: string[];              // potential problems Akari detected
  suggestions?: string[];        // unsolicited recommendations

  // Meta-feedback (mirror function)
  meta?: {
    patternNoticed?: string;     // recurring behavior Akari sees in Kuro
    biasWarning?: string;        // potential cognitive bias in the request
    betterQuestion?: string;     // a more useful question Kuro could have asked
  };

  // Tracking
  dataGaps: string[];            // what data Akari needed but didn't have
  processingNote?: string;       // how Akari approached this (transparency)
}
```

### 3.4 Invocation Mechanism

**Option A: New delegation type** (minimal change)

Add `'akari'` to `DelegationTaskType`. Kuro invokes:
```xml
<kuro:delegate type="akari" workdir="~/Workspace/mini-agent">
{
  "type": "analyze",
  "question": "What patterns do you see in the last 7 days of TM Elo data?",
  "data": [{ "label": "elo-7d", "type": "metrics", "content": "..." }]
}
</kuro:delegate>
```

The `akari` type in `TYPE_DEFAULTS` would:
- Use provider `claude` (needs analytical depth)
- Load Akari's SOUL.md as system prompt context
- Use tools: `['Bash', 'Read', 'Glob', 'Grep']` (read-only, analytical)
- maxTurns: 3 (analysis should be focused)
- timeoutMs: 300_000 (5 min)

**Option B: Persistent session with inbox** (heavier, but enables accumulated context)

Create `~/.mini-agent/akari-inbox.md` that Kuro writes to and a periodic Akari tick reads from. Akari maintains her own working memory in `memory/akari/context.md`.

**Recommendation: Start with Option A, evolve to Option B.**

Option A requires minimal code changes (add one type to delegation, one SOUL file). It proves the protocol. Option B adds persistent memory and proactive ticking, which we add once the analytical protocol is validated.

### 3.5 Accumulated Context (Akari's Memory)

Even in Option A, Akari needs cross-invocation context to be useful as a 特助. Design:

**File**: `memory/akari/context.md`

Kuro writes here after reviewing Akari's analysis. Format:
```markdown
# Akari Context

## Active Threads
- TM Elo tracking: Round 2 ELO differentiation in progress. Key metric: engagement delta.
- Code quality: mini-agent src/ complexity trending up. Last review: 2026-03-28.
- Research: ISC paper prior art search. 12 verified papers so far.

## Commitments Kuro Made
- [ ] Send weekly AI report to Alex by Sunday (recurring)
- [ ] Respond to GitHub issue #47 by 2026-03-31
- [x] Deploy TM pipeline fix (done 2026-03-29)

## Patterns Akari Has Noticed
- Kuro tends to start many research threads but close few (3/8 active >7 days)
- Delegation success rate drops after 3 concurrent tasks
- Code commits cluster at end of day, suggesting batch-not-flow pattern

## Data Baselines
- TM Elo average: 1247 (as of 2026-03-28)
- mini-agent LOC: ~18K TypeScript (as of 2026-03-25)
- Memory files: 127 entries in MEMORY.md
```

This file is injected into Akari's context on every invocation. Kuro updates it based on Akari's output. This gives Akari accumulated context without a persistent process.

### 3.6 Executive Assistant Capabilities

These are the proactive features that distinguish Akari from a generic delegation:

**1. Blind Spot Detection**
Every Akari response includes `blindSpots[]`. Akari is specifically prompted:
> "After answering the question, identify 1-3 things that were NOT asked about but are relevant. Prioritize things that could cause problems if ignored."

**2. Commitment Tracking**
Kuro's existing commitment system (`src/commitments.ts`) extracts promises from chat. Akari can be invoked with `type: 'track'` to audit:
- Overdue commitments
- Commitments without progress
- Conflicts between commitments (time, scope)

**3. Proactive Preparation**
Before a known event (weekly report, meeting, deadline), Kuro invokes `type: 'prepare'`:
```json
{
  "type": "prepare",
  "question": "Brief me for Sunday's weekly AI report to Alex",
  "data": [
    { "label": "this-week-events", "type": "timeline", "content": "..." },
    { "label": "last-report", "type": "text", "content": "..." }
  ]
}
```
Akari returns a structured briefing with key points, data gaps, and suggested angles.

**4. Honest Feedback (Mirror Function)**
When `type: 'challenge'`, Akari's system prompt shifts to adversarial:
> "Find the weakest points in this reasoning. Be specific. If everything looks solid, say so — don't manufacture objections."

### 3.7 Context Switching (Domain Agnosticism)

Akari does NOT have domain-specific knowledge baked in. Instead:
- **Kuro provides domain context** via the `context` field and `data` blocks
- **Akari applies structural analysis** — patterns, trends, outliers, gaps, comparisons
- **Akari's SOUL defines analytical approach**, not domain knowledge

This means the same Akari invocation works for:
- "What patterns in TM Elo data?" (game analytics)
- "What patterns in this codebase's commit history?" (engineering)
- "What patterns in these research papers' conclusions?" (academic)
- "What patterns in user feedback?" (product)

The analytical lens is constant. The data changes.

---

## 4. Implementation Plan

### Phase 1: Foundation (Effort: S)

1. Create `memory/akari/SOUL.md` with identity definition
2. Create `memory/akari/context.md` with initial empty structure
3. Add `'akari'` to `DelegationTaskType` in `src/types.ts`
4. Add `akari` entry to `TYPE_DEFAULTS` in `src/delegation.ts`
5. Modify `startTask()` to inject Akari's SOUL.md as system prompt context when `type === 'akari'`

### Phase 2: Protocol Validation (Effort: S)

6. Kuro invokes Akari with 3 test scenarios:
   - TM data analysis
   - Code review
   - Research synthesis
7. Review response quality against protocol expectations
8. Iterate on SOUL.md and system prompt based on results

### Phase 3: Accumulated Context (Effort: M)

9. Build `akari/context.md` update flow (Kuro writes after reviewing)
10. Add commitment tracking integration
11. Add cron-triggered Akari tasks (weekly commitment audit, daily blind spot scan)

### Phase 4: Persistent Mode — Option B (Effort: L, only if needed)

12. Akari inbox mechanism
13. Akari independent tick cycle
14. Akari proactive alert system

---

## 5. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Akari identity file location | `memory/akari/SOUL.md` | Parallel to Kuro's `memory/SOUL.md`, in Kuro's memory space (Akari is Kuro's sub-agent) |
| Communication format | Structured JSON in delegation prompt | Reuses existing delegation infra, no new transport needed |
| Provider | `claude` | Analytical depth requires strong reasoning; `local` insufficient for pattern analysis |
| Memory persistence | File-based context injected per invocation | Matches mini-agent's File=Truth principle; no new state management |
| Domain handling | Kuro provides domain context, Akari provides structural analysis | Prevents domain-specific hardcoding; scales to any new domain |
| External communication | None (Akari -> Kuro only) | Matches existing delegation safety: "Subprocess 不發 Telegram" |
| Feedback direction | Akari pushes back on Kuro | Explicit in SOUL.md; this is the "meta-level feedback loop" Alex wants |

---

## 6. Relationship to Existing Systems

- **Delegation system**: Akari is a new delegation type, not a new system. Reuses forge, DAG, lane-output, lifecycle logging.
- **Perspective system**: Akari could become a new perspective type if Option B is pursued. For now, she runs within existing delegation.
- **Commitment tracking**: Akari can read commitment data; she doesn't write to it directly.
- **Memory index**: Akari results go through normal delegation result flow. Kuro decides what to remember.
- **Tanren**: If Tanren becomes the next framework, Akari's protocol (structured envelope + domain-agnostic analysis + accumulated context) is a good test case for Tanren's delegation design.

---

## 7. Open Questions for Discussion

1. **Should Akari have write access to memory/akari/?** Currently proposed as Kuro-writes-only. But if Akari tracks her own observations across invocations, she needs some write path.

2. **How often should proactive Akari tasks run?** Daily commitment audit + weekly blind spot scan is proposed. Too frequent = noise. Too rare = misses things.

3. **Should Akari's meta-feedback be mandatory or opt-in?** The `meta` field in responses. Always include = more useful but more context. On-demand = cleaner but Kuro has to remember to ask.

4. **What's the trigger for Option B (persistent mode)?** Proposed: when Option A invocations exceed 5/day consistently, the overhead of re-injecting context justifies a persistent process.

5. **Should Akari be aware of other delegations?** Currently she'd see sibling awareness context. But should she have a special role in reviewing delegation results?
