/**
 * Goal Advancer — bridges pipeline goals and task queue.
 *
 * When scheduler has no tasks (idle/discovery), pulls from active goals
 * to generate actionable tasks. Ensures pipeline goals continuously
 * feed work into the task queue.
 *
 * Integration: called from schedulerPick's idle path.
 * Design: KG discussion 33ecd549 consensus (CC + Akari).
 */

import { execSync } from 'node:child_process';
import { slog } from './utils.js';
import { queryMemoryIndexSync, updateMemoryIndexEntry, createTask, dequeueNextGoal, scanPipelineVerify } from './memory-index.js';
import { logMechanism } from './mechanism-log.js';
import type { MemoryIndexEntry } from './memory-index.js';

// =============================================================================
// Config
// =============================================================================

const MAX_GENERATION_ROUNDS = 5;
const COOLDOWN_MS = 600_000; // 10 min per goal
const GLOBAL_COOLDOWN_MS = 300_000; // 5 min global

// =============================================================================
// State
// =============================================================================

const lastGenerationPerGoal = new Map<string, number>();
let lastGlobalGeneration = 0;

export interface AdvanceResult {
  advanced: boolean;
  action: 'goal-completed' | 'tasks-generated' | 'goal-activated' | 'deadlock' | 'cooldown' | 'no-goals' | 'max-rounds';
  goalId?: string;
  tasksCreated?: number;
}

// =============================================================================
// Core
// =============================================================================

export async function advanceGoals(memoryDir: string): Promise<AdvanceResult> {
  // Global cooldown
  if (Date.now() - lastGlobalGeneration < GLOBAL_COOLDOWN_MS) {
    return { advanced: false, action: 'cooldown' };
  }

  const all = queryMemoryIndexSync(memoryDir, { type: ['goal', 'task'] });
  const activeGoals = all.filter(e =>
    e.type === 'goal' && e.status === 'in_progress' &&
    (e.payload as Record<string, unknown>)?.origin === 'pipeline'
  );

  if (activeGoals.length === 0) {
    // Try to activate a pending goal
    const activated = await dequeueNextGoal(memoryDir);
    if (activated) {
      logMechanism(memoryDir, {
        mechanism: 'goal-advancer', action: 'goal-activated',
        reason: `activated pending goal ${activated.slice(0, 12)}`,
      });
      return { advanced: true, action: 'goal-activated', goalId: activated };
    }
    return { advanced: false, action: 'no-goals' };
  }

  for (const goal of activeGoals) {
    const goalPayload = (goal.payload ?? {}) as Record<string, unknown>;

    // Per-goal cooldown
    const lastGen = lastGenerationPerGoal.get(goal.id) ?? 0;
    if (Date.now() - lastGen < COOLDOWN_MS) continue;

    // Max generation rounds
    const healAttempts = (goalPayload.heal_attempts as number) ?? 0;
    if (healAttempts >= MAX_GENERATION_ROUNDS) {
      slog('GOAL', `goal ${goal.id.slice(0, 12)} exceeded max generation rounds`);
      continue;
    }

    const tasks = all.filter(e =>
      e.type === 'task' && (e.payload as Record<string, unknown>)?.goal_id === goal.id
    );
    const pending = tasks.filter(t => ['pending', 'in_progress'].includes(t.status));
    const blocked = tasks.filter(t => t.status === 'blocked');
    const completed = tasks.filter(t => ['done', 'completed'].includes(t.status));

    // Case A: has pending tasks → no advancement needed
    if (pending.length > 0) continue;

    // Case B: all blocked → deadlock
    if (blocked.length > 0 && pending.length === 0) {
      logMechanism(memoryDir, {
        mechanism: 'goal-advancer', action: 'deadlock',
        reason: `goal ${goal.id.slice(0, 12)}: ${blocked.length} blocked, 0 pending`,
      });
      return { advanced: false, action: 'deadlock', goalId: goal.id };
    }

    // Case C: all tasks completed → check goal verify
    if (completed.length > 0 && pending.length === 0 && blocked.length === 0) {
      if (goalPayload.verify_command) {
        try {
          execSync(goalPayload.verify_command as string, { timeout: 10_000, stdio: 'ignore' });
          await updateMemoryIndexEntry(memoryDir, goal.id, { status: 'completed' });
          await dequeueNextGoal(memoryDir);
          logMechanism(memoryDir, {
            mechanism: 'goal-advancer', action: 'goal-completed',
            reason: `goal ${goal.id.slice(0, 12)} verify passed`,
          });
          return { advanced: true, action: 'goal-completed', goalId: goal.id };
        } catch {
          // Verify failed — need more tasks
        }
      }

      // Generate next batch of tasks
      const result = await generateNextTasks(memoryDir, goal, completed);
      if (result.tasksCreated && result.tasksCreated > 0) {
        return result;
      }
    }

    // Case D: no tasks at all → generate initial tasks
    if (tasks.length === 0) {
      const result = await generateNextTasks(memoryDir, goal, []);
      if (result.tasksCreated && result.tasksCreated > 0) {
        return result;
      }
    }
  }

  return { advanced: false, action: 'no-goals' };
}

