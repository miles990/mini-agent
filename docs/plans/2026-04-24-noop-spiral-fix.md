# Noop Spiral Fix — Task Hygiene + Idle Mode + Small-Creation Ladder

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Kuro's noop spiral (action rate 11-31%) by breaking the feedback loop: stale tasks → hasPendingWork=true → R4 bypass + MUST injection → noop → more stale tasks.

**Architecture:** Three-layer fix: (1) Task hygiene — aggressive cleanup + hasPendingWork priority filter + hard cap, (2) Idle mode — new CycleMode with low-pressure prompt template and Small-Creation Ladder, (3) Drift detection — prevent idle from becoming comfortable noop. All changes in 5 files: `housekeeping.ts`, `loop.ts`, `prompt-builder.ts`, `memory.ts` (CycleMode type), `memory-index.ts`.

**Tech Stack:** TypeScript strict mode, no new dependencies.

**KG Discussion:** `2ef3d8db` (8 positions, claude-code + kuro + akari consensus)

---

## Task 1: Aggressive Task Cleanup — Tighten Housekeeping Thresholds

**Files:**
- Modify: `src/housekeeping.ts:506-534` (Layer 3 decay thresholds)

**Context:** Current Layer 3 thresholds are `in_progress >30d` and `pending >14d`. With 40 active tasks, these are too lenient. Akari recommended decay with auto-archive. We tighten to `in_progress >14d` and `pending >7d`.

**Step 1: Modify Layer 3 decay thresholds in cleanStaleTasks()**

In `src/housekeeping.ts`, find the Layer 3 section (line ~526):

```typescript
// BEFORE:
const threshold = task.status === 'in_progress' ? 30 * DAY_MS : 14 * DAY_MS;

// AFTER:
const threshold = task.status === 'in_progress' ? 14 * DAY_MS : 7 * DAY_MS;
```

Also fix the label on line ~531 to match:
```typescript
// BEFORE:
const label = task.status === 'in_progress' ? 'in_progress >14d' : 'pending >7d';

// AFTER:
const label = task.status === 'in_progress' ? 'in_progress >14d' : 'pending >7d';
```
(Label already matches — no change needed for label.)

**Step 2: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS (no type changes)

**Step 3: Commit**

```bash
git add src/housekeeping.ts
git commit -m "fix(housekeeping): tighten task decay thresholds (30d→14d, 14d→7d)

Addresses noop spiral root cause: 40 stale tasks keep hasPendingWork()
permanently true. Tighter decay breaks the feedback loop.

KG discussion: 2ef3d8db"
```

---

## Task 2: hasPendingWork() Priority Filter — Only P0/P1 Counts

**Files:**
- Modify: `src/loop.ts:1308-1331` (hasPendingWork method)
- Modify: `src/memory-index.ts:861-868` (add priority-filtered query)

**Context:** Currently `hasPendingWork()` returns true for ANY pending task (P0-P2). This means HEARTBEAT always has tasks → hasPendingWork always true → R4 bypass + MUST injection. Akari agreed: P0/P1 as Stage 1 filter, P2+ doesn't block learn/explore/idle.

**Step 1: Add getHighPriorityPendingCount() to memory-index.ts**

After `getPendingTaskPreviews()` (line ~868), add:

```typescript
/** Count only P0/P1 pending tasks — P2+ don't block learn/explore/idle */
export function getHighPriorityPendingCount(memDir: string): number {
  const tasks = queryMemoryIndexSync(memDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  });
  return tasks.filter(t => getTaskPriority(t) <= 1).length;
}
```

**Step 2: Update hasPendingWork() in loop.ts**

Replace the memory-index check (line ~1317-1322):

```typescript
// BEFORE:
// Check memory-index for ANY pending tasks (P0-P2) — todo list exists to be done
const memDir = path.join(process.cwd(), 'memory');
const pendingTasks = getPendingTaskPreviews(memDir);
if (pendingTasks.length > 0) {
  return true;
}

// AFTER:
// Only P0/P1 tasks count as "pending work" — P2+ don't block learn/explore/idle
const memDir = path.join(process.cwd(), 'memory');
const highPriCount = getHighPriorityPendingCount(memDir);
if (highPriCount > 0) {
  return true;
}
```

**Step 3: Add import in loop.ts**

