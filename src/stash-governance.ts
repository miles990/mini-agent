import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assessConflicts, type ConflictAssessment } from './conflict-governance.js';
import type { MemoryIndexEntry } from './memory-index.js';
import { slog } from './utils.js';

export interface GitStashRecord {
  ref: string;
  message: string;
  files: string[];
  absorbed?: boolean;
}

export type StashGovernanceDecision =
  | 'ignore'
  | 'drop-absorbed'
  | 'regenerate-generated-artifacts'
  | 'merge-append-union'
  | 'manual-diagnostic';

export interface StashGovernanceCase {
  id: string;
  ts: string;
  stashRef: string;
  message: string;
  files: string[];
  assessment: ConflictAssessment;
  decision: StashGovernanceDecision;
  rootCause: string;
  evidence: string[];
  mechanicalAction: string;
  fallbackTask: {
    title: string;
    verifyCommand: string;
    acceptanceCriteria: string;
  } | null;
  taskId?: string;
}

export interface StashGovernanceResult {
  cases: StashGovernanceCase[];
  createdTasks: MemoryIndexEntry[];
  closedTasks: MemoryIndexEntry[];
}

export async function governGitStashes(
  memoryDir: string,
  repoRoot = process.cwd(),
  opts: {
    createTasks?: boolean;
    dropAbsorbed?: boolean;
    maxCases?: number;
    record?: boolean;
    reason?: string;
    stashes?: GitStashRecord[];
  } = {},
): Promise<StashGovernanceResult> {
  const stashes = opts.stashes ?? listGitStashes(repoRoot);
  const maxCases = opts.maxCases ?? 5;
  const allCases = stashes
    .map(stash => classifyStash(stash, opts.reason))
    .filter(c => c.decision !== 'ignore');
  const cases = allCases.slice(0, maxCases);
  const createdTasks: MemoryIndexEntry[] = [];
  const closedTasks: MemoryIndexEntry[] = [];
  const absorbedDrops: string[] = [];

  if (opts.record || opts.createTasks) appendStashCases(memoryDir, cases);

  if (opts.dropAbsorbed) {
    for (const diagnostic of [...cases].reverse()) {
      if (diagnostic.decision !== 'drop-absorbed') continue;
      if (dropStash(repoRoot, diagnostic.stashRef)) {
        absorbedDrops.push(diagnostic.stashRef);
      }
    }
  }

  if (opts.createTasks) {
    const { createTask } = await import('./memory-index.js');
    closedTasks.push(...await closeObsoleteStashTasks(memoryDir, allCases));
    for (const diagnostic of cases) {
      if (!diagnostic.fallbackTask) continue;
      if (await hasActiveTaskForCase(memoryDir, diagnostic.id)) continue;
      try {
        const task = await createTask(memoryDir, {
          title: diagnostic.fallbackTask.title,
          origin: 'pipeline',
          status: 'pending',
          priority: 1,
          assignee: 'kuro',
          verify_command: diagnostic.fallbackTask.verifyCommand,
          acceptance_criteria: diagnostic.fallbackTask.acceptanceCriteria,
        });
        diagnostic.taskId = task.id;
        createdTasks.push(task);
        appendStashCases(memoryDir, [diagnostic]);
      } catch (error) {
        if (error instanceof Error && /duplicate of existing task/i.test(error.message)) {
          slog('HOUSEKEEPING', `stash governance skipped duplicate task for ${diagnostic.id}`);
          continue;
        }
        throw error;
      }
    }
  }

  if (cases.length > 0 && (opts.record || opts.createTasks)) {
    slog('HOUSEKEEPING', `stash governance diagnosed ${cases.length} stash case(s); tasks=${createdTasks.length} closed=${closedTasks.length} absorbedDrops=${absorbedDrops.length}`);
  }

  return { cases, createdTasks, closedTasks };
}

