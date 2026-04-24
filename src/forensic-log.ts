/**
 * Forensic Log — per-subprocess-call observability for SDK + CLI paths.
 *
 * Design:
 *   Each Claude subprocess invocation (SDK query or CLI spawn) writes one
 *   JSONL line capturing cwd / args / prompt sizes / exit / duration / tool
 *   calls / error context. On error OR silent-failure OR truncation OR
 *   periodic sample, also dumps the full prompt to a sibling file so the
 *   incident is repro-able.
 *
 *   Fail-open: every write is wrapped — logging MUST NOT crash the caller.
 *
 * File layout (per instance):
 *   ~/.mini-agent/instances/{id}/forensic/
 *     subprocess-YYYY-MM-DD.jsonl           # one entry per call
 *     full-prompt-{hash[:12]}.txt           # prompt dump for repro
 *
 * Retention: housekeeping.ts calls gcForensicLogs() to delete files >7d.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export interface ToolCallRecord {
  name: string;
  target?: string;
  ok: boolean;
}

export interface GitSnapshot {
  head: string;
  dirty: boolean;
  modified_count: number;
  untracked_count: number;
  sample_files?: string[];
}

export interface SubprocessForensicEntry {
  ts_start: string;
  ts_end: string;
  duration_ms: number;
  backend: 'sdk' | 'cli';
  cwd: string;
  args_snapshot?: string[];
  env_redacted_keys?: string[];
  system_prompt_size: number;
  user_prompt_size: number;
  full_prompt_size: number;
  user_prompt_hash: string;
  pid: number | null;
  exit_code: number | null;
  signal: string | null;
  killed_by: string | null;
  stdout_head_200?: string;
  stdout_tail_500?: string;
  stderr_full?: string;
  tool_calls_count: number;
  tool_calls_summary?: ToolCallRecord[];
  last_text_block_200?: string;
  error_subtype?: string | null;
  retryable?: boolean | null;
  context_source?: { cycle?: number | null; trigger?: string | null; lane?: string | null };
  git_snapshot?: GitSnapshot;
  timeout_ms?: number;
  timed_out?: boolean;
  worker_type?: string;
  memory_usage_end_mb?: number;
  parent_pid?: number;
  instance_id?: string;
  turns_used?: number;
  max_turns?: number;
  dumped_full_prompt?: string;
}

// =============================================================================
// Paths
// =============================================================================

function getForensicDir(): string {
  const id = getCurrentInstanceId();
  const dir = path.join(getInstanceDir(id), 'forensic');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function todayJsonlPath(): string {
  const ymd = new Date().toISOString().slice(0, 10);
  return path.join(getForensicDir(), `subprocess-${ymd}.jsonl`);
}

function fullPromptPath(hash12: string): string {
  return path.join(getForensicDir(), `full-prompt-${hash12}.txt`);
}

// =============================================================================
// Helpers
// =============================================================================

export function hashPrompt(prompt: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(prompt).digest('hex');
}

/** Fast git snapshot via `git status --porcelain` + `git rev-parse HEAD`. */
export function captureGitSnapshot(cwd: string): GitSnapshot | undefined {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8', timeout: 2000 }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 2000 });
    const lines = status.split('\n').filter(l => l.length > 0);
    let modified = 0;
    let untracked = 0;
    const sample: string[] = [];
    for (const line of lines) {
      if (line.startsWith('??')) untracked++;
      else modified++;
      if (sample.length < 10) sample.push(line.slice(0, 100));
    }
    return {
      head,
      dirty: lines.length > 0,
      modified_count: modified,
      untracked_count: untracked,
      sample_files: sample.length > 0 ? sample : undefined,
    };
  } catch {
    return undefined;
  }
}

// =============================================================================
// Dump Trigger
// =============================================================================

const DUMP_ROLLING_INTERVAL = 50;
const SILENT_FAILURE_DURATION_MS = 5000;

let callCounter = 0;

/**
 * Decide whether to dump full prompt alongside the entry.
 * Triggers:
 *   1. Error (exit code non-zero OR error_subtype set)
 *   2. Silent failure (tool_calls === 0 && duration > threshold)
 *   3. Truncation (turns_used === max_turns, both set)
 *   4. Rolling sample (every N calls, keep 1 full prompt)
 */
