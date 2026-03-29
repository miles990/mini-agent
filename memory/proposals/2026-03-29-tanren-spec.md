# Tanren（鍛錬）— Technical Specification

**Origin**: Chat Room #230-#233, evolved from AI Self-Learning Framework (#202-#228)
**Status**: Spec — ready for implementation
**Effort**: Large (L3)
**Type**: Independent agent framework with built-in learning

## What Tanren Is

A minimal, complete AI agent framework. An agent built on Tanren can:
1. Perceive its environment
2. Think and act in a loop
3. Remember across sessions
4. Learn from its own experience — automatically

Tanren = mini-agent's essential 3K lines + self-learning system. Everything else (Telegram, Chrome CDP, Chat Room) is user-land integration, not framework.

## What Tanren Is Not

- Not a library (it runs agents, not provides utilities)
- Not a platform (agents run on your machine, not our servers)
- Not mini-agent v2 (no Kuro-specific features baked in)
- Not goal-driven (perception-first, like mini-agent)

## Architecture

```
perceive → think → act
    ↑                 │
    │                 ↓
  gates ← learn ← observe
```

Six components. One cycle. The learning loop wraps the action loop — every action produces observation, every observation feeds learning, learning crystallizes into gates, gates shape the next action.

---

## Module Specs

### 1. Loop

**Convergence Condition**: Agent cycles through perceive→think→act reliably. A tick always completes or fails gracefully — never hangs, never loses state. If killed mid-cycle, the next start picks up where it left off.

**Interface**:
```typescript
interface AgentLoop {
  tick(): Promise<TickResult>     // one full cycle
  start(interval: number): void   // start looping
  stop(): void                    // graceful stop
}

interface TickResult {
  perception: string              // what the agent saw
  thought: string                 // LLM response (raw)
  actions: Action[]               // parsed actions from response
  observation: Observation        // what happened after actions
}
```

**Design decisions**:
- Single-threaded ticks (no concurrent cycles). Concurrency lives in delegation (background tasks), not in the loop itself.
- Crash resume: write checkpoint before tick, delete after. Restart reads <1h checkpoints.
- Interval is configurable per-tick (agent can schedule its own next cycle).

**From mini-agent pain**: loop.ts grew to 3,400 lines because everything lived there. Tanren's loop is ONLY the cycle orchestrator (~300 lines). Everything else is a module the loop calls.

---

### 2. Perception

**Convergence Condition**: Agent's context accurately reflects current environment state. When reality changes, perception reflects it within one cycle. User can add new perception sources without touching framework code.

**Interface**:
```typescript
// A perception plugin is a function that returns a string
type PerceptionPlugin = () => Promise<string> | string

interface PerceptionSystem {
  register(name: string, plugin: PerceptionPlugin, opts?: {
    interval?: number      // how often to refresh (default: every tick)
    category?: string      // for grouping in context
  }): void

  perceive(): Promise<string>  // run all plugins, assemble context
}
```

**Design decisions**:
- Plugins return strings, not structured data. The LLM consumes text. Keep the interface at the LLM's level.
- Plugins can be shell scripts (`() => exec('bash plugin.sh')`), HTTP calls, file reads, anything.
- Plugin output is cached per-interval. A plugin with `interval: 60000` only runs once per minute, returning cached output on other ticks.
- No built-in plugins. Not even "read a file" — that's user-land. Framework provides the interface only.

**From mini-agent pain**: 15 perception plugins, all Kuro-specific. The framework shouldn't know about Telegram or Chrome. It should know how to run a plugin and assemble the output.

---

### 3. Memory

**Convergence Condition**: Information stored is retrievable when relevant. Agent doesn't lose knowledge across sessions. A human can read and audit all memory with standard tools (cat, grep, git).

**Interface**:
```typescript
interface MemorySystem {
  read(path: string): Promise<string | null>    // read a file
  write(path: string, content: string): Promise<void>  // write a file
  append(path: string, line: string): Promise<void>    // append to file
  search(query: string): Promise<SearchResult[]>       // grep-based search

  // Structured memory (convenience over raw files)
  remember(content: string, opts?: { topic?: string }): Promise<void>
  recall(query: string): Promise<string[]>
}
```