export function listGitStashes(repoRoot = process.cwd()): GitStashRecord[] {
  const list = safeGit(repoRoot, ['stash', 'list', '--format=%gd%x09%gs']);
  if (!list.trim()) return [];
  return list.split('\n').map(line => {
    const [ref, ...messageParts] = line.split('\t');
    const message = messageParts.join('\t').trim();
    const files = safeGit(repoRoot, ['stash', 'show', '--name-only', '--format=', ref.trim()])
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
    const normalizedRef = ref.trim();
    return {
      ref: normalizedRef,
      message,
      files,
      absorbed: stashMatchesWorkingTree(repoRoot, normalizedRef, files),
    };
  }).filter(stash => stash.ref && stash.files.length > 0);
}

export function classifyStash(stash: GitStashRecord, reason = 'periodic-scan'): StashGovernanceCase {
  const assessment = assessConflicts(stash.files);
  const allGenerated = assessment.conflicted.length > 0
    && assessment.conflicted.every(file => file.class === 'generated');
  const allAiTrend = stash.files.length > 0
    && stash.files.every(file => file.startsWith('kuro-portfolio/ai-trend/'));
  const id = `stash-${hashCase(stash.message, stash.files)}`;

  if (stash.absorbed) {
    return {
      id,
      ts: new Date().toISOString(),
      stashRef: stash.ref,
      message: stash.message,
      files: stash.files,
      assessment,
      decision: 'drop-absorbed',
      rootCause: 'Preserved stash content already matches the current checkout.',
      evidence: [
        `trigger=${reason}`,
        `stash=${stash.ref}`,
        `message=${stash.message}`,
        `files=${stash.files.join(',')}`,
        'policy=drop absorbed recovery stashes instead of creating duplicate repair work',
      ],
      mechanicalAction: 'drop-absorbed-stash',
      fallbackTask: null,
    };
  }

  if (!isManagedStash(stash) && !allGenerated) {
    return {
      id,
      ts: new Date().toISOString(),
      stashRef: stash.ref,
      message: stash.message,
      files: stash.files,
      assessment,
      decision: 'ignore',
      rootCause: 'Stash is unrelated to autonomous runtime recovery.',
      evidence: [`reason=${reason}`, `message=${stash.message}`],
      mechanicalAction: 'none',
      fallbackTask: null,
    };
  }

  const onlyAppendUnion = assessment.manual.length === 0
    && assessment.autoResolvable.length > 0
    && assessment.autoResolvable.every(file => file.resolution === 'append-union');

  if (isManagedStash(stash) && onlyAppendUnion) {
    return {
      id,
      ts: new Date().toISOString(),
      stashRef: stash.ref,
      message: stash.message,
      files: stash.files,
      assessment,
      decision: 'merge-append-union',
      rootCause: 'Managed recovery stash contains only append-only memory files; safe to append-union and drop instead of opening a manual diagnose task.',
      evidence: [
        `trigger=${reason}`,
        `stash=${stash.ref}`,
        `message=${stash.message}`,
        `files=${stash.files.join(',')}`,
        'policy=managed deploy-backup with append-only conflicts auto-merges and drops; no fallback task needed',
      ],
      mechanicalAction: 'append-union-and-drop',
      fallbackTask: null,
    };
  }

  if (allGenerated && allAiTrend) {
    return {
      id,
      ts: new Date().toISOString(),
      stashRef: stash.ref,
      message: stash.message,
      files: stash.files,
      assessment,
      decision: 'regenerate-generated-artifacts',
      rootCause: 'Generated ai-trend HTML was preserved in stash after main advanced on the same rendered files.',
      evidence: [
        `trigger=${reason}`,
        `stash=${stash.ref}`,
        `message=${stash.message}`,
        `files=${stash.files.join(',')}`,
        'policy=generated artifacts are regenerated from source instead of hand-merged',
      ],
      mechanicalAction: 'rerender-ai-trend-from-current-source',
      fallbackTask: {
        title: `${id}: regenerate ai-trend artifact ${stash.ref} from source, then drop or PR leftovers`,
        verifyCommand: 'pnpm exec tsx scripts/stash-governance.ts --json && node scripts/build-ai-trend-preview.mjs && pnpm vitest run tests/conflict-governance.test.ts tests/stash-governance.test.ts',
        acceptanceCriteria: `Stash ${stash.ref} is classified as absorbed, dropped after regeneration, or converted to an isolated PR; no generated HTML is manually merged.`,
      },
    };
  }

  return {
    id,
    ts: new Date().toISOString(),
    stashRef: stash.ref,
    message: stash.message,
    files: stash.files,
    assessment,
    decision: 'manual-diagnostic',
    rootCause: 'Autonomous stash recovery found non-generated or mixed files that need semantic review.',
    evidence: [
      `trigger=${reason}`,
      `stash=${stash.ref}`,
      `message=${stash.message}`,
      `files=${stash.files.join(',')}`,
    ],
    mechanicalAction: 'none',
    fallbackTask: {
      title: `${id}: diagnose preserved stash ${stash.ref}: ${stash.files.slice(0, 3).join(', ')}`,
      verifyCommand: 'git stash list && git status --short && pnpm typecheck',
      acceptanceCriteria: `Stash ${stash.ref} is either safely applied through an isolated worktree PR, intentionally dropped with evidence, or split into smaller tasks.`,
    },
  };
}

