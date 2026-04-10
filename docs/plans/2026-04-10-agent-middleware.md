# Agent 中台（Middleware）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an agent-agnostic middleware layer that handles action planning, worker dispatch, and session management — so any AI agent (Kuro, Akari, future agents) only needs to think, while the middleware handles all execution.

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│  前台 · Front (Agents)                           │
│  Kuro (mini-agent) │ Akari (tanren) │ Future...  │
│  → 認知、規劃、判斷、身份                          │
└────────────────┬────────────────────────────────┘
                 │ POST /plan, /dispatch, /status
┌────────────────▼────────────────────────────────┐
│  中台 · Middleware (Agent-Agnostic)               │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │ Plan Engine  │  │ ACP Gateway  │  │ Result  │ │
│  │ DAG Scheduler│  │ Session Pool │  │ Buffer  │ │
│  │ Wave Exec    │  │ CLI Registry │  │ Events  │ │
│  └──────┬───┬──┘  └──────┬───────┘  └────▲────┘ │
│         │   │            │                │      │
│  ┌──────▼───▼────────────▼────────────────┤      │
│  │         Worker Executor (pluggable)     │      │
│  ├─ SDK subagent (in-process, fast)       ─┤      │
│  ├─ ACP session (cross-CLI, observable)   ─┤      │
│  └─ Shell (zero LLM, direct exec)        ─┘      │
│                                                   │
└───────────────────────────────────────────────────┘
                 │ perception, events, cron
┌────────────────▼────────────────────────────────┐
│  後台 · Backend (Infrastructure Daemon)           │
│  HTTP Server │ Perception │ Event Bus │ Cron     │
│  → 永遠在線，不隨 agent 起落                       │
└─────────────────────────────────────────────────┘
```

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, ACP JSON-RPC (optional), Hono (HTTP framework)

**Repo:** `agent-middleware` — 獨立 repo，不綁任何 agent。Kuro/Akari/Alex/第三方都是 client。溝通協定 = HTTP API + SSE，任何語言都能接。

```
github.com/miles990/agent-middleware  ← 中台（本計劃）
github.com/miles990/mini-agent        ← Kuro（client）
github.com/miles990/tanren            ← Akari runtime（client）
```

---

## Phase Overview

```
Task 1: LLM Provider Interface + Agent SDK Provider
Task 2: Worker Definitions (pluggable backends)
Task 3: Plan Engine (DAG Scheduler)
Task 4: ACP Gateway (Session Pool + CLI Registry)
Task 5: Result Buffer + Event Stream
Task 6: Middleware HTTP API
Task 7: Brain Module (constrained agent)
Task 8: OODA Loop Integration (wire Kuro to middleware)
Task 9: Tanren Integration (wire Akari to middleware)
```

---

### Task 1: LLM Provider Interface + Agent SDK Provider

**Files:**
- Create: `src/middleware/llm-provider.ts`
- Create: `src/middleware/sdk-provider.ts`

**Step 1: Create provider interface**

Create `src/middleware/llm-provider.ts`:
```typescript
/**
 * LLM Provider — abstraction over execution backends.
 * Brain and workers both use this interface.
 */
export interface LLMProvider {
  think(prompt: string, systemPrompt: string): Promise<string>;
}
```

**Step 2: Create Agent SDK provider**

Create `src/middleware/sdk-provider.ts`:
```typescript
import type { LLMProvider } from './llm-provider.js';

export interface SdkProviderOptions {
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  agents?: Record<string, import('@anthropic-ai/claude-agent-sdk').AgentDefinition>;
  identityMode?: 'override' | 'inherit-claude-code';
}

