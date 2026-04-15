/**
 * delegation-converter.draft — §6 Q-S3 ≤50-line converter proposal
 *
 * Status: DRAFT, not imported, not runtime-active.
 * Replaces src/delegation.ts at cutover (P1-d commit).
 *
 * Contract:
 *   <kuro:delegate> tag → DAG node → POST /plan → returns local taskId sync
 *
 * Preserves sync-string caller signature (dispatcher.ts x2, loop.ts x1).
 * Forge lifecycle stays Kuro-local (per §3 Q1). Middleware only spawns in cwd.
 *
 * Open questions for CC (unchanged from room msg pre-246):
 *   Q1 middleware base URL + port? (assumed http://localhost:??? below)
 *   Q2 POST /plan response shape — { planId, nodeIds } or flat { id }?
 *   Q3 result pull path — GET /plan/:id/result or async push to mini-agent?
 */

import type { DelegationTaskType, Provider } from './types.js';

// Local input shape — the runtime caller surface preserved at cutover.
// Real type lives in dispatcher.ts/loop.ts call sites; pin it down at P1-d wiring.
type DelegationTaskInput = {
  id?: string;
  type?: DelegationTaskType;
  prompt: string;
  workdir: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  provider?: Provider;
};

// TODO P1-d wiring: forgeCreate is currently private to delegation.ts.
// Either (a) export it, (b) inline the worktree creation via shell, or
// (c) move forge lifecycle to middleware. Choice pends §3 Q1 resolution.
declare function forgeCreate(taskId: string, workdir: string, taskType?: DelegationTaskType): string | null;

const MIDDLEWARE_PLAN_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:TODO/plan';

const CAPABILITY_DEFAULTS: Record<DelegationTaskType, {
  tools: string[]; maxTurns: number; timeoutMs: number; provider: Provider;
}> = {
  code:     { tools: ['Bash','Read','Write','Edit','Glob','Grep','LSP'], maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
  learn:    { tools: ['Bash','Read','Glob','Grep','WebFetch'],           maxTurns: 3, timeoutMs: 300_000, provider: 'local' },
  research: { tools: ['Bash','Read','Glob','Grep','WebFetch'],           maxTurns: 5, timeoutMs: 480_000, provider: 'local' },
  create:   { tools: ['Read','Write','Edit'],                            maxTurns: 5, timeoutMs: 480_000, provider: 'claude' },
  review:   { tools: ['Bash','Read','Glob','Grep'],                      maxTurns: 3, timeoutMs: 180_000, provider: 'claude' },
  shell:    { tools: [],                                                 maxTurns: 1, timeoutMs: 60_000,  provider: 'claude' },
  browse:   { tools: [],                                                 maxTurns: 1, timeoutMs: 180_000, provider: 'claude' },
  akari:    { tools: ['Bash','Read','Write','Edit','Glob','Grep','LSP'], maxTurns: 5, timeoutMs: 480_000, provider: 'claude' },
  plan:     { tools: ['Read','Glob','Grep'],                             maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
  debug:    { tools: ['Bash','Read','Glob','Grep','LSP'],                maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
};

export function spawnDelegation(task: DelegationTaskInput): string {
  const taskId = task.id ?? `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const capability = (task.type ?? 'code') as DelegationTaskType;
  const d = CAPABILITY_DEFAULTS[capability];
  const forgeCwd = task.type === 'code' ? forgeCreate(taskId, task.workdir, 'code') : null;
  const cwd = (forgeCwd ?? task.workdir).replace(/^~/, process.env.HOME ?? '');
  const node = {
    id: taskId, capability, prompt: task.prompt, cwd,
    tools: task.allowedTools ?? d.tools,
    maxTurns: task.maxTurns ?? d.maxTurns,
    timeoutMs: task.timeoutMs ?? d.timeoutMs,
    provider: task.provider ?? d.provider,
    sandbox: capability === 'code' ? 'landlock' : 'none',
  };
  fetch(MIDDLEWARE_PLAN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodes: [node], edges: [] }),
  }).catch(err => console.error('[delegation-converter] POST /plan failed', err));
  return taskId;
}