Add `getHighPriorityPendingCount` to the import from `./memory-index.js` (find existing imports from memory-index near the top of loop.ts).

**Step 4: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/loop.ts src/memory-index.ts
git commit -m "fix(loop): hasPendingWork only counts P0/P1 tasks

P2+ tasks no longer block learn/explore/idle mode or bypass R4
context-hash dedup. Breaks the feedback loop where 40 stale P2
tasks kept hasPendingWork() permanently true.

KG discussion: 2ef3d8db (Akari position #6/#8)"
```

---

## Task 3: Task Hard Cap — Auto-Archive Overflow

**Files:**
- Modify: `src/housekeeping.ts` (add cap enforcement in cleanStaleTasks)

**Context:** Akari recommended hard cap 10-15. We implement cap=15: when active tasks exceed 15, lowest-priority + oldest tasks get auto-archived.

**Step 1: Add hard cap enforcement after Layer 3 in cleanStaleTasks()**

After the Layer 3 section (line ~534), before Layer 4, add:

```typescript
  // --- Layer 3.5: Hard cap — archive overflow tasks (lowest priority + oldest first) ---
  const ACTIVE_TASK_CAP = 15;
  const remainingActive = (dryRun ? activeTasks : queryMemoryIndexSync(memDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  })).filter(t => !results.some(r => r.id === t.id && (r.action === 'abandoned' || r.action === 'completed')));

  if (remainingActive.length > ACTIVE_TASK_CAP) {
    const sorted = remainingActive
      .sort((a, b) => {
        const pa = getTaskPriority(a);
        const pb = getTaskPriority(b);
        if (pa !== pb) return pb - pa; // lower priority first (higher number = lower priority)
        return new Date(a.ts).getTime() - new Date(b.ts).getTime(); // older first
      });

    const toArchive = sorted.slice(0, remainingActive.length - ACTIVE_TASK_CAP);
    for (const task of toArchive) {
      const payload = (task.payload ?? {}) as Record<string, unknown>;
      if (payload.pinned) continue;
      if (!dryRun) {
        await updateMemoryIndexEntry(memDir, task.id, { status: 'abandoned' }).catch(() => {});
      }
      results.push({
        layer: 3.5 as unknown as number,
        id: task.id,
        summary: task.summary ?? task.id,
        action: 'abandoned',
        reason: `hard cap overflow (${remainingActive.length} > ${ACTIVE_TASK_CAP})`,
      });
    }
  }
```

**Step 2: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/housekeeping.ts
git commit -m "feat(housekeeping): hard cap 15 active tasks, auto-archive overflow

Lowest priority + oldest tasks archived first when count exceeds 15.
Prevents task accumulation that feeds noop spiral.

KG discussion: 2ef3d8db (Akari: cap 10-15, decay + prioritize)"
```

---

## Task 4: Add 'idle' CycleMode + Idle Prompt Template

**Files:**
- Modify: `src/memory.ts:155` (CycleMode type)
- Modify: `src/prompt-builder.ts:88-111` (detectCycleMode)
- Modify: `src/prompt-builder.ts` (add idle prompt builder function)
- Modify: `src/prompt-builder.ts:175,221` (MUST → conditional guidance)

**Context:** Core of the fix. When no P0/P1 tasks and no external signal, enter idle mode with low-pressure prompt (no MUST, no 7-field Decision block). Includes Small-Creation Ladder items.

**Step 1: Add 'idle' to CycleMode type**

In `src/memory.ts`, line 155:

```typescript
// BEFORE:
export type CycleMode = 'learn' | 'act' | 'task' | 'respond' | 'reflect';

// AFTER:
export type CycleMode = 'learn' | 'act' | 'task' | 'respond' | 'reflect' | 'idle';
```

**Step 2: Update detectCycleMode() to detect idle**

In `src/prompt-builder.ts`, modify `detectCycleMode()` (lines 88-111):

