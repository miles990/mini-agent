/**
 * Idea Promote — Stage 3-5 of the Intake Pipeline.
 *
 * Converts qualified ideas into pipeline goals + tasks.
 * Stage 3: Extract goal (title, acceptance_criteria, priority)
 * Stage 4: Decompose into tasks (via task-decomposer or LLM)
 * Stage 5: Commit to pipeline (createGoal)
 *
 * Three-way consensus: CC + Akari + Kuro (KG discussions 385504ef, c675fe28).
 */

import { execSync } from 'node:child_process';
import {
  queryMemoryIndexSync,
  updateMemoryIndexEntry,
  createGoal,
  type MemoryIndexEntry,
} from './memory-index.js';
import { logMechanism } from './mechanism-log.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface GoalExtraction {
  title: string;
  acceptance_criteria: string;
  priority: number;
  verify_command?: string;
  tasks: Array<{
    title: string;
    acceptance_criteria?: string;
    verify_command?: string;
    depends_on?: string[];
  }>;
}

export interface PromoteResult {
  promoted: boolean;
  action: 'promoted' | 'awaiting_confirm' | 'extraction_failed' | 'already_promoted' | 'no_qualified';
  goalId?: string;
  taskIds?: string[];
  ideaId?: string;
}

// =============================================================================
// Config
// =============================================================================

const COOLDOWN_MS = 300_000; // 5 min between promote attempts
let lastPromoteTime = 0;

// =============================================================================
// Core
// =============================================================================

export async function promoteNextIdea(memoryDir: string): Promise<PromoteResult> {
  if (Date.now() - lastPromoteTime < COOLDOWN_MS) {
    return { promoted: false, action: 'no_qualified' };
  }

  const qualified = queryMemoryIndexSync(memoryDir, {
    type: ['idea'],
    status: ['qualified'],
  });

  if (qualified.length === 0) {
    return { promoted: false, action: 'no_qualified' };
  }

  // Pick the oldest qualified idea
  const idea = qualified.sort((a, b) =>
    new Date(a.ts).getTime() - new Date(b.ts).getTime()
  )[0];

  const payload = (idea.payload ?? {}) as Record<string, unknown>;
  const source = (payload.source as string) ?? '';
  const rawText = (payload.raw_text as string) ?? idea.summary ?? '';

  // Determine if confirmation is needed
  const isAlexSource = source.includes(':alex') || source === 'alex';
  const priority = (payload.qualify_score as number) ?? 0;

  // Alex source → always needs confirmation (source = intent clarity)
  // Discovery P2-P3 → auto promote
  // P0-P1 → always needs confirmation
  if (isAlexSource || priority <= 1) {
    return await markAwaitingConfirm(memoryDir, idea);
  }

  // Auto-promote discovery ideas
  return await executePromotion(memoryDir, idea, rawText);
}

async function markAwaitingConfirm(
  memoryDir: string,
  idea: MemoryIndexEntry,
): Promise<PromoteResult> {
  const payload = (idea.payload ?? {}) as Record<string, unknown>;

  if (payload.awaiting_confirm) {
    return { promoted: false, action: 'already_promoted', ideaId: idea.id };
  }

  await updateMemoryIndexEntry(memoryDir, idea.id, {
    status: 'qualified',
    payload: {
      ...payload,
      awaiting_confirm: true,
      confirm_requested_at: new Date().toISOString(),
    },
  });

  logMechanism(memoryDir, {
    mechanism: 'idea-intake',
    action: 'awaiting-confirm',
    reason: `idea ${idea.id.slice(0, 12)} needs Alex confirmation`,
    data: {
      idea_id: idea.id,
      source: payload.source,
      raw_text_preview: (payload.raw_text as string)?.slice(0, 100),
    },
  });

  slog('INTAKE', `idea ${idea.id.slice(0, 12)} awaiting confirmation`);
  return { promoted: false, action: 'awaiting_confirm', ideaId: idea.id };
}

export async function confirmAndPromote(
  memoryDir: string,
  ideaId: string,
): Promise<PromoteResult> {
  const entries = queryMemoryIndexSync(memoryDir, { type: ['idea'] });
  const idea = entries.find(e => e.id === ideaId || e.id.startsWith(ideaId));
  if (!idea) return { promoted: false, action: 'no_qualified' };

  const payload = (idea.payload ?? {}) as Record<string, unknown>;
  const rawText = (payload.raw_text as string) ?? idea.summary ?? '';
  return await executePromotion(memoryDir, idea, rawText);
}