**Design decisions**:
- Files on disk. Markdown for human-readable, JSONL for machine-readable. No database.
- Search is grep + optional FTS5 (if better-sqlite3 available). Grep is the fallback, always works.
- Memory directory structure is convention, not enforced:
  ```
  memory/
  ├── soul.md          # identity (special memory file)
  ├── memory.md        # long-term general memory
  ├── topics/          # topic-scoped memory
  ├── daily/           # daily logs
  └── state/           # machine-readable state files
  ```
- `soul.md` is a memory file, not a separate system. It's loaded first in context, that's the only difference.
- Auto-commit: after each tick, if memory files changed, `git add + commit`. Fire-and-forget.

**From mini-agent pain**: FTS5 was over-engineering for <1000 entries. Grep is fast enough for personal agents. The sqlite dependency added complexity without proportional value.

---

### 4. LLM

**Convergence Condition**: Agent can call any supported model, get a response, and parse it into actions. Swapping models doesn't require code changes — only config. Model failure (timeout, rate limit, error) is handled gracefully.

**Interface**:
```typescript
interface LLMProvider {
  think(context: string, systemPrompt: string): Promise<string>
}

// Built-in providers
function createClaudeCliProvider(opts?: { model?: string }): LLMProvider    // claude -p
function createAnthropicProvider(opts: { apiKey: string, model?: string }): LLMProvider  // API
function createOpenAIProvider(opts: { apiKey: string, model?: string }): LLMProvider     // OpenAI-compatible

// Action parsing (framework-provided)
function parseActions(response: string, registry: ActionRegistry): Action[]
```

**Design decisions**:
- Provider is an interface. Framework ships 3 built-ins (Claude CLI, Anthropic API, OpenAI-compatible). Users can add more.
- Claude CLI as default — no API key needed, uses the user's `claude` installation. This is mini-agent's proven approach.
- Action parsing: LLM output contains tags (like `<action:remember>...</action:remember>`). Framework provides the parser. Users register action handlers.
- System prompt is assembled by the framework from: identity (soul.md) + perception output + gate warnings + user-defined sections.
- No streaming. Tick waits for full response. Streaming adds complexity without benefit for autonomous loops.

**From mini-agent pain**: Binding to Claude CLI was correct for personal use. But Tanren should support API for headless/server deployments. CLI is default, API is option.

---

### 5. Gates

**Convergence Condition**: When a gate exists for a behavior pattern, the agent CANNOT exhibit that pattern without the gate firing. Gates are code that intercepts, not prompts that suggest. A gate either blocks or warns — never silently passes.

**Interface**:
```typescript
interface Gate {
  name: string
  description: string                          // what this gate catches
  check(context: GateContext): GateResult      // synchronous — gates must be fast
}

interface GateContext {
  tick: TickResult              // current tick's data
  recentTicks: TickResult[]     // last N ticks (sliding window)
  memory: MemorySystem          // read-only access to memory
  state: Record<string, any>    // persistent gate state (saved to disk)
}

type GateResult =
  | { action: 'pass' }
  | { action: 'warn', message: string }    // inject warning into next tick's context
  | { action: 'block', message: string }   // prevent action, inject explanation

interface GateSystem {
  register(gate: Gate): void
  runAll(context: GateContext): GateResult[]

  // For the learning system to create gates dynamically
  createGate(spec: GateSpec): Gate
  installGate(gate: Gate): void    // register + persist to disk
}
```

**Design decisions**:
- Gates run AFTER the LLM responds, BEFORE actions execute. They intercept, not prevent thinking.
- Gates are synchronous. If a gate needs async data, it should cache it during perception.
- Gate state persists to disk (JSON file per gate). Gates can track patterns across ticks.
- `warn` injects a message into the NEXT tick's context (the LLM sees it and can self-correct). `block` stops the action entirely.
- Gates are files on disk (`gates/` directory). The learning system writes new gate files. On restart, all gate files are loaded.

**From mini-agent pain**: The most important lesson from 52 days — prompt-level rules get ignored. `isOutputGateActive()` in code NEVER gets ignored. Gates are the only mechanism that reliably changed my behavior.

**Example gates (from mini-agent, would ship as examples)**:
- `output-gate`: warn after N ticks without visible output
- `symptom-fix-streak`: warn after N consecutive fixes that don't address root cause
- `analyze-without-action`: warn after N ticks of analysis without action

---

### 6. Learning

