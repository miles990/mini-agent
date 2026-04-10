# Brain + Workers Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Kuro from single-threaded agent into "one brain, many workers" — brain plans, workers execute in parallel, results flow back.

**Architecture:**
Brain (Opus, stateful session) only plans/judges/synthesizes. Workers (subagents via Agent SDK) do research/code/review/shell in parallel. An Action Plan Engine (DAG scheduler) sits between brain and workers — brain produces a plan, engine validates and dispatches workers concurrently, results stream back.

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, existing mini-agent infrastructure. Tanren's `createAgentSdkProvider` as reference implementation.

---

## Phase Overview

```
Phase 1: Agent SDK Provider (replace spawn('claude') with SDK query())
Phase 2: Worker Pool (subagent definitions for each delegation type)
Phase 3: Action Plan Engine (DAG scheduler — brain plans, engine dispatches)
Phase 4: Brain Constraint (brain can only plan+dispatch, not directly execute)
Phase 5: Integration (wire into OODA loop, replace delegation.ts)
```

---

### Task 1: Agent SDK LLM Provider

**Files:**
- Create: `src/llm/agent-sdk.ts`
- Create: `src/llm/types.ts`
- Modify: `src/agent.ts` (add SDK path alongside existing subprocess)
- Modify: `package.json` (ensure `@anthropic-ai/claude-agent-sdk` is installed)

**Context:** Tanren already has a working Agent SDK provider at `/Users/user/Workspace/tanren/src/llm/agent-sdk.ts`. It uses `query()` with `permissionMode: 'bypassPermissions'`, subscription auth (no API key needed), and `systemPrompt` override for agent identity. We adapt this pattern for mini-agent.

**Step 1: Verify SDK dependency**

```bash
cd /Users/user/Workspace/mini-agent
grep "@anthropic-ai/claude-agent-sdk\|claude-code-sdk" package.json
# If missing: pnpm add @anthropic-ai/claude-agent-sdk
```

**Step 2: Create LLM provider interface**

Create `src/llm/types.ts`:
```typescript
/**
 * LLM Provider interface — abstraction over Claude CLI subprocess, Agent SDK, and local models.
 * Brain and workers use the same interface but different implementations.
 */
export interface LLMProvider {
  /** Single-turn: send prompt + system → get response string */
  think(prompt: string, systemPrompt: string): Promise<string>;
}

export interface AgentSdkProviderOptions {
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  additionalDirectories?: string[];
  mcpServers?: Record<string, unknown>;
  /** 'override' = agent's own identity, 'inherit-claude-code' = CC defaults + append */
  identityMode?: 'override' | 'inherit-claude-code';
  /** Agent SDK subagent definitions — enables brain to dispatch workers */
  agents?: Record<string, import('@anthropic-ai/claude-agent-sdk').AgentDefinition>;
  /** Permission callback for fine-grained tool control */
  canUseTool?: (toolName: string, input: Record<string, unknown>) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;
}
```

**Step 3: Create Agent SDK provider**

Create `src/llm/agent-sdk.ts` — adapted from Tanren's implementation with additions for subagents, streaming, and message tracking:

```typescript
import type { LLMProvider, AgentSdkProviderOptions } from './types.js';

export function createAgentSdkProvider(opts?: AgentSdkProviderOptions): LLMProvider {
  const identityMode = opts?.identityMode ?? 'override';

  return {
    async think(prompt: string, systemPrompt: string): Promise<string> {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const systemPromptOption = systemPrompt
        ? (identityMode === 'inherit-claude-code'
          ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemPrompt } }
          : { systemPrompt })
        : {};

      let result = '';

      for await (const message of query({
        prompt,
        options: {
          cwd: opts?.cwd ?? process.cwd(),
          additionalDirectories: opts?.additionalDirectories ?? [process.cwd()],
          allowedTools: opts?.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
          disallowedTools: opts?.disallowedTools,
          maxTurns: opts?.maxTurns,
          maxBudgetUsd: opts?.maxBudgetUsd ?? 10,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          ...systemPromptOption,
          ...(opts?.model ? { model: opts.model } : {}),
          ...(opts?.mcpServers ? { mcpServers: opts.mcpServers } : {}),
          ...(opts?.agents ? { agents: opts.agents } : {}),
        },
      })) {
        if ('result' in message && typeof message.result === 'string') {
          result = message.result;
        }
      }

      return result;
    },
  };
}
```