function isManagedStash(stash: GitStashRecord): boolean {
  return /auto-push|keep-ai-trend-dirty|runtime|autocorrect|pre-rebase/i.test(stash.message);
}

async function hasActiveTaskForCase(memoryDir: string, caseId: string): Promise<boolean> {
  const { queryMemoryIndexSync } = await import('./memory-index.js');
  const active = queryMemoryIndexSync(memoryDir, { type: 'task' })
    .filter(task => !['completed', 'abandoned', 'deleted', 'expired', 'resolved'].includes(String(task.status)));
  return active.some(task => {
    const payloadText = JSON.stringify(task.payload ?? {});
    const summary = task.summary ?? '';
    return payloadText.includes(caseId) || summary.includes(caseId);
  });
}

async function closeObsoleteStashTasks(
  memoryDir: string,
  currentCases: StashGovernanceCase[],
): Promise<MemoryIndexEntry[]> {
  const { queryMemoryIndexSync, updateMemoryIndexEntry } = await import('./memory-index.js');
  const currentCaseIds = new Set(currentCases.map(c => c.id));
  const active = queryMemoryIndexSync(memoryDir, { type: 'task' })
    .filter(task => !['completed', 'abandoned', 'deleted', 'expired', 'resolved'].includes(String(task.status)));
  const closed: MemoryIndexEntry[] = [];

  for (const task of active) {
    const text = `${task.summary ?? ''}\n${JSON.stringify(task.payload ?? {})}`;
    const match = text.match(/\bstash-[a-f0-9]{12}\b/);
    if (!match || currentCaseIds.has(match[0])) continue;

    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload: {
        ...((task.payload ?? {}) as Record<string, unknown>),
        completed_by: 'stash-governance',
        completed_reason: 'stash case is no longer present in current git stash inventory',
        completed_at: new Date().toISOString(),
        obsolete_stash_case: match[0],
      },
    });
    if (updated) closed.push(updated);
  }

  return closed;
}

function appendStashCases(memoryDir: string, cases: StashGovernanceCase[]): void {
  if (cases.length === 0) return;
  const file = path.join(memoryDir, 'state', 'stash-governance.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, cases.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf-8');
}

function hashCase(message: string, files: string[]): string {
  return createHash('sha1')
    .update(message)
    .update('\0')
    .update([...files].sort().join('\0'))
    .digest('hex')
    .slice(0, 12);
}

function safeGit(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    });
  } catch {
    return '';
  }
}

function stashMatchesWorkingTree(repoRoot: string, ref: string, files: string[]): boolean {
  if (files.length === 0) return false;
  return files.every(file => {
    try {
      const current = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
      const stashed = execFileSync('git', ['show', `${ref}:${file}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      });
      return current === stashed;
    } catch {
      return false;
    }
  });
}

function dropStash(repoRoot: string, ref: string): boolean {
  try {
    execFileSync('git', ['stash', 'drop', ref], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