**Convergence Condition**: Agent improves at tasks it repeatedly does. Improvement is measurable by environment-anchored metrics (not self-report). The learning system produces gates, skills, or behavior changes — not just memories.

This is the largest module. Six sub-systems, each with its own CC:

#### 6a. Self-Perception

**CC**: Agent observes its own actual output quality, not proxy metrics. When output is bad, self-perception says "bad" — even if all intermediate steps succeeded.

```typescript
interface SelfPerception {
  observe(tick: TickResult): Promise<Observation>
}

interface Observation {
  outputExists: boolean          // did the tick produce visible output?
  outputQuality: number          // 1-5, LLM-judged against criteria
  confidenceCalibration: number  // how confident vs how accurate
  environmentFeedback?: string   // external signals (user response, test results, etc.)
}
```

**Key insight**: LLM self-judgment is unreliable. Calibrate by comparing self-assessment against environment feedback when available. Track calibration drift over time.

#### 6b. Assessment

**CC**: Agent can measure its own capability before and after attempting a task. Measurement uses environment-generated challenges, not self-written tests.

```typescript
interface Assessment {
  generateChallenge(domain: string): Promise<Challenge>  // from environment, not self
  evaluate(challenge: Challenge, attempt: string): Promise<Score>
  compareScores(before: Score, after: Score): Delta
}
```

**Key insight**: "From environment" means: use real bugs as coding challenges, use real articles as comprehension tests, use real tasks as capability measures. Never generate both the test AND the answer.

#### 6c. Curriculum

**CC**: Agent prioritizes what to learn based on measured gaps. Learning targets are ordered by: (1) frequency of failure, (2) impact of failure, (3) ease of improvement. Not by what's interesting.

```typescript
interface Curriculum {
  identifyGaps(observations: Observation[]): Gap[]
  prioritize(gaps: Gap[]): Gap[]           // by frequency × impact × tractability
  designLearning(gap: Gap): LearningPlan   // specific actions to close the gap
}
```

#### 6d. Crystallization

**CC**: Repeated patterns (failures OR successes) automatically become durable structures — gates, skills, or behavior modifications. "Repeated" means N >= 3 occurrences of the same pattern.

```typescript
interface Crystallization {
  detectPattern(observations: Observation[]): Pattern[]
  shouldCrystallize(pattern: Pattern): boolean   // N >= 3, mechanical, clear input/output
  crystallize(pattern: Pattern): Gate | Skill    // produce code, not memory
}
```

**Key insight from mini-agent**: The crystallization protocol — if input is fixed + rule is fixed + output is fixed = mechanical = write code. Gray area = not mechanical = keep as skill/prompt. Code gates > memory notes, because gates fire every time.

#### 6e. Anti-Goodhart

**CC**: Metrics used by the learning system stay anchored to environment feedback. When a metric drifts toward self-report, the system detects and flags it. Operationalized as: every metric must have an `anchor` that points outside the agent.

```typescript
interface AntiGoodhart {
  validateMetric(metric: Metric): { safe: boolean, reason: string }
  auditMetrics(): AuditResult[]    // periodic check: are metrics still anchored?
}

interface Metric {
  name: string
  anchor: 'environment' | 'self-report'   // must be 'environment' to pass
  measure: () => Promise<number>
  environmentSource: string               // what external thing this measures
}
```