**Step 4: Add feature flag in agent.ts**

In `src/agent.ts`, add SDK path alongside existing `execClaude`:

```typescript
// At top of callClaude(), after provider detection:
if (provider === 'agent-sdk') {
  const { createAgentSdkProvider } = await import('./llm/agent-sdk.js');
  const sdkProvider = createAgentSdkProvider({
    model: options?.model,
    cwd: process.cwd(),
    identityMode: 'override',
  });
  const response = await sdkProvider.think(fullPrompt, systemPrompt);
  return { response, systemPrompt, fullPrompt, duration: Date.now() - startTs, preempted: false };
}
// ... existing execClaude path unchanged
```

**Step 5: Test with env flag**

```bash
AGENT_PROVIDER=agent-sdk mini-agent  # interactive test
# Or for specific lane:
AGENT_PROVIDER_FOREGROUND=agent-sdk mini-agent up
```

**Step 6: Commit**

```bash
git add src/llm/types.ts src/llm/agent-sdk.ts src/agent.ts
git commit -m "feat: add Agent SDK provider (feature flag: AGENT_PROVIDER=agent-sdk)"
```

---

### Task 2: Worker Definitions

**Files:**
- Create: `src/workers.ts`

**Context:** Workers are Agent SDK `AgentDefinition` objects — each has a description (when to use), tools (what it can do), prompt (identity), and model (cost/capability trade-off). The brain sees these as available tools and dispatches them via the `Agent` tool.

**Step 1: Define worker types**

Create `src/workers.ts`:

```typescript
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

/**
 * Worker definitions for the brain's subagent pool.
 * Each worker is a specialized agent with scoped tools and identity.
 * The brain dispatches workers via Agent tool — SDK handles lifecycle.
 */
export const WORKERS: Record<string, AgentDefinition> = {
  researcher: {
    description: 'Research a topic by reading URLs, searching the web, and reading files. Use for: gathering information, reading GitHub repos, analyzing articles, checking documentation. Returns a concise research summary.',
    tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash'],
    prompt: 'You are a research assistant. Read sources thoroughly, extract key facts, and return a concise summary (max 500 words). Cite sources. Never fabricate.',
    model: 'sonnet',
    maxTurns: 10,
  },

  coder: {
    description: 'Write, edit, or refactor code. Use for: implementing features, fixing bugs, writing scripts, modifying config files. Returns what was changed and verification results.',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    prompt: 'You are a coding assistant. Write clean, minimal code. Run tests after changes. Report what you changed and whether tests pass.',
    model: 'sonnet',
    maxTurns: 15,
  },

  reviewer: {
    description: 'Review code, documents, or proposals for quality and correctness. Use for: code review, proposal critique, fact checking. Returns structured feedback.',
    tools: ['Read', 'Grep', 'Glob'],
    prompt: 'You are a code/document reviewer. Read carefully, identify issues (bugs, logic errors, style problems), and provide specific, actionable feedback. Be honest.',
    model: 'haiku',
    maxTurns: 5,
  },

  shell: {
    description: 'Execute shell commands and report results. Use for: running tests, checking status, git operations, file system queries, curl requests.',
    tools: ['Bash', 'Read'],
    prompt: 'Execute the requested command(s) and report the output. If a command fails, report the error.',
    model: 'haiku',
    maxTurns: 3,
  },

  analyst: {
    description: 'Analyze data, compare options, or produce structured reports. Use for: architecture analysis, trade-off comparison, status reports, data synthesis from multiple sources.',
    tools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    prompt: 'You are an analyst. Read the provided data/context, identify patterns, and produce a structured analysis. Use tables and bullet points. Be opinionated — recommend a clear path.',
    model: 'sonnet',
    maxTurns: 8,
  },
};

/**
 * Get workers for brain's Agent SDK options.
 * Brain's allowedTools includes 'Agent' — SDK auto-discovers these definitions.
 */
export function getWorkerDefinitions(): Record<string, AgentDefinition> {
  return { ...WORKERS };
}
```

**Step 2: Commit**

```bash
git add src/workers.ts
git commit -m "feat: define worker subagent pool (researcher/coder/reviewer/shell/analyst)"
```

---