export function createSdkProvider(opts?: SdkProviderOptions): LLMProvider {
  const identityMode = opts?.identityMode ?? 'override';
  return {
    async think(prompt: string, systemPrompt: string): Promise<string> {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const sysOpt = systemPrompt
        ? (identityMode === 'inherit-claude-code'
          ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemPrompt } }
          : { systemPrompt })
        : {};

      let result = '';
      for await (const msg of query({
        prompt,
        options: {
          cwd: opts?.cwd ?? process.cwd(),
          allowedTools: opts?.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
          disallowedTools: opts?.disallowedTools,
          maxTurns: opts?.maxTurns,
          maxBudgetUsd: opts?.maxBudgetUsd ?? 10,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          ...sysOpt,
          ...(opts?.model ? { model: opts.model } : {}),
          ...(opts?.agents ? { agents: opts.agents } : {}),
        },
      })) {
        if ('result' in msg && typeof msg.result === 'string') result = msg.result;
      }
      return result;
    },
  };
}
```

**Step 3: Commit**
```bash
git add src/middleware/
git commit -m "feat(middleware): LLM provider interface + Agent SDK provider"
```

---

### Task 2: Worker Definitions (pluggable backends)

**Files:**
- Create: `src/middleware/workers.ts`

**Step 1: Define worker types with backend selection**

Create `src/middleware/workers.ts`:
```typescript
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

export type WorkerBackend = 'sdk' | 'acp' | 'shell';

export interface WorkerDefinition {
  /** AgentDefinition for SDK backend (description, tools, prompt, model) */
  agent: AgentDefinition;
  /** Execution backend */
  backend: WorkerBackend;
  /** For ACP: which CLI command */
  acpCommand?: string;
  /** Default timeout in seconds */
  defaultTimeoutSeconds: number;
}

export const WORKERS: Record<string, WorkerDefinition> = {
  researcher: {
    agent: {
      description: 'Research a topic: read URLs, search web, read files. Returns concise summary.',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash'],
      prompt: 'You are a research assistant. Read thoroughly, extract key facts, return concise summary (max 500 words). Cite sources. Never fabricate.',
      model: 'sonnet',
      maxTurns: 10,
    },
    backend: 'sdk',
    defaultTimeoutSeconds: 120,
  },

  coder: {
    agent: {
      description: 'Write, edit, or refactor code. Returns what changed and test results.',
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
      prompt: 'You are a coding assistant. Write clean, minimal code. Run tests after changes. Report changes and test status.',
      model: 'sonnet',
      maxTurns: 15,
    },
    backend: 'sdk',
    defaultTimeoutSeconds: 180,
  },

  reviewer: {
    agent: {
      description: 'Review code/documents for quality. Returns structured feedback.',
      tools: ['Read', 'Grep', 'Glob'],
      prompt: 'You are a reviewer. Read carefully, identify issues, provide specific actionable feedback.',
      model: 'haiku',
      maxTurns: 5,
    },
    backend: 'sdk',
    defaultTimeoutSeconds: 60,
  },

  shell: {
    agent: {
      description: 'Execute shell commands. For: tests, git ops, curl, file queries.',
      tools: ['Bash', 'Read'],
      prompt: 'Execute the command(s) and report output. Report errors if any.',
      model: 'haiku',
      maxTurns: 3,
    },
    backend: 'shell',
    defaultTimeoutSeconds: 30,
  },

  analyst: {
    agent: {
      description: 'Analyze data, compare options, produce structured reports.',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch'],
      prompt: 'You are an analyst. Identify patterns, produce structured analysis with tables. Be opinionated — recommend a clear path.',
      model: 'sonnet',
      maxTurns: 8,
    },
    backend: 'sdk',
    defaultTimeoutSeconds: 120,
  },

  explorer: {
    agent: {
      description: 'Explore a codebase or system. For: understanding architecture, finding files, mapping dependencies.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      prompt: 'You are a codebase explorer. Map the structure, find key files, understand architecture. Report findings concisely.',
      model: 'haiku',
      maxTurns: 10,
    },
    backend: 'sdk',
    defaultTimeoutSeconds: 60,
  },
};

