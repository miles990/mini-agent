#!/usr/bin/env node
// verify-brain-context.mjs — smoke test BrainRuntime shared context injection.
//
// Usage:
//   pnpm verify:brain-context
//   node scripts/verify-brain-context.mjs --keep-open
//
// The test intentionally stops after observing context_injected. It verifies the
// wiring without waiting for real providers to finish a full delegation.

import process from 'node:process';

const MEMORY_DIR = './memory';
const TIMEOUT_MS = flagNumber('--timeout-ms', 90_000);
const KEEP_OPEN = process.argv.includes('--keep-open');

process.env.MINI_AGENT_DELEGATION_RUNTIME = '1';

const [
  { spawnDelegation },
  { appendBrainRunEvent, readBrainRunEventsSync, readBrainRunStatesSync },
] = await Promise.all([
  import('../dist/delegation.js'),
  import('../dist/brain-run-ledger.js'),
]);

const taskId = `smoke-myelin-context-${Date.now()}`;
spawnDelegation({
  id: taskId,
  type: 'review',
  prompt: 'Smoke test only: confirm that delegated brain context was received. Do not modify files.',
  workdir: process.cwd(),
  timeoutMs: 60_000,
  maxTurns: 1,
  acceptance: 'A read-only one-sentence confirmation is produced.',
  context: 'E2E smoke test for BrainRuntime myelin context injection observability.',
});

const deadline = Date.now() + TIMEOUT_MS;
let lastEvents = [];
while (Date.now() < deadline) {
  const events = readBrainRunEventsSync(MEMORY_DIR, { taskId, limit: 50 });
  const injected = events.filter(event => event.event === 'context_injected');
  if (injected.length > 0) {
    const event = injected[0];
    const preview = event.contextPreview ?? [];
    const ok = event.contextSources?.includes('myelin') && preview.length > 0;
    if (!ok) {
      console.error(JSON.stringify({ ok: false, taskId, reason: 'context_injected missing myelin preview', event }, null, 2));
      if (!KEEP_OPEN) closeSyntheticRun(appendBrainRunEvent, taskId, event.primary ?? null);
      process.exit(2);
    }

    if (!KEEP_OPEN) closeSyntheticRun(appendBrainRunEvent, taskId, event.primary ?? null);
    console.log(JSON.stringify({
      ok: true,
      taskId,
      actor: event.actor,
      mode: event.mode,
      contextSources: event.contextSources,
      contextPreview: preview,
    }, null, 2));
    process.exit(0);
  }
  lastEvents = events;
  await sleep(1000);
}

console.error(JSON.stringify({
  ok: false,
  taskId,
  reason: `timed out after ${TIMEOUT_MS}ms waiting for context_injected`,
  events: lastEvents,
  states: readBrainRunStatesSync(MEMORY_DIR, { taskId, limit: 20 }),
}, null, 2));
if (!KEEP_OPEN) closeSyntheticRun(appendBrainRunEvent, taskId, null);
process.exit(1);

function closeSyntheticRun(appendEvent, taskIdToClose, primary) {
  const common = {
    taskId: taskIdToClose,
    mode: 'race',
    primary,
  };
  appendEvent(MEMORY_DIR, {
    ...common,
    event: 'actor_finished',
    status: 'failed',
    actor: 'claude',
    role: 'primary',
    detail: 'smoke harness stopped after verifying context injection',
  });
  appendEvent(MEMORY_DIR, {
    ...common,
    event: 'actor_finished',
    status: 'skipped',
    actor: 'codex',
    role: 'reviewer',
    detail: 'smoke harness stopped before reviewer run',
  });
  appendEvent(MEMORY_DIR, {
    ...common,
    event: 'runtime_finished',
    status: 'failed',
    detail: 'smoke test verified context_injected, then closed synthetic run',
  });
}

function flagNumber(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const parsed = Number(process.argv[idx + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