### Task 3: Action Plan Engine (DAG Scheduler)

**Files:**
- Create: `src/plan-engine.ts`

**Context:** The brain produces an action plan (structured JSON). The plan engine validates it, resolves dependencies, and dispatches workers in parallel waves. This is the core multi-threading mechanism.

**Step 1: Define plan types**

```typescript
/** A single step in an action plan */
export interface PlanStep {
  id: string;
  /** Which worker to use (from WORKERS) */
  worker: string;
  /** Task description for the worker */
  task: string;
  /** Steps that must complete before this one starts */
  dependsOn: string[];
  /** Timeout in seconds */
  timeoutSeconds?: number;
}

/** An action plan produced by the brain */
export interface ActionPlan {
  /** Human-readable goal */
  goal: string;
  /** Ordered steps with dependency graph */
  steps: PlanStep[];
}

/** Result of a completed step */
export interface StepResult {
  id: string;
  worker: string;
  status: 'completed' | 'failed' | 'timeout';
  output: string;
  durationMs: number;
}

/** Result of executing the full plan */
export interface PlanResult {
  goal: string;
  steps: StepResult[];
  totalDurationMs: number;
}
```

**Step 2: Implement DAG executor**

Create `src/plan-engine.ts`:

```typescript
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

/**
 * Action Plan Engine — DAG-based parallel execution of worker tasks.
 *
 * Brain produces plan → engine validates → dispatches in dependency waves → results flow back.
 *
 * Wave execution:
 *   Wave 0: steps with no dependencies (all run in parallel)
 *   Wave 1: steps depending only on Wave 0 (run when Wave 0 completes)
 *   ...
 *
 * Fail-fast: if a step fails and downstream steps depend on it, they're skipped.
 */
export class PlanEngine {
  private executeWorker: (worker: string, task: string, timeoutMs: number) => Promise<string>;

  constructor(workerExecutor: (worker: string, task: string, timeoutMs: number) => Promise<string>) {
    this.executeWorker = workerExecutor;
  }

  /** Validate plan: no cycles, valid workers, valid dependencies */
  validate(plan: ActionPlan, availableWorkers: Set<string>): string[] {
    const errors: string[] = [];
    const ids = new Set(plan.steps.map(s => s.id));

    for (const step of plan.steps) {
      if (!availableWorkers.has(step.worker)) {
        errors.push(`Step ${step.id}: unknown worker '${step.worker}'`);
      }
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          errors.push(`Step ${step.id}: depends on unknown step '${dep}'`);
        }
        if (dep === step.id) {
          errors.push(`Step ${step.id}: self-dependency`);
        }
      }
    }

    // Cycle detection (topological sort)
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stepMap = new Map(plan.steps.map(s => [s.id, s]));

    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const step = stepMap.get(id);
      if (step) {
        for (const dep of step.dependsOn) {
          if (hasCycle(dep)) return true;
        }
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    for (const step of plan.steps) {
      if (hasCycle(step.id)) {
        errors.push(`Cycle detected involving step '${step.id}'`);
        break;
      }
    }

    return errors;
  }

  /** Execute plan in dependency waves, returning all results */
  async execute(plan: ActionPlan): Promise<PlanResult> {
    const start = Date.now();
    const results = new Map<string, StepResult>();
    const stepMap = new Map(plan.steps.map(s => [s.id, s]));

    slog('PLAN', `Executing plan: "${plan.goal}" (${plan.steps.length} steps)`);
    eventBus.emit('log:info', { tag: 'plan-engine', msg: `Start: ${plan.goal} (${plan.steps.length} steps)` });

    // Execute in waves until all steps are done
    let wave = 0;
    while (results.size < plan.steps.length) {
      // Find ready steps: all dependencies completed successfully
      const ready = plan.steps.filter(s =>
        !results.has(s.id) &&
        s.dependsOn.every(dep => {
          const r = results.get(dep);
          return r && r.status === 'completed';
        })
      );

      // Find skipped steps: dependencies failed
      const skipped = plan.steps.filter(s =>
        !results.has(s.id) &&
        !ready.includes(s) &&
        s.dependsOn.some(dep => {
          const r = results.get(dep);
          return r && r.status !== 'completed';
        })
      );

      for (const s of skipped) {
        results.set(s.id, {
          id: s.id, worker: s.worker, status: 'failed',
          output: `Skipped: dependency failed`, durationMs: 0,
        });
      }

      if (ready.length === 0 && skipped.length === 0) break; // deadlock guard
      if (ready.length === 0) continue;

      slog('PLAN', `Wave ${wave}: ${ready.map(s => s.id).join(', ')} (${ready.length} parallel)`);

      // Execute wave in parallel
      const waveResults = await Promise.allSettled(
        ready.map(async (step) => {
          const stepStart = Date.now();
          const timeoutMs = (step.timeoutSeconds ?? 120) * 1000;
          try {
            const output = await this.executeWorker(step.worker, step.task, timeoutMs);
            return {
              id: step.id, worker: step.worker, status: 'completed' as const,
              output, durationMs: Date.now() - stepStart,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              id: step.id, worker: step.worker,
              status: msg.includes('timeout') ? 'timeout' as const : 'failed' as const,
              output: msg, durationMs: Date.now() - stepStart,
            };
          }
        })
      );

      for (const r of waveResults) {
        const result = r.status === 'fulfilled' ? r.value : {
          id: '?', worker: '?', status: 'failed' as const,
          output: r.reason?.message ?? 'unknown', durationMs: 0,
        };
        results.set(result.id, result);
        slog('PLAN', `  ${result.id} [${result.worker}] → ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`);
      }

      wave++;
    }

    const totalMs = Date.now() - start;
    slog('PLAN', `Plan complete: ${results.size} steps in ${(totalMs / 1000).toFixed(1)}s`);

    return {
      goal: plan.goal,
      steps: plan.steps.map(s => results.get(s.id)!),
      totalDurationMs: totalMs,
    };
  }
}
```

