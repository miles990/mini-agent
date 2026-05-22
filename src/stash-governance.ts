import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
  | 'drop-stale-deploy-backup'
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

export interface AppendUnionMergeOutcome {
  caseId: string;
  stashRef: string;
  mergedFiles: string[];
  dropped: boolean;
  error?: string;
}

export interface StashGovernanceResult {
  cases: StashGovernanceCase[];
  createdTasks: MemoryIndexEntry[];
  closedTasks: MemoryIndexEntry[];
  appendUnionMerges?: AppendUnionMergeOutcome[];
  deployBackupDrops?: string[];
}

export async function governGitStashes(
  memoryDir: string,
  repoRoot = process.cwd(),
  opts: {
    createTasks?: boolean;
    dropAbsorbed?: boolean;
    executeAppendUnion?: boolean;
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
  const appendUnionMerges: AppendUnionMergeOutcome[] = [];

  if (opts.record || opts.createTasks) appendStashCases(memoryDir, cases);

  if (opts.dropAbsorbed) {
    for (const diagnostic of [...cases].reverse()) {
      if (diagnostic.decision !== 'drop-absorbed') continue;
      if (dropStash(repoRoot, diagnostic.stashRef)) {
        absorbedDrops.push(diagnostic.stashRef);
      }
    }
  }

  // Mechanical executor: drain merge-append-union cases by union-merging
  // append-only memory files in-place and dropping the stash. Iterate in
  // reverse so dropping earlier stash refs (e.g. stash@{0}) doesn't shift
  // higher indices we still need to process.
  if (opts.executeAppendUnion) {
    for (const diagnostic of [...cases].reverse()) {
      if (diagnostic.decision !== 'merge-append-union') continue;
      if (diagnostic.mechanicalAction !== 'append-union-and-drop') continue;
      const outcome = executeAppendUnionAndDrop(repoRoot, diagnostic);
      appendUnionMerges.push(outcome);
      if (outcome.error) {
        slog('HOUSEKEEPING', `stash governance append-union failed for ${diagnostic.id}: ${outcome.error}`);
      } else {
        slog('HOUSEKEEPING', `stash governance append-union merged ${diagnostic.id}: files=${outcome.mergedFiles.length} dropped=${outcome.dropped}`);
      }
    }
  }

  // Deploy-backup drop pass. Re-lists stashes fresh so it is immune to the
  // index shifts the absorbed / append-union drop loops above may have caused
  // (stash refs are positional — `stash@{N}`). Iterates descending index so
  // each drop leaves every lower ref valid. Deliberately unbounded by maxCases:
  // that cap throttles task-creating diagnoses, not a `git stash drop`, and a
  // backlog of obsolete snapshots should drain in a single pass rather than
  // ceil(N / maxCases) runs — the failure mode that let 33 accumulate.
  const deployBackupDrops: string[] = [];
  if (opts.dropAbsorbed) {
    const live = opts.stashes ?? listGitStashes(repoRoot);
    for (let i = live.length - 1; i >= 0; i--) {
      const stash = live[i];
      if (classifyStash(stash, opts.reason).decision !== 'drop-stale-deploy-backup') continue;
      if (dropStash(repoRoot, stash.ref)) deployBackupDrops.push(stash.ref);
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

  if ((cases.length > 0 || deployBackupDrops.length > 0) && (opts.record || opts.createTasks)) {
    const deferred = allCases.length - cases.length;
    slog('HOUSEKEEPING', `stash governance diagnosed ${cases.length}/${allCases.length} stash case(s)${deferred > 0 ? ` (${deferred} deferred to next run)` : ''}; tasks=${createdTasks.length} closed=${closedTasks.length} absorbedDrops=${absorbedDrops.length} deployBackupDrops=${deployBackupDrops.length} appendUnionDrops=${appendUnionMerges.filter(m => m.dropped).length}`);
  }

  return { cases, createdTasks, closedTasks, appendUnionMerges, deployBackupDrops };
}

/**
 * Drain a `merge-append-union` case by:
 *   1. Reading the stashed version of each file via `git show stash@{N}:path`
 *   2. Computing the merge base from `stash@{N}^1:path` (HEAD when stashed)
 *   3. Producing a union merge with `git merge-file --union`
 *   4. Writing the merged content back in-place
 *   5. Dropping the stash if every file merged cleanly
 *
 * Safety gates:
 *   - Only acts on `decision === 'merge-append-union'` with
 *     `mechanicalAction === 'append-union-and-drop'`
 *   - Aborts (without dropping) if any file fails to read or merge, leaving
 *     the stash and any partial writes in place for manual diagnosis
 *   - Refuses to write if the merged output is shorter than the current file
 *     (append-only invariant: union-merging append-only memory should never
 *     shrink the file)
 */
export function executeAppendUnionAndDrop(
  repoRoot: string,
  diagnostic: StashGovernanceCase,
): AppendUnionMergeOutcome {
  const out: AppendUnionMergeOutcome = {
    caseId: diagnostic.id,
    stashRef: diagnostic.stashRef,
    mergedFiles: [],
    dropped: false,
  };

  if (diagnostic.decision !== 'merge-append-union' || diagnostic.mechanicalAction !== 'append-union-and-drop') {
    out.error = 'wrong-decision-or-action';
    return out;
  }
  if (diagnostic.assessment.manual.length !== 0) {
    out.error = 'has-manual-conflicts';
    return out;
  }
  if (diagnostic.files.length === 0) {
    out.error = 'no-files';
    return out;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-append-union-'));
  try {
    for (const relPath of diagnostic.files) {
      const absPath = path.join(repoRoot, relPath);
      let currentContent: string;
      try {
        currentContent = fs.readFileSync(absPath, 'utf-8');
      } catch {
        currentContent = '';
      }
      const stashedContent = safeGitStdout(repoRoot, ['show', `${diagnostic.stashRef}:${relPath}`]);
      if (stashedContent === null) {
        out.error = `cannot-read-stashed:${relPath}`;
        return out;
      }
      // Merge base: HEAD when the stash was created. May be empty if file
      // didn't exist (newly added in stash); treat that as empty base.
      const baseContent = safeGitStdout(repoRoot, ['show', `${diagnostic.stashRef}^1:${relPath}`]) ?? '';

      const oursPath = path.join(tmpDir, 'ours');
      const basePath = path.join(tmpDir, 'base');
      const theirsPath = path.join(tmpDir, 'theirs');
      fs.writeFileSync(oursPath, currentContent, 'utf-8');
      fs.writeFileSync(basePath, baseContent, 'utf-8');
      fs.writeFileSync(theirsPath, stashedContent, 'utf-8');

      let mergedContent: string;
      try {
        // `git merge-file --union -p` writes the merged content to stdout
        // and exits 0 (no conflicts possible with --union).
        mergedContent = execFileSync('git', ['merge-file', '--union', '-p', oursPath, basePath, theirsPath], {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15_000,
        });
      } catch (error) {
        out.error = `merge-file-failed:${relPath}:${(error as Error).message}`;
        return out;
      }

      // Append-only invariant: union output must not shrink the current file.
      if (mergedContent.length < currentContent.length) {
        out.error = `append-only-shrink-detected:${relPath}`;
        return out;
      }

      if (mergedContent !== currentContent) {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, mergedContent, 'utf-8');
      }
      out.mergedFiles.push(relPath);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // All files merged successfully; drop the stash.
  out.dropped = dropStash(repoRoot, diagnostic.stashRef);
  if (!out.dropped) {
    out.error = 'merge-ok-but-stash-drop-failed';
  }
  return out;
}

function safeGitStdout(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    });
  } catch {
    return null;
  }
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
  const onlyAppendUnion = assessment.manual.length === 0
    && assessment.autoResolvable.length > 0
    && assessment.autoResolvable.every(file => file.resolution === 'append-union');

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

  // Deploy-backup snapshots (`deploy-backup-<ISO8601>`) are safety stashes the
  // deploy pipeline takes automatically before each deploy. Once the deploy has
  // landed they are obsolete — the pre-deploy state stays reachable via the
  // deploy reflog (~30d) and main branch history. They are not work-in-progress
  // and must never become diagnose tasks. Left unclassified they silently
  // accumulated (57 stashes / 33 deploy-backups, 2026-05-22): some failed
  // isManagedStash and were ignored, the rest fell off the maxCases window.
  // Exception: a snapshot carrying append-only memory conflicts falls through
  // to merge-append-union below so that memory is union-merged before drop.
  if (isDeployBackupStash(stash.message) && !onlyAppendUnion) {
    return {
      id,
      ts: new Date().toISOString(),
      stashRef: stash.ref,
      message: stash.message,
      files: stash.files,
      assessment,
      decision: 'drop-stale-deploy-backup',
      rootCause: 'Pre-deploy safety snapshot superseded once the deploy landed; pre-deploy state remains reachable via the deploy reflog and main branch history.',
      evidence: [
        `trigger=${reason}`,
        `stash=${stash.ref}`,
        `message=${stash.message}`,
        `files=${stash.files.length} file(s)`,
        'policy=obsolete deploy-backup snapshots are dropped mechanically; recoverable from reflog ~30d',
      ],
      mechanicalAction: 'drop-deploy-backup-snapshot',
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

/**
 * A deploy-backup snapshot — `git stash` reflog subject ending in
 * `deploy-backup-<YYYYMMDDThhmmssZ>`, e.g. `On runtime/main:
 * deploy-backup-20260520T110613Z`. The timestamp is anchored to the end so the
 * match never catches work-in-progress stashes that merely mention the words.
 */
function isDeployBackupStash(message: string): boolean {
  return /(?:^|:\s)deploy-backup-\d{8}T\d{6}Z$/.test(message.trim());
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