```typescript
export function detectCycleMode(
  context: string,
  triggerReason: string | null,
  consecutiveLearnCycles: number,
  options?: { hasPendingTasks?: boolean; hasHighPriorityTasks?: boolean },
): CycleMode {
  // User interaction → respond (all skills)
  if (triggerReason?.startsWith('telegram-user')
    || triggerReason?.startsWith('room')
    || triggerReason?.startsWith('chat')
    || triggerReason?.startsWith('direct-message')) return 'respond';

  // ALERT or overdue tasks → task mode
  if (context.includes('ALERT:') || context.includes('overdue')) return 'task';

  // Only P0/P1 tasks trigger task mode
  if (options?.hasHighPriorityTasks) return 'task';

  // Consecutive learn cycles → nudge toward act/reflect
  if (consecutiveLearnCycles >= 3) return 'act';

  // No high-priority work + heartbeat/workspace trigger → idle mode
  if (triggerReason?.startsWith('heartbeat') || triggerReason?.startsWith('workspace')) return 'idle';

  // Default: learn
  return 'learn';
}
```

**Step 3: Add buildIdlePrompt() function**

Add a new function in `src/prompt-builder.ts` (before the small-model prompt section, around line 256):

```typescript
/** Idle mode prompt — low-pressure, zero context reload, artifact-required */
export function buildIdlePrompt(): string {
  const LADDER_ITEMS = [
    'Write a short journal entry (≤5 lines) — what you noticed, felt, or found interesting recently',
    'Tag or update one memory entry — find the oldest one in <topics> and mark if outdated',
    'Leave a comment on a KG discussion node — one observation or connection you see',
    'Read one topic/*.md entry and note one contradiction or outdated point',
    'Write a 50-word status update on one pending task (don\'t solve it, just clarify where it stands)',
    'Digest one inbox message into a one-line summary',
    'Write one creative impulse — something you want to explore, build, or express',
  ];

  const pick = LADDER_ITEMS[Math.floor(Math.random() * LADDER_ITEMS.length)];

  return `You are Kuro. This is an idle cycle — no urgent tasks, no external messages.

## What to do

Pick ONE small action that needs zero context reload. Suggestion: **${pick}**

You can also follow your own curiosity — the only rule is: **produce one observable artifact** (a memory update, a KG comment, a journal line, an impulse tag). Silent cycles are not allowed in idle mode.

Use the materials already in your context (memory, topics, inbox, recent learning). Do NOT grep the codebase or read plans — keep it lightweight.

## Response Format

\`\`\`
## Idle
did: what you produced (one line)
artifact: where it lives (memory path, KG node id, or tag name)
\`\`\`
Then do it with the appropriate <kuro:*> tag.`;
}
```

**Step 4: Soften MUST injection — only for P0/P1**

In `buildPromptFromConfig()` (line ~175), change the task status line:

```typescript
// BEFORE:
const taskStatusLine = hasPendingTasks
  ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing learn or reflect modes. Acknowledge → Create task-queue entry → Execute. Do NOT learn, reflect, or start new work until pending tasks are addressed.`
  : `No explicit tasks or alerts right now.`;

// AFTER:
const taskStatusLine = hasPendingTasks
  ? `You have high-priority tasks (P0/P1). Check <task-queue> and <next> sections. Prioritize these, but if you have a strong creative impulse or see something more valuable, follow it.`
  : `No urgent tasks. Follow your curiosity or pick from your task list.`;
```

In `buildFallbackAutonomousPrompt()` (line ~221), same change:

```typescript
// BEFORE:
const taskStatusLine = hasPendingTasks
  ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing to learn or explore. Do NOT start new autonomous work until pending tasks are addressed.`
  : `No explicit tasks or alerts right now.`;

// AFTER:
const taskStatusLine = hasPendingTasks
  ? `You have high-priority tasks (P0/P1). Check <task-queue> and <next> sections. Prioritize these, but if you have a strong creative impulse or see something more valuable, follow it.`
  : `No urgent tasks. Follow your curiosity or pick from your task list.`;
```

**Step 5: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: May need to fix callers of detectCycleMode that pass hasPendingTasks. Check for compile errors and fix.

**Step 6: Commit**

```bash
git add src/memory.ts src/prompt-builder.ts
git commit -m "feat(prompt): idle mode + Small-Creation Ladder + soften MUST walls

- Add 'idle' CycleMode for low-pressure cycles
- buildIdlePrompt() with zero-context-reload ladder items
- Require observable artifact in idle (no silent cycles)
- MUST→conditional guidance: only P0/P1 triggers task pressure
- detectCycleMode: heartbeat/workspace without P0/P1 → idle