**Step 3: Commit**

```bash
git add src/plan-engine.ts
git commit -m "feat: action plan engine — DAG scheduler with parallel wave execution"
```

---

### Task 4: Brain Configuration (constrained Opus)

**Files:**
- Create: `src/brain.ts`

**Context:** The brain is an Agent SDK client configured to ONLY use the `Agent` tool (dispatching workers). It cannot directly Read/Write/Bash — forcing it to delegate all execution. It produces structured action plans that the plan engine executes.

**Step 1: Create brain module**

Create `src/brain.ts`:

```typescript
import { createAgentSdkProvider } from './llm/agent-sdk.js';
import { getWorkerDefinitions, WORKERS } from './workers.js';
import { PlanEngine, type ActionPlan, type PlanResult } from './plan-engine.js';
import { slog } from './utils.js';
import type { LLMProvider } from './llm/types.js';

/**
 * Brain — the planning/judging layer.
 *
 * Constraint Texture: brain can ONLY dispatch workers (Agent tool).
 * It cannot Read, Write, Bash, etc. directly. This is a framework-level
 * constraint that forces multi-threading by design.
 *
 * Two modes:
 * 1. Direct dispatch: brain calls Agent tool naturally during generation
 *    (SDK handles subagent lifecycle automatically)
 * 2. Plan mode: brain produces an ActionPlan JSON, plan engine validates
 *    and dispatches workers in parallel waves
 */

export interface BrainConfig {
  model?: string;
  cwd?: string;
  /** Additional tools beyond Agent (e.g. for reading memory) */
  additionalBrainTools?: string[];
  mcpServers?: Record<string, unknown>;
}

/**
 * Create a brain LLM provider — Opus with only Agent tool + optional memory tools.
 * Workers are auto-registered as subagent definitions.
 */
export function createBrain(config?: BrainConfig): LLMProvider {
  const workers = getWorkerDefinitions();

  // Brain's tools: Agent (for dispatching) + optional memory reading tools
  // NOT: Read, Write, Edit, Bash, Grep, Glob (those are for workers)
  const brainTools = [
    'Agent',
    ...(config?.additionalBrainTools ?? []),
  ];

  return createAgentSdkProvider({
    model: config?.model ?? 'opus',
    cwd: config?.cwd ?? process.cwd(),
    allowedTools: brainTools,
    agents: workers,
    identityMode: 'override',
    mcpServers: config?.mcpServers,
  });
}

/**
 * Create a plan engine wired to Agent SDK workers.
 * Each worker is invoked via a fresh SDK query() call.
 */
export function createPlanEngine(config?: BrainConfig): PlanEngine {
  const workerProviders = new Map<string, LLMProvider>();

  // Pre-create a provider per worker type (different model/tools/identity)
  for (const [name, def] of Object.entries(WORKERS)) {
    workerProviders.set(name, createAgentSdkProvider({
      model: def.model ?? 'sonnet',
      cwd: config?.cwd ?? process.cwd(),
      allowedTools: def.tools ?? ['Read', 'Grep', 'Glob'],
      maxTurns: def.maxTurns ?? 10,
      identityMode: 'override',
    }));
  }

  return new PlanEngine(async (workerName, task, timeoutMs) => {
    const provider = workerProviders.get(workerName);
    if (!provider) throw new Error(`Unknown worker: ${workerName}`);

    const workerDef = WORKERS[workerName];
    const result = await Promise.race([
      provider.think(task, workerDef.prompt ?? ''),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Worker ${workerName} timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    return result;
  });
}

/** Parse an ActionPlan from brain's response (expects JSON block) */
export function parseActionPlan(brainResponse: string): ActionPlan | null {
  // Look for ```json ... ``` or raw JSON
  const jsonMatch = brainResponse.match(/```json\s*([\s\S]*?)```/) ?? brainResponse.match(/(\{[\s\S]*"steps"[\s\S]*\})/);
  if (!jsonMatch) return null;

  try {
    const plan = JSON.parse(jsonMatch[1]) as ActionPlan;
    if (!plan.goal || !Array.isArray(plan.steps)) return null;
    // Normalize: ensure dependsOn is always an array
    for (const step of plan.steps) {
      step.dependsOn = step.dependsOn ?? [];
    }
    return plan;
  } catch {
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add src/brain.ts
git commit -m "feat: brain module — constrained Opus that can only plan and dispatch workers"
```