// =============================================================================
// Task Generation
// =============================================================================

async function generateNextTasks(
  memoryDir: string,
  goal: MemoryIndexEntry,
  completedTasks: MemoryIndexEntry[],
): Promise<AdvanceResult> {
  const goalPayload = (goal.payload ?? {}) as Record<string, unknown>;
  const healAttempts = (goalPayload.heal_attempts as number) ?? 0;

  if (healAttempts >= MAX_GENERATION_ROUNDS) {
    return { advanced: false, action: 'max-rounds', goalId: goal.id };
  }

  lastGenerationPerGoal.set(goal.id, Date.now());
  lastGlobalGeneration = Date.now();

  const completedSummaries = completedTasks.map(t => `- [done] ${t.summary}`).join('\n');
  const acceptance = (goalPayload.acceptance_criteria as string) ?? '';

  const prompt = `Goal: ${goal.summary}
Acceptance criteria: ${acceptance}
Completed tasks:
${completedSummaries || '(none)'}

Generate 2-4 concrete, actionable next tasks to advance this goal.
Each task should be completable in 1-3 agent cycles.
Output as JSON array: [{"title": "...", "priority": 1}]
Only output the JSON array, nothing else.`;

  try {
    const result = execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model sonnet --output-format json 2>/dev/null`,
      { timeout: 60_000, encoding: 'utf-8' },
    ).trim();

    let tasks: Array<{ title: string; priority?: number }>;
    try {
      const parsed = JSON.parse(result);
      tasks = Array.isArray(parsed) ? parsed : (parsed.result ? JSON.parse(parsed.result) : []);
    } catch {
      slog('GOAL', `failed to parse generated tasks for ${goal.id.slice(0, 12)}`);
      return { advanced: false, action: 'max-rounds', goalId: goal.id };
    }

    let created = 0;
    for (const task of tasks.slice(0, 4)) {
      if (!task.title || task.title.length < 5) continue;
      await createTask(memoryDir, {
        title: task.title,
        priority: task.priority ?? 1,
        origin: 'pipeline',
        goal_id: goal.id,
        status: 'pending',
      });
      created++;
    }

    // Increment heal_attempts
    await updateMemoryIndexEntry(memoryDir, goal.id, {
      payload: { ...goalPayload, heal_attempts: healAttempts + 1 },
    });

    if (created > 0) {
      slog('GOAL', `generated ${created} tasks for goal ${goal.id.slice(0, 12)}`);
      logMechanism(memoryDir, {
        mechanism: 'goal-advancer', action: 'tasks-generated',
        reason: `${created} tasks for goal ${goal.id.slice(0, 12)}, round ${healAttempts + 1}`,
      });
    }

    return { advanced: created > 0, action: 'tasks-generated', goalId: goal.id, tasksCreated: created };
  } catch (err) {
    slog('GOAL', `task generation failed: ${err}`);
    return { advanced: false, action: 'max-rounds', goalId: goal.id };
  }
}