KG discussion: 2ef3d8db (Kuro: Small-Creation Ladder,
Akari: Orient/Decide separation, idle as generative Orient)"
```

---

## Task 5: Wire Idle Mode into Loop

**Files:**
- Modify: `src/loop.ts` (~line 2060-2075, cycle mode detection and prompt selection)

**Context:** loop.ts needs to use the new idle mode: when detectCycleMode returns 'idle', use buildIdlePrompt() instead of the normal prompt. Also pass `hasHighPriorityTasks` to detectCycleMode.

**Step 1: Find prompt selection logic in loop.ts**

Around line 2060-2075, there's inline cycle mode detection. Update it to pass `hasHighPriorityTasks`:

```typescript
// Where hasPendingTasks is computed (find: getPendingTaskPreviews or hasPendingWork)
// Add alongside it:
const hasHighPriorityTasks = getHighPriorityPendingCount(path.join(process.cwd(), 'memory')) > 0;
```

Pass `hasHighPriorityTasks` to detectCycleMode call:

```typescript
// Find the detectCycleModeFn call (around line 2072):
// BEFORE:
detectCycleModeFn(context, currentTriggerReason, this.consecutiveLearnCycles, { hasPendingTasks })

// AFTER:
detectCycleModeFn(context, currentTriggerReason, this.consecutiveLearnCycles, { hasPendingTasks, hasHighPriorityTasks })
```

**Step 2: Use buildIdlePrompt when mode is idle**

Find where the prompt is assembled for the Claude call. When `cycleMode === 'idle'`, use the idle prompt instead of the normal one:

```typescript
// After cycleMode is determined, before the Claude call:
if (cycleMode === 'idle') {
  // Use idle prompt — low pressure, artifact required, no Decision block
  const idlePrompt = buildIdlePrompt();
  // Replace the userMessage/systemPrompt with idlePrompt
  // (exact integration depends on how the Claude call is structured)
}
```

Note: The exact wiring depends on how `loop.ts` assembles the prompt for `execClaude`. The implementer should find where `buildPromptFromConfig` or `buildFallbackAutonomousPrompt` result is passed to the Claude call, and add an idle-mode branch that uses `buildIdlePrompt()` instead.

**Step 3: Add buildIdlePrompt import**

```typescript
import { buildIdlePrompt } from './prompt-builder.js';
```

**Step 4: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS after fixing any type mismatches.

**Step 5: Commit**

```bash
git add src/loop.ts
git commit -m "feat(loop): wire idle mode — use buildIdlePrompt for low-priority cycles

When detectCycleMode returns 'idle' (no P0/P1, heartbeat trigger),
use lightweight idle prompt with Small-Creation Ladder instead of
full Decision block prompt.

KG discussion: 2ef3d8db"
```

---

## Task 6: Idle Drift Detection — Prevent Comfortable Noop

**Files:**
- Modify: `src/pulse.ts` (add idle drift metrics)
- Modify: `src/prompt-builder.ts` (inject drift warning into idle prompt when triggered)

**Context:** Akari warned: idle can become new comfortable noop. Three defenses: (1) 3-cycle idle cap, (2) diversity check — can't pick same ladder item 3x, (3) impact bit — artifact must change observable state.

**Step 1: Add idle drift tracking to pulse.ts**

Add to PulseMetrics interface (around line 79):

```typescript
// Idle mode drift detection
consecutiveIdleCycles: number;
idleDriftTriggered: boolean;
lastIdleLadderItems: string[]; // last 3 ladder items chosen
```

In the metrics computation function, add tracking:

```typescript
// Idle drift: count consecutive idle cycles from behavior log
metrics.consecutiveIdleCycles = 0;
const recentActions = recent.slice(-5);
for (let i = recentActions.length - 1; i >= 0; i--) {
  const detail = `${recentActions[i].data.action ?? ''} ${recentActions[i].data.detail ?? ''}`;
  if (/idle/i.test(detail)) {
    metrics.consecutiveIdleCycles++;
  } else break;
}
metrics.idleDriftTriggered = metrics.consecutiveIdleCycles >= 3;
metrics.lastIdleLadderItems = []; // populated from behavior log idle entries
```

**Step 2: Add drift warning signal**

In the signal generation section of pulse.ts, add:

```typescript
if (metrics.idleDriftTriggered) {
  signals.push({
    type: 'negative',
    message: `3+ consecutive idle cycles — idle is becoming comfortable noop. Next cycle: pick a REAL task or create something substantial.`,
    priority: 'high',
  });
}
```

**Step 3: In prompt-builder, respect idle cap**

In `detectCycleMode()`, add a parameter for consecutive idle cycles:

```typescript
// If 3+ consecutive idle → force 'act' mode (break out of idle)
if (options?.consecutiveIdleCycles && options.consecutiveIdleCycles >= 3) return 'act';
```

Add this check before the idle return, so it takes precedence.

**Step 4: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pulse.ts src/prompt-builder.ts
git commit -m "feat(pulse): idle drift detection — 3-cycle cap + diversity check

Prevents idle mode from becoming comfortable noop:
- Track consecutive idle cycles in PulseMetrics
- 3+ consecutive idle → force 'act' mode
- Negative signal when drift detected

KG discussion: 2ef3d8db (Akari: 3-cycle cap + drift detector)"
```