async function executePromotion(
  memoryDir: string,
  idea: MemoryIndexEntry,
  rawText: string,
): Promise<PromoteResult> {
  lastPromoteTime = Date.now();

  const extraction = await extractGoal(rawText);
  if (!extraction) {
    logMechanism(memoryDir, {
      mechanism: 'idea-intake',
      action: 'extraction-failed',
      reason: `failed to extract goal from idea ${idea.id.slice(0, 12)}`,
    });
    return { promoted: false, action: 'extraction_failed', ideaId: idea.id };
  }

  try {
    const result = await createGoal(memoryDir, {
      title: extraction.title,
      acceptance_criteria: extraction.acceptance_criteria,
      verify_command: extraction.verify_command,
    }, extraction.tasks);

    // Update idea entry with promotion info
    const payload = (idea.payload ?? {}) as Record<string, unknown>;
    await updateMemoryIndexEntry(memoryDir, idea.id, {
      status: 'completed',
      payload: {
        ...payload,
        promoted_to_goal: result.goalId,
        promoted_at: new Date().toISOString(),
      },
    });

    logMechanism(memoryDir, {
      mechanism: 'idea-intake',
      action: 'promoted',
      reason: `idea ${idea.id.slice(0, 12)} → goal ${result.goalId.slice(0, 12)} (${result.taskIds.length} tasks)`,
      data: {
        idea_id: idea.id,
        goal_id: result.goalId,
        task_count: result.taskIds.length,
        origin_idea_id: idea.id,
      },
    });

    slog('INTAKE', `promoted idea ${idea.id.slice(0, 12)} → goal ${result.goalId.slice(0, 12)} (${result.taskIds.length} tasks)`);
    return {
      promoted: true,
      action: 'promoted',
      goalId: result.goalId,
      taskIds: result.taskIds,
      ideaId: idea.id,
    };
  } catch (err) {
    const payload = (idea.payload ?? {}) as Record<string, unknown>;
    await updateMemoryIndexEntry(memoryDir, idea.id, {
      status: 'qualified',
      payload: { ...payload, promotion_failed: true, promotion_error: String(err).slice(0, 200) },
    }).catch(() => {});
    slog('INTAKE', `promotion failed: ${err}`);
    return { promoted: false, action: 'extraction_failed', ideaId: idea.id };
  }
}

// =============================================================================
// Goal Extraction (haiku + schema validation fallback)
// =============================================================================

async function extractGoal(rawText: string): Promise<GoalExtraction | null> {
  const prompt = `Given this idea, extract a structured goal with tasks.

Idea: ${rawText}

Output as JSON:
{
  "title": "one-line goal title",
  "acceptance_criteria": "how to verify this goal is done",
  "priority": 1,
  "tasks": [
    {"title": "concrete task 1"},
    {"title": "concrete task 2"}
  ]
}

Rules:
- title: concise, action-oriented
- acceptance_criteria: measurable verification
- priority: 0(urgent) to 3(low), default 1
- tasks: 2-4 concrete actionable steps
- Only output valid JSON, nothing else`;

  try {
    const result = execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model haiku --output-format json 2>/dev/null`,
      { timeout: 30_000, encoding: 'utf-8' },
    ).trim();

    return parseAndValidateGoal(result);
  } catch {
    // Fallback: structured template extraction (no LLM)
    return templateExtraction(rawText);
  }
}

function parseAndValidateGoal(raw: string): GoalExtraction | null {
  try {
    let parsed = JSON.parse(raw);
    if (parsed.result) parsed = JSON.parse(parsed.result);

    if (!parsed.title || typeof parsed.title !== 'string') return null;
    if (!parsed.acceptance_criteria || typeof parsed.acceptance_criteria !== 'string') return null;
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) return null;

    const tasks = parsed.tasks
      .filter((t: any) => t.title && typeof t.title === 'string' && t.title.length >= 3)
      .slice(0, 4)
      .map((t: any) => ({
        title: t.title,
        ...(t.acceptance_criteria ? { acceptance_criteria: t.acceptance_criteria } : {}),
        ...(t.verify_command ? { verify_command: t.verify_command } : {}),
        ...(t.depends_on ? { depends_on: t.depends_on } : {}),
      }));

    if (tasks.length === 0) return null;

    return {
      title: parsed.title.slice(0, 200),
      acceptance_criteria: parsed.acceptance_criteria.slice(0, 500),
      priority: typeof parsed.priority === 'number' ? Math.min(3, Math.max(0, parsed.priority)) : 1,
      verify_command: parsed.verify_command,
      tasks,
    };
  } catch {
    return null;
  }
}

function templateExtraction(rawText: string): GoalExtraction | null {
  if (rawText.length < 10) return null;

  const title = rawText.slice(0, 100).replace(/\n/g, ' ').trim();
  return {
    title,
    acceptance_criteria: `Complete as described in original idea: "${title}"`,
    priority: 2,
    tasks: [{
      title: rawText.slice(0, 150).replace(/\n/g, ' ').trim(),
      acceptance_criteria: `Verify: ${title}`,
    }],
  };
}