export function shouldDumpFullPrompt(entry: SubprocessForensicEntry): { dump: boolean; reason: string } {
  callCounter++;
  if (entry.exit_code !== null && entry.exit_code !== 0) return { dump: true, reason: 'exit_nonzero' };
  if (entry.error_subtype) return { dump: true, reason: 'error_subtype:' + entry.error_subtype };
  if (entry.tool_calls_count === 0 && entry.duration_ms > SILENT_FAILURE_DURATION_MS) {
    return { dump: true, reason: 'silent_failure' };
  }
  if (
    typeof entry.turns_used === 'number' &&
    typeof entry.max_turns === 'number' &&
    entry.max_turns > 0 &&
    entry.turns_used === entry.max_turns
  ) {
    return { dump: true, reason: 'truncation_max_turns' };
  }
  if (callCounter % DUMP_ROLLING_INTERVAL === 0) return { dump: true, reason: 'rolling_sample' };
  return { dump: false, reason: '' };
}

// =============================================================================
// Writers
// =============================================================================

function redactEntry(entry: SubprocessForensicEntry): SubprocessForensicEntry {
  const redacted = { ...entry };
  if (redacted.args_snapshot) {
    redacted.args_snapshot = redacted.args_snapshot.map(a =>
      /^sk-[a-zA-Z0-9-]{20,}/.test(a) ? '[REDACTED_KEY]' : a,
    );
  }
  return redacted;
}

function sampleMemoryUsageMb(): number | undefined {
  try {
    const mu = process.memoryUsage();
    return Math.round(mu.rss / (1024 * 1024));
  } catch {
    return undefined;
  }
}

export function writeForensicEntry(entry: SubprocessForensicEntry, fullPrompt?: string): void {
  try {
    if (entry.memory_usage_end_mb === undefined) {
      entry.memory_usage_end_mb = sampleMemoryUsageMb();
    }
    const { dump, reason } = shouldDumpFullPrompt(entry);
    if (dump && fullPrompt) {
      const hash12 = entry.user_prompt_hash.replace(/^sha256:/, '').slice(0, 12);
      entry.dumped_full_prompt = `full-prompt-${hash12}.txt:${reason}`;
      const p = fullPromptPath(hash12);
      if (!fs.existsSync(p)) {
        try {
          fs.writeFileSync(p, fullPrompt, 'utf-8');
        } catch { /* fail-open */ }
      }
    }
    const line = JSON.stringify(redactEntry(entry)) + '\n';
    fs.appendFileSync(todayJsonlPath(), line, 'utf-8');
  } catch { /* fail-open: forensic logging must never break the caller */ }
}

// =============================================================================
// GC (called by housekeeping.ts)
// =============================================================================

export function gcForensicLogs(maxAgeDays = 7): number {
  try {
    const dir = getForensicDir();
    if (!fs.existsSync(dir)) return 0;
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(p);
          removed++;
        }
      } catch { /* skip */ }
    }
    return removed;
  } catch {
    return 0;
  }
}

// =============================================================================
// Convenience builders
// =============================================================================

/** Build a pre-filled entry shell. Callers fill runtime fields after spawn. */
export function buildForensicEntryShell(params: {
  backend: 'sdk' | 'cli';
  cwd: string;
  fullPrompt: string;
  systemPromptSize: number;
  userPromptSize: number;
  args?: string[];
  envRedactedKeys?: string[];
  contextSource?: { cycle?: number | null; trigger?: string | null; lane?: string | null };
  timeoutMs?: number;
  workerType?: string;
  maxTurns?: number;
}): SubprocessForensicEntry {
  const now = new Date().toISOString();
  return {
    ts_start: now,
    ts_end: now,
    duration_ms: 0,
    backend: params.backend,
    cwd: params.cwd,
    args_snapshot: params.args,
    env_redacted_keys: params.envRedactedKeys,
    system_prompt_size: params.systemPromptSize,
    user_prompt_size: params.userPromptSize,
    full_prompt_size: params.fullPrompt.length,
    user_prompt_hash: hashPrompt(params.fullPrompt),
    pid: null,
    exit_code: null,
    signal: null,
    killed_by: null,
    tool_calls_count: 0,
    context_source: params.contextSource,
    git_snapshot: captureGitSnapshot(params.cwd),
    timeout_ms: params.timeoutMs,
    worker_type: params.workerType,
    parent_pid: process.pid,
    instance_id: (() => { try { return getCurrentInstanceId(); } catch { return undefined; } })(),
    max_turns: params.maxTurns,
  };
}
