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

  // All sources auto-promote — LLM with KG context determines intent.
  // If LLM returns not_actionable, extractGoal returns null → no goal created.
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

async function fetchKGContext(rawText: string): Promise<string> {
  try {
    const keywords = rawText.replace(/[？?！!。，、\s]+/g, ' ').trim().slice(0, 100);
    const res = execSync(
      `curl -sf -X POST http://localhost:3300/api/query -H "Content-Type: application/json" -d '${JSON.stringify({ query: keywords, limit: 5 }).replace(/'/g, "'\\''")}'`,
      { timeout: 5000, encoding: 'utf-8' },
    );
    const data = JSON.parse(res);
    const results = data.results ?? [];
    return results.slice(0, 5).map((r: any) => {
      const n = r.node ?? r;
      return `[${n.type}] ${n.name?.slice(0, 80)} — ${(n.description ?? '').slice(0, 150)}`;
    }).join('\n');
  } catch {
    return '';
  }
}

async function fetchConversationContext(rawText: string): Promise<string> {
  try {
    // Search KG for related conversations, decisions, and goals
    const keywords = rawText.replace(/[？?！!。，、\s]+/g, ' ').trim().slice(0, 80);
    const res = execSync(
      `curl -sf -X POST http://localhost:3300/api/query -H "Content-Type: application/json" -d '${JSON.stringify({ query: keywords, limit: 8 }).replace(/'/g, "'\\''")}'`,
      { timeout: 5000, encoding: 'utf-8' },
    );
    const data = JSON.parse(res);
    const results = (data.results ?? []).slice(0, 8);
    const conversations: string[] = [];
    const context: string[] = [];
    for (const r of results) {
      const n = r.node ?? r;
      const type = n.type ?? '';
      const desc = (n.description ?? '').slice(0, 200);
      if (['observation', 'message', 'room'].some(t => type.includes(t))) {
        conversations.push(`[${n.source_agent ?? '?'}] ${n.name?.slice(0, 60)} — ${desc}`);
      } else {
        context.push(`[${type}] ${n.name?.slice(0, 60)} — ${desc}`);
      }
    }
    return [
      conversations.length > 0 ? `Recent conversations:\n${conversations.join('\n')}` : '',
      context.length > 0 ? `Related context:\n${context.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

async function extractGoal(rawText: string): Promise<GoalExtraction | null> {
  const kgContext = await fetchKGContext(rawText);
  const conversationContext = await fetchConversationContext(rawText);

  const prompt = `You are an intent interpreter. Given a user message and full context from the knowledge graph (including past conversations, decisions, goals, and related information), understand what the user REALLY wants and extract a structured goal.

User message: ${rawText}

Knowledge graph search results:
${kgContext || '(none)'}

${conversationContext || ''}

Based on this context, determine:
1. Is this a STATUS CHECK (asking about progress)? → goal = "review and report status of X"
2. Is this a NEW REQUEST? → goal = the action they want
3. Is this just INFORMATION/CHAT? → output {"not_actionable": true}

Output as JSON:
{
  "title": "one-line goal title reflecting user's true intent",
  "acceptance_criteria": "how to verify this goal is done",
  "priority": 1,
  "tasks": [
    {"title": "concrete task 1"},
    {"title": "concrete task 2"}
  ]
}

OR if not actionable:
{"not_actionable": true}

Rules:
- Interpret intent from context, not just literal text
- title: concise, action-oriented, specific to what the user actually wants
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

    if (parsed.not_actionable) return null;

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