/** Get AgentDefinitions for brain's SDK options (SDK workers only) */
export function getSdkAgentDefinitions(): Record<string, AgentDefinition> {
  const defs: Record<string, AgentDefinition> = {};
  for (const [name, w] of Object.entries(WORKERS)) {
    if (w.backend === 'sdk') defs[name] = w.agent;
  }
  return defs;
}
```

**Step 2: Commit**
```bash
git add src/middleware/workers.ts
git commit -m "feat(middleware): worker definitions with pluggable backends (sdk/acp/shell)"
```

---

### Task 3: Plan Engine (DAG Scheduler)

**Files:**
- Create: `src/middleware/plan-engine.ts`

**Step 1: Define plan types**

```typescript
/** A single step in an action plan */
export interface PlanStep {
  id: string;
  worker: string;
  task: string;
  dependsOn: string[];
  /** Override backend for this step */
  backend?: 'sdk' | 'acp' | 'shell';
  timeoutSeconds?: number;
}

export interface ActionPlan {
  goal: string;
  steps: PlanStep[];
}

export interface StepResult {
  id: string;
  worker: string;
  status: 'completed' | 'failed' | 'timeout' | 'skipped';
  output: string;
  durationMs: number;
}

export interface PlanResult {
  goal: string;
  steps: StepResult[];
  totalDurationMs: number;
  /** Summary: how many succeeded/failed/skipped */
  summary: { completed: number; failed: number; skipped: number };
}
```

**Step 2: Implement DAG executor**

Create `src/middleware/plan-engine.ts` with:
- `validate(plan, availableWorkers)` — check cycles, unknown workers, unknown deps
- `execute(plan)` — wave-based parallel execution
- Wave algorithm: find steps whose deps are all completed → run in parallel → repeat

Core execute loop:
```typescript
async execute(plan: ActionPlan): Promise<PlanResult> {
  const results = new Map<string, StepResult>();
  let wave = 0;

  while (results.size < plan.steps.length) {
    // Ready: all deps completed
    const ready = plan.steps.filter(s =>
      !results.has(s.id) &&
      s.dependsOn.every(d => results.get(d)?.status === 'completed')
    );
    // Skipped: any dep failed
    const skipped = plan.steps.filter(s =>
      !results.has(s.id) && !ready.includes(s) &&
      s.dependsOn.some(d => results.has(d) && results.get(d)!.status !== 'completed')
    );
    for (const s of skipped) {
      results.set(s.id, { id: s.id, worker: s.worker, status: 'skipped', output: 'Dependency failed', durationMs: 0 });
    }
    if (ready.length === 0) break;

    // Execute wave in parallel
    const waveResults = await Promise.allSettled(ready.map(s => this.runStep(s)));
    for (const r of waveResults) {
      const res = r.status === 'fulfilled' ? r.value : { id: '?', worker: '?', status: 'failed' as const, output: String(r.reason), durationMs: 0 };
      results.set(res.id, res);
    }
    wave++;
  }

  const steps = plan.steps.map(s => results.get(s.id)!);
  return {
    goal: plan.goal, steps, totalDurationMs: Date.now() - start,
    summary: {
      completed: steps.filter(s => s.status === 'completed').length,
      failed: steps.filter(s => s.status === 'failed').length,
      skipped: steps.filter(s => s.status === 'skipped').length,
    },
  };
}
```

**Step 3: Commit**
```bash
git add src/middleware/plan-engine.ts
git commit -m "feat(middleware): plan engine — DAG scheduler with wave-parallel execution"
```

---

### Task 4: ACP Gateway (Session Pool + CLI Registry)

**Files:**
- Create: `src/middleware/acp-gateway.ts`

**Context:** The ACP Gateway manages CLI sessions. Each CLI backend (Claude Code, Kiro, Codex, Gemini) can have warm sessions ready. Tasks are dispatched to sessions via ACP JSON-RPC over stdio.

**Step 1: Define types**

```typescript
export interface CLIBackend {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  maxSessions: number;
}