---

### Task 5: Integration with OODA Loop

**Files:**
- Modify: `src/loop.ts` (add brain+plan mode to cycle)
- Modify: `src/dispatcher.ts` (new tag: `<kuro:plan>`)

**Context:** The brain integrates into the existing OODA loop as an alternative execution mode. When `AGENT_PROVIDER=agent-sdk`, the main cycle uses the brain instead of raw `callClaude`. The brain can either:
1. Respond directly via Agent tool (simple tasks)
2. Produce an `<kuro:plan>` tag with a structured ActionPlan → plan engine executes it

**Step 1: Add plan tag to dispatcher**

In `src/dispatcher.ts`, add `<kuro:plan>` to parseTags:

```typescript
// In parseTags(), add:
const planMatch = response.match(/<kuro:plan>([\s\S]*?)<\/kuro:plan>/);
const plan = planMatch ? planMatch[1].trim() : null;
// Add to ParsedTags interface:
plan: string | null;
```

**Step 2: Add brain execution path in loop.ts**

In the main cycle, after context building and before `callClaude`:

```typescript
// Feature flag: use brain+workers instead of raw callClaude
const useBrain = getProvider() === 'agent-sdk' || process.env.USE_BRAIN === '1';

if (useBrain) {
  const { createBrain, createPlanEngine, parseActionPlan } = await import('./brain.js');
  const brain = createBrain({ cwd: process.cwd() });
  const engine = createPlanEngine({ cwd: process.cwd() });

  // Brain thinks (may dispatch workers directly via Agent tool, or produce a plan)
  const brainResponse = await brain.think(prompt, systemPrompt);

  // Check for structured plan
  const plan = parseActionPlan(brainResponse);
  if (plan) {
    const errors = engine.validate(plan, new Set(Object.keys(WORKERS)));
    if (errors.length === 0) {
      const planResult = await engine.execute(plan);
      // Feed results back to brain for synthesis
      const synthesisPrompt = `Plan "${plan.goal}" executed. Results:\n${
        planResult.steps.map(s => `[${s.id}] ${s.worker}: ${s.status}\n${s.output.slice(0, 1000)}`).join('\n\n')
      }\n\nSynthesize the results and respond to the user.`;
      response = await brain.think(synthesisPrompt, systemPrompt);
    } else {
      slog('PLAN', `Plan validation failed: ${errors.join(', ')}`);
      response = brainResponse; // fallback to direct response
    }
  } else {
    response = brainResponse;
  }
} else {
  // Existing callClaude path (unchanged)
  ...
}
```