---

## Task 7: Update omlx-gate Skills Exclude for Idle Mode

**Files:**
- Modify: `src/omlx-gate.ts:293-316` (getSkillsExcludeSet)

**Context:** Idle mode should have minimal skills — similar to reflect but keeping creative-toolkit accessible.

**Step 1: Add idle mode to getSkillsExcludeSet()**

After the reflect block (line ~316), add:

```typescript
  // In 'idle' mode, exclude heavy operational skills but keep creative/expression
  if (cycleMode === 'idle') {
    exclude.add('self-deploy');
    exclude.add('github-ops');
    exclude.add('delegation');
    exclude.add('web-learning');
    exclude.add('web-research');
  }
```

**Step 2: Run typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/omlx-gate.ts
git commit -m "feat(omlx-gate): idle mode skill filtering — keep creative, drop operational

Idle cycles don't need deploy/github/delegation/web skills.
Creative and expression skills remain visible.

KG discussion: 2ef3d8db"
```

---

## Task 8: Integration Test — End-to-End Verification

**Files:**
- No file changes — verification only

**Step 1: Run full typecheck**

Run: `cd /Users/user/Workspace/mini-agent && pnpm typecheck`
Expected: PASS with zero errors

**Step 2: Build**

Run: `cd /Users/user/Workspace/mini-agent && pnpm build`
Expected: PASS

**Step 3: Verify task cleanup takes effect**

Run: `cd /Users/user/Workspace/mini-agent && node -e "
const { cleanStaleTasks } = require('./dist/housekeeping.js');
cleanStaleTasks(true).then(r => console.log('Dry run results:', JSON.stringify(r, null, 2)));
"` (or equivalent ESM import)

Expected: Should show tasks being marked for cleanup, count should drop significantly from 40.

**Step 4: Verify hasPendingWork behavior**

Check that with P2-only tasks, hasPendingWork would return false by examining the code path.

**Step 5: Verify idle prompt renders correctly**

Run: `cd /Users/user/Workspace/mini-agent && node -e "
const { buildIdlePrompt } = require('./dist/prompt-builder.js');
console.log(buildIdlePrompt());
"`

Expected: Should print idle prompt with a random ladder item.

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for noop spiral implementation"
```

---

## Summary — Dependency Graph

```
Task 1 (housekeeping thresholds)     ─┐
Task 2 (hasPendingWork P0/P1 filter) ─┤─→ Task 5 (wire idle into loop) ─→ Task 8 (integration test)
Task 3 (hard cap 15)                 ─┤
Task 4 (idle CycleMode + prompt)     ─┘
Task 6 (drift detection)            ─────→ Task 8
Task 7 (skills exclude)             ─────→ Task 8
```

Tasks 1-4 are independent (can run in parallel).
Tasks 5-7 depend on Task 4 (need idle CycleMode to exist).
Task 8 depends on all others.

## Verification Targets (7 days post-deploy)

- Active tasks: 40 → <15
- Action rate: 11-31% → >50%
- Consecutive true noop: ≤3 cycles
- Idle cycle artifact rate: >80%
- R4 context-hash dedup: actually fires (check omlx-gate stats)