export interface SessionInfo {
  id: string;
  backend: string;
  pid: number;
  status: 'idle' | 'busy' | 'dead';
  createdAt: Date;
  lastActivityAt: Date;
}
```

**Step 2: Implement session pool**

Create `src/middleware/acp-gateway.ts`:
- `CLIRegistry` — register available backends (claude, kiro, codex, gemini)
- `SessionPool` — per-backend pool of warm sessions
  - `acquire(backend)` → get idle session or spawn new
  - `release(session)` → mark idle
  - `cleanup()` → kill stale sessions
- `dispatch(backend, task, timeout)` → acquire session → send task via stdin → collect result → release
- Health check: ping sessions every 60s, auto-restart dead ones

Initial implementation: start with Claude Code only (we know it works). Add Kiro/Codex/Gemini as future plugins.

```typescript
const DEFAULT_BACKENDS: CLIBackend[] = [
  {
    name: 'claude',
    command: 'claude',
    args: ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json'],
    maxSessions: 3,
  },
];
```

**Step 3: Commit**
```bash
git add src/middleware/acp-gateway.ts
git commit -m "feat(middleware): ACP gateway — session pool with CLI registry"
```

---

### Task 5: Result Buffer + Event Stream

**Files:**
- Create: `src/middleware/result-buffer.ts`

**Context:** Workers complete asynchronously. Results are buffered so any agent can poll for them. Events stream via SSE for real-time observability.

**Step 1: Implement result buffer**

```typescript
export interface TaskRecord {
  id: string;
  planId?: string;
  worker: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  result?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
}

export class ResultBuffer {
  private tasks = new Map<string, TaskRecord>();
  private listeners = new Set<(event: TaskRecord) => void>();

  submit(task: Omit<TaskRecord, 'status'>): string { ... }
  update(id: string, status: TaskRecord['status'], result?: string): void { ... }
  get(id: string): TaskRecord | undefined { ... }
  list(filter?: { planId?: string; status?: string }): TaskRecord[] { ... }

  /** SSE: subscribe to task state changes */
  subscribe(listener: (event: TaskRecord) => void): () => void { ... }
}
```

**Step 2: Commit**
```bash
git add src/middleware/result-buffer.ts
git commit -m "feat(middleware): result buffer + event subscription for task tracking"
```

---

### Task 6: Middleware HTTP API

**Files:**
- Create: `src/middleware/api.ts`

**Context:** Unified API that any agent can call. Runs as part of the daemon HTTP server (existing `src/api.ts`), or as standalone service.

**Step 1: Define routes**

```typescript
// POST /api/middleware/dispatch — dispatch a single task
// { worker: 'researcher', task: '...', backend?: 'sdk', timeout?: 120 }
// → { taskId: 'task-xxx', status: 'pending' }

// POST /api/middleware/plan — submit an action plan (DAG)
// { goal: '...', steps: [...] }
// → { planId: 'plan-xxx', validation: 'ok', steps: N }

// GET /api/middleware/status/:id — task status
// → { id, worker, status, result?, durationMs? }

// GET /api/middleware/plan/:id — plan status + all step results
// → { goal, steps: [...], summary: { completed, failed, skipped } }

// GET /api/middleware/pool — session pool status
// → { backends: [{ name, sessions, idle, busy }] }

// GET /api/middleware/events — SSE stream of task events
// → data: { type: 'task.started' | 'task.completed' | 'task.failed', task: {...} }
```

**Step 2: Wire into existing api.ts**

In `src/api.ts`, mount middleware routes:
```typescript
import { createMiddlewareRouter } from './middleware/api.js';
app.use('/api/middleware', createMiddlewareRouter(planEngine, resultBuffer, acpGateway));
```

**Step 3: Commit**
```bash
git add src/middleware/api.ts src/api.ts
git commit -m "feat(middleware): HTTP API — dispatch/plan/status/pool/events endpoints"
```

---

### Task 7: Brain Module

**Files:**
- Create: `src/middleware/brain.ts`

**Context:** Brain = constrained Opus that can only plan and dispatch. Uses middleware API to execute plans.

**Step 1: Create brain**

```typescript
import { createSdkProvider } from './sdk-provider.js';
import { getSdkAgentDefinitions } from './workers.js';
import type { LLMProvider } from './llm-provider.js';