**Step 3: Commit**

```bash
git add src/loop.ts src/dispatcher.ts
git commit -m "feat: integrate brain+plan into OODA loop (feature flag: USE_BRAIN=1)"
```

---

### Task 6: Tanren Shared Orchestration

**Files:**
- Modify: `src/plan-engine.ts` (export for Tanren consumption)
- Create: `src/index.ts` exports

**Context:** The plan engine and worker definitions should be importable by Tanren. Tanren already has Agent SDK integration — it just needs the DAG scheduler and worker pool.

**Step 1: Export from package**

In `src/index.ts`, add:
```typescript
// Brain + Workers architecture
export { PlanEngine, type ActionPlan, type PlanStep, type PlanResult, type StepResult } from './plan-engine.js';
export { WORKERS, getWorkerDefinitions } from './workers.js';
export { createBrain, createPlanEngine, parseActionPlan } from './brain.js';
export { createAgentSdkProvider, type AgentSdkProviderOptions } from './llm/agent-sdk.js';
export type { LLMProvider } from './llm/types.js';
```

**Step 2: Tanren integration example**

Tanren can import the plan engine:
```typescript
// In tanren's loop or action handler:
import { PlanEngine, getWorkerDefinitions } from 'mini-agent';
// Or copy the relevant files if not published as npm package
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export brain/workers/plan-engine for cross-framework use"
```

---

## Key Design Decisions

### Brain's allowed tools
- `Agent` (mandatory — dispatches workers)
- Optional: `WebFetch` (brain may need to glance at URLs before deciding what to research deeply)
- NOT: `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob` (worker-only tools)

### Pluggable Worker Backends

Workers are NOT locked to Agent SDK — the plan engine uses a `WorkerExecutor` interface. Three backend options:

```
Plan Engine (DAG scheduler)
  ├─ Agent SDK subagent   → in-process, fast, for simple focused tasks
  ├─ ACP session (OpenAB) → cross-CLI, for tasks needing Kiro/Codex/Gemini
  └─ Shell                → direct bash, zero LLM overhead
```

```typescript
/** Worker executor — plan engine doesn't care HOW workers run, only that they return a string */
type WorkerExecutor = (worker: string, task: string, timeoutMs: number) => Promise<string>;
```

Each worker definition can specify its backend:
```typescript
export interface WorkerDefinition {
  // ... existing fields (description, tools, prompt, model) ...
  /** Execution backend (default: 'sdk') */
  backend: 'sdk' | 'acp' | 'shell';
  /** For ACP backend: which CLI to use */
  acpCommand?: string;  // 'claude' | 'kiro-cli' | 'codex' | 'gemini'
}
```

**When to use each**:
- **SDK subagent**: most tasks (research, code, review) — in-process, low latency
- **ACP session**: tasks benefiting from different CLI capabilities (e.g. Kiro for exploration, Codex for OpenAI-specific), or when observability matters (Discord thread via OpenAB)
- **Shell**: pure command execution (git, curl, grep) — zero LLM, zero token cost

**ACP integration path**: OpenAB provides the ACP↔Discord bridge. We can either:
1. Run OpenAB locally as a daemon and send tasks via its API
2. Implement ACP JSON-RPC directly (lighter, no Discord dependency)
3. Use OpenAB's session pool for lifecycle management but skip Discord

### Plan format (brain produces this)
```json
{
  "goal": "Research jiexi.page and give Alex feedback",
  "steps": [
    { "id": "fetch", "worker": "researcher", "task": "Read https://jiexi.page and summarize structure + content", "dependsOn": [], "backend": "sdk" },
    { "id": "analyze", "worker": "analyst", "task": "Given the research, produce design critique with ISC lens", "dependsOn": ["fetch"], "backend": "sdk" },
    { "id": "check-mobile", "worker": "shell", "task": "curl -sf https://jiexi.page | wc -c && grep viewport", "dependsOn": [], "backend": "shell" }
  ]
}
```
Wave 0: `fetch`(SDK) + `check-mobile`(shell) in parallel → Wave 1: `analyze`(SDK) depends on fetch

### Rollback plan
- Feature flag `AGENT_PROVIDER=agent-sdk` / `USE_BRAIN=1` — old path unchanged
- Can revert by unsetting env vars
- No existing code modified destructively