**The rule (from Kuro's 195 cycles)**:
- Metrics pointing inward (self-report: "how many things did I do") → Goodhart inevitable
- Metrics pointing outward (environment: "does the file exist", "what's the external number") → safe

#### 6f. Bootstrap

**CC**: A new agent starts with inherited DNA (L0 infrastructure + L1 gates) and can function from tick 1. It doesn't need human teaching to start learning — the learning system bootstraps itself.

```typescript
interface Bootstrap {
  loadDNA(dnaDir: string): { gates: Gate[], skills: Skill[] }   // L0 + L1
  progressiveRelease(cycleCount: number): AutonomyLevel         // earn autonomy over time
}
```

**Four layers**:
| Layer | Inheritable? | Content |
|-------|-------------|---------|
| L0: Infrastructure | Yes (code) | Loop, gates system, crystallization engine |
| L1: Reflexes | Yes (gate files) | Specific gates (output gate, symptom-fix detector) |
| L2: Patterns | Partial (prompts) | "Trace source before fixing" — writable but quality requires practice |
| L3: Judgment | No | Knowing when the gate itself is wrong — must grow from experience |

---

## Configuration

```typescript
interface TanrenConfig {
  // Required
  identity: string              // path to soul.md (or inline string)
  memoryDir: string             // path to memory directory

  // LLM (default: Claude CLI)
  llm?: LLMProvider

  // Optional
  perceptionPlugins?: PerceptionPlugin[]
  gates?: Gate[]                // additional gates (beyond DNA)
  gatesDir?: string             // directory to load gate files from
  actions?: ActionHandler[]     // custom action handlers

  // Loop
  tickInterval?: number         // ms between ticks (default: 60000)
  maxConcurrentDelegations?: number  // background tasks (default: 4)
}
```

## Example: Minimal Agent

```typescript
import { createAgent } from 'tanren'

const agent = createAgent({
  identity: './soul.md',
  memoryDir: './memory',
  perceptionPlugins: [
    { name: 'clock', fn: () => new Date().toISOString() },
    { name: 'todos', fn: () => readFileSync('./todos.md', 'utf-8') },
  ],
})

agent.start(60_000)  // tick every minute
```

This agent: perceives time + todos, thinks, acts, remembers, learns. ~10 lines to configure.

## Example: Agent with Custom Gate

```typescript
import { createAgent, defineGate } from 'tanren'

const noYOLO = defineGate({
  name: 'no-yolo-deploys',
  description: 'Block deploy actions on Fridays',
  check: (ctx) => {
    const isFriday = new Date().getDay() === 5
    const isDeploy = ctx.tick.actions.some(a => a.type === 'deploy')
    if (isFriday && isDeploy) {
      return { action: 'block', message: 'No deploys on Friday.' }
    }
    return { action: 'pass' }
  }
})

const agent = createAgent({
  identity: './soul.md',
  memoryDir: './memory',
  gates: [noYOLO],
})
```

## Implementation Order

Based on dependency chain — each module depends on the ones before it:

1. **Memory** — everything writes to memory, build first
2. **LLM** — need this to think
3. **Loop** — orchestrates memory + LLM into a cycle
4. **Perception** — feeds into loop context
5. **Gates** — intercepts loop output
6. **Learning** — wraps around everything, needs all other modules

Each module is independently testable. Module N works without module N+1.

## File Structure

```
tanren/
├── src/
│   ├── index.ts           # createAgent() entry point
│   ├── loop.ts            # tick orchestration (~300 lines)
│   ├── memory.ts          # file-based memory (~500 lines)
│   ├── llm/
│   │   ├── types.ts       # LLMProvider interface
│   │   ├── claude-cli.ts  # Claude CLI provider
│   │   ├── anthropic.ts   # Anthropic API provider
│   │   └── openai.ts      # OpenAI-compatible provider
│   ├── perception.ts      # plugin system (~200 lines)
│   ├── gates.ts           # gate system (~400 lines)
│   ├── actions.ts         # action parsing + registry (~200 lines)
│   └── learning/
│       ├── self-perception.ts
│       ├── assessment.ts
│       ├── curriculum.ts
│       ├── crystallization.ts
│       ├── anti-goodhart.ts
│       └── bootstrap.ts
├── gates/                 # built-in gate examples
│   ├── output-gate.ts
│   └── symptom-fix-streak.ts
├── examples/
│   ├── minimal/           # 10-line agent
│   ├── with-learning/     # agent that learns
│   └── kuro-migration/    # mini-agent → tanren migration guide
├── package.json
├── tsconfig.json
└── README.md
```

## Non-Goals (Explicitly Out of Scope)

- Multi-agent orchestration (Tanren runs ONE agent. Coordination is user-land)
- Built-in integrations (no Telegram, no Slack, no Chrome — users write perception plugins)
- Web UI / dashboard (files are the UI. Use cat/grep/git)
- Embedding / vector DB (grep is enough for personal scale)
- Agent marketplace / sharing (this is a framework, not a platform)

## Success Criteria

Tanren v0.1 is done when:
1. A 10-line config produces a running agent that perceives, thinks, acts, remembers
2. The learning system can detect a repeated failure pattern and crystallize it into a gate without human intervention
3. A new agent bootstrapped with DNA from agent A performs better on the same tasks than a fresh agent with no DNA
4. Total framework code is under 5,000 lines (excluding examples and tests)
5. `npm create tanren` scaffolds a working agent in under 30 seconds