export function createBrain(config?: { model?: string; cwd?: string }): LLMProvider {
  return createSdkProvider({
    model: config?.model ?? 'opus',
    cwd: config?.cwd ?? process.cwd(),
    // Brain can ONLY dispatch — no direct file/shell access
    allowedTools: ['Agent'],
    agents: getSdkAgentDefinitions(),
    identityMode: 'override',
  });
}

/** Parse ActionPlan JSON from brain response */
export function parsePlan(response: string): ActionPlan | null {
  const match = response.match(/```json\s*([\s\S]*?)```/) ?? response.match(/(\{[\s\S]*"steps"[\s\S]*\})/);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1]);
    if (!plan.goal || !Array.isArray(plan.steps)) return null;
    for (const s of plan.steps) s.dependsOn ??= [];
    return plan;
  } catch { return null; }
}
```

**Step 2: Commit**
```bash
git add src/middleware/brain.ts
git commit -m "feat(middleware): brain module — constrained Opus, Agent tool only"
```

---

### Task 8: Kuro Integration (wire mini-agent to middleware)

**Files:**
- Modify: `src/agent.ts` (add middleware/brain path)
- Modify: `src/loop.ts` (brain mode in OODA cycle)

**Step 1: Add brain execution path in agent.ts**

```typescript
// Feature flag: USE_BRAIN=1 or AGENT_PROVIDER=agent-sdk
if (useBrain) {
  const { createBrain } = await import('./middleware/brain.js');
  const brain = createBrain({ cwd: process.cwd() });
  const response = await brain.think(fullPrompt, systemPrompt);
  return { response, systemPrompt, fullPrompt, duration: Date.now() - startTs };
}
```

**Step 2: Add plan detection in loop.ts**

After brain response, check for `<kuro:plan>` tag → parse → validate → execute via middleware API → feed results back to brain for synthesis.

**Step 3: Commit**
```bash
git add src/agent.ts src/loop.ts
git commit -m "feat: wire Kuro brain to middleware (feature flag: USE_BRAIN=1)"
```

---

### Task 9: Tanren Integration

**Files:**
- Modify: Tanren's loop.ts or config

**Context:** Tanren already has Agent SDK provider. Wire it to the middleware API so Akari can also dispatch plans.

**Step 1: Tanren calls middleware API for delegation**

In Tanren's delegate action, instead of `await llm.think(subPrompt, subSystem)`:
```typescript
// Option A: HTTP call to middleware
const res = await fetch('http://localhost:3001/api/middleware/dispatch', {
  method: 'POST',
  body: JSON.stringify({ worker: 'researcher', task }),
});
const { taskId } = await res.json();
// Poll for result
const result = await pollResult(taskId);

// Option B: Import middleware directly (if same machine)
import { PlanEngine } from 'mini-agent/middleware';
```

**Step 2: Commit**
```bash
# In tanren repo
git commit -m "feat: wire Akari to mini-agent middleware for delegation"
```

---

## Design Principles

| Principle | How |
|-----------|-----|
| **Agent-agnostic** | Middleware API doesn't know who's calling — Kuro, Akari, or curl |
| **Pluggable workers** | SDK / ACP / Shell — plan step specifies backend |
| **Fail-fast DAG** | Dependency fails → downstream skipped, not stuck |
| **Observable** | Every task has status, SSE event stream, result buffer |
| **Brain constraint** | `allowedTools: ['Agent']` — framework-level, not prompt-level |
| **Crash isolation** | Middleware runs in daemon — agent crash doesn't kill workers |
| **Rollback** | Feature flag `USE_BRAIN=1` — old path unchanged |

## File Structure

```
src/middleware/
├── llm-provider.ts     — interface
├── sdk-provider.ts     — Agent SDK implementation
├── workers.ts          — worker definitions (6 types)
├── plan-engine.ts      — DAG scheduler
├── acp-gateway.ts      — session pool + CLI registry
├── result-buffer.ts    — task tracking + SSE events
├── brain.ts            — constrained Opus
└── api.ts              — HTTP routes (/dispatch, /plan, /status, /pool, /events)
```
