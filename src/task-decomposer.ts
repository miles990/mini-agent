/**
 * Task Decomposer (M1) — auto-split abstract tasks into concrete sub-tasks
 *
 * Detects tasks without verify_command, uses LLM to decompose them
 * into sub-tasks with verify_command + acceptance_criteria.
 */

import { queryMemoryIndexSync, appendMemoryIndexEntry, updateMemoryIndexEntry, type CreateMemoryIndexEntryInput } from './memory-index.js';
import { spawn } from 'node:child_process';
import { slog } from './utils.js';

const DECOMPOSE_COOLDOWN_MS = 5 * 60_000;

let lastDecomposeAt = 0;
const decomposedSet = new Set<string>();

export interface DecomposeResult {
  decomposed: boolean;
  reason: string;
  taskId?: string;
  subTaskCount?: number;
}

function runClaudeDecompose(promptText: string, schema: string, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--json-schema',
      schema,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`claude decompose timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
      }
    });
    child.stdin.end(promptText);
  });
}

export async function checkAndDecompose(memoryDir: string): Promise<DecomposeResult> {
  const elapsed = Date.now() - lastDecomposeAt;
  if (elapsed < DECOMPOSE_COOLDOWN_MS) {
    return { decomposed: false, reason: `cooldown (${Math.round((DECOMPOSE_COOLDOWN_MS - elapsed) / 60000)}min)` };
  }

  const entries = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  const needsDecompose = entries.filter(e => {
    if (decomposedSet.has(e.id)) return false;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const verify = p.verify_command as string | undefined;
    return !verify || verify.length === 0;
  });

  if (needsDecompose.length === 0) {
    return { decomposed: false, reason: 'no tasks need decomposition' };
  }

  const target = needsDecompose[0];

  try {
    const promptText =
      `You are a task decomposer for a code project. Break down this abstract task into 2-5 concrete sub-tasks.\n\n` +
      `Task: ${target.summary}\n\n` +
      `Each sub-task must have:\n` +
      `- summary: one line describing what to do\n` +
      `- verify_command: a shell command that returns exit 0 when done (e.g. test -f path, grep -q pattern file)\n` +
      `- acceptance_criteria: what "done" looks like\n\n` +
      `The project root is a TypeScript agent framework. HTML files are in kuro-portfolio/ai-trend/. Scripts are in scripts/. Source is in src/.\n\n` +
      `Output STRICT JSON array only — no prose, no code fences.`;

    const schema = JSON.stringify({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          verify_command: { type: 'string' },
          acceptance_criteria: { type: 'string' },
        },
        required: ['summary', 'verify_command', 'acceptance_criteria'],
      },
    });

    const raw = await runClaudeDecompose(promptText, schema);

    const envelope = JSON.parse(raw);
    const subTasks = envelope?.structured_output as Array<{ summary: string; verify_command: string; acceptance_criteria: string }> | undefined;

    if (!Array.isArray(subTasks) || subTasks.length === 0) {
      slog('DECOMPOSE', `${target.id.slice(0, 16)}: LLM returned no sub-tasks`);
      decomposedSet.add(target.id);
      return { decomposed: false, reason: 'LLM returned empty result' };
    }

    const parentPayload = (target.payload ?? {}) as Record<string, unknown>;
    const goalId = (parentPayload.goal_id as string) ?? target.id;

    for (const sub of subTasks.slice(0, 5)) {
      const input: CreateMemoryIndexEntryInput = {
        type: 'task',
        status: 'pending',
        summary: sub.summary,
        source: 'auto-decompose',
        payload: {
          verify_command: sub.verify_command,
          acceptance_criteria: sub.acceptance_criteria,
          goal_id: goalId,
          parent_task: target.id,
          origin: 'decomposer',
        },
      };
      void appendMemoryIndexEntry(memoryDir, input);
    }

    void updateMemoryIndexEntry(memoryDir, target.id, { status: 'decomposed' as string });
    decomposedSet.add(target.id);
    lastDecomposeAt = Date.now();

    slog('DECOMPOSE', `${target.id.slice(0, 16)}: split into ${subTasks.length} sub-tasks`);

    return {
      decomposed: true,
      reason: `decomposed: ${(target.summary ?? '').slice(0, 60)} → ${subTasks.length} sub-tasks`,
      taskId: target.id,
      subTaskCount: subTasks.length,
    };
  } catch (err) {
    decomposedSet.add(target.id);
    slog('DECOMPOSE', `${target.id.slice(0, 16)} failed: ${(err as Error).message?.slice(0, 100)}`);
    return { decomposed: false, reason: `error: ${(err as Error).message?.slice(0, 80)}` };
  }
}
