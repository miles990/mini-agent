/**
 * Forensic Analyzer — Layer 2 post-hoc join (mini-agent forensic JSONL ⋈ middleware server.log).
 *
 * Design per KG discussion a051725d-9997-45e9-9790-e6be1a01701b (CC + Kuro + Akari):
 *   - Federation model: Layer 1 emits forensic entries with middleware_task_id;
 *     this analyzer joins mini-agent forensic JSONL against the server.log
 *     [MW-CYCLE] lines using taskId as the correlation anchor.
 *   - Temporal window: --wait <ms> delays read to let late-flushing events arrive
 *     (Akari's OpenTelemetry tail-based sampling reference).
 *   - On-demand + sampling per Kuro's G5 usage pattern (not realtime, not daemon).
 *   - Print path only for full-prompt dumps; do NOT inline file content.
 *
 * Usage (via tsx):
 *   pnpm tsx scripts/forensic-analyze.ts
 *   pnpm tsx scripts/forensic-analyze.ts --since 2026-04-24T03:40:00Z --format summary
 *   pnpm tsx scripts/forensic-analyze.ts --taskId task-1777... --format json
 *   pnpm tsx scripts/forensic-analyze.ts --filter-anomaly silent_failure
 *   pnpm tsx scripts/forensic-analyze.ts --filter-anomaly noop_cycle  # middleware tools=0 above baseline
 *
 * Exit codes:
 *   0 — success (may report anomalies in output)
 *   1 — no forensic dir / no data in window
 *   2 — unrecognized args
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import type { SubprocessForensicEntry } from '../src/forensic-log.js';

type AnomalyType =
  | 'silent_failure'
  | 'noop_cycle'
  | 'truncation'
  | 'orphan_forensic_no_mw'
  | 'orphan_mw_no_forensic'
  | 'dispatch_failed'
  | 'poll_timeout';

// Percentile-based detection for middleware noop_cycle (Akari recommendation,
// KG discussion e5fcbde6). Absolute floors prevent false positives on tiny
// samples / health checks; cold-start fallback uses writer's absolute gate.
const NOOP_COLD_PROMPT_BYTES = 20000;
const NOOP_COLD_DURATION_MS = 30000;
const NOOP_DURATION_FLOOR_MS = 5000;
const NOOP_MIN_SAMPLES_FOR_PERCENTILE = 10;

interface MiddlewareBaseline {
  p50_prompt: number;
  p25_duration: number;
  sample_count: number;
  is_cold_start: boolean;
}

// O(n log n) per call; baseline calc sorts prompt + duration separately → 2×sort.
// Fine for per-instance forensic scale (tens to low-thousands of entries).
// Replace with a single-pass quickselect if this ever hits 10⁵+ entries.
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function computeMiddlewareBaseline(entries: SubprocessForensicEntry[]): MiddlewareBaseline {
  const mw = entries.filter(e => e.backend === 'middleware');
  if (mw.length < NOOP_MIN_SAMPLES_FOR_PERCENTILE) {
    return {
      p50_prompt: NOOP_COLD_PROMPT_BYTES,
      p25_duration: NOOP_COLD_DURATION_MS,
      sample_count: mw.length,
      is_cold_start: true,
    };
  }
  return {
    p50_prompt: percentile(mw.map(e => e.full_prompt_size), 50),
    p25_duration: percentile(mw.map(e => e.duration_ms), 25),
    sample_count: mw.length,
    is_cold_start: false,
  };
}

interface MwEvent {
  ts: string;
  event: 'dispatched' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'poll-timeout' | 'other';
  line: string;
  taskId?: string;
  duration_ms?: number;
  result_len?: number;
  source?: string;
}

interface JoinedEvent {
  taskId: string;
  mini_agent_forensic?: SubprocessForensicEntry;
  forensic_file_path?: string;
  middleware_log_events: MwEvent[];
  retry_chain: string[];
  anomalies: AnomalyType[];
  full_prompt_path?: string;
  full_prompt_meta?: { size_bytes: number; mtime: string };
}

interface AnalysisResult {
  query: {
    since?: string;
    since_defaulted?: boolean;
    until?: string;
    taskId?: string;
    format: string;
    filter_anomaly?: string;
    wait_ms: number;
    instance: string;
  };
  joined_events: JoinedEvent[];
  orphans: {
    mini_agent_no_middleware_match: Array<{ forensic_path: string; entry: SubprocessForensicEntry }>;
    middleware_no_mini_agent_forensic: MwEvent[];
  };
  summary: {
    total_joined: number;
    total_mini_agent_entries: number;
    total_mw_events: number;
    anomaly_counts: Record<string, number>;
    middleware_baseline: MiddlewareBaseline;
  };
}

const MW_CYCLE_RE = /\[MW-CYCLE\]\s+(dispatched|completed|failed|timeout|cancelled|poll-timeout|\S+)(?:\s+(.*))?$/;
const MW_TASKID_RE = /taskId=(\S+)/;
const MW_DURATION_RE = /duration=(\d+)ms/;
const MW_RESULT_LEN_RE = /result_len=(\d+)/;
const MW_SOURCE_RE = /source=(\S+)/;
const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

function resolveInstanceDir(instanceIdArg?: string): { id: string; dir: string; mtimeMs: number } {
  const home = os.homedir();
  const baseDir = path.join(home, '.mini-agent', 'instances');
  if (!fs.existsSync(baseDir)) {
    throw new Error(`mini-agent instances dir not found: ${baseDir}`);
  }
  if (instanceIdArg) {
    const d = path.join(baseDir, instanceIdArg);
    const stat = fs.statSync(d);
    return { id: instanceIdArg, dir: d, mtimeMs: stat.mtimeMs };
  }
  const candidates = fs.readdirSync(baseDir)
    .map(id => ({ id, stat: fs.statSync(path.join(baseDir, id)) }))
    .filter(c => c.stat.isDirectory())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  if (candidates.length === 0) {
    throw new Error(`no instance dirs under ${baseDir}`);
  }
  const picked = candidates[0];
  return { id: picked.id, dir: path.join(baseDir, picked.id), mtimeMs: picked.stat.mtimeMs };
}

/** Guess a reasonable default --since: forensic dir mtime if exists, else
 *  instance dir mtime (proxy for instance restart / last activity). */
function guessDefaultSinceMs(instanceDir: string, instanceMtimeMs: number): number {
  const fdir = path.join(instanceDir, 'forensic');
  if (fs.existsSync(fdir)) {
    try {
      const stat = fs.statSync(fdir);
      return stat.mtimeMs - 60 * 60 * 1000; // forensic dir mtime - 1h window
    } catch { /* fall through */ }
  }
  return instanceMtimeMs - 60 * 60 * 1000;
}

function inWindow(ts: string | undefined, sinceMs?: number, untilMs?: number): boolean {
  if (!ts) return true;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return true;
  if (sinceMs !== undefined && t < sinceMs) return false;
  if (untilMs !== undefined && t > untilMs) return false;
  return true;
}

function readForensicEntries(
  instanceDir: string,
  sinceMs?: number,
  untilMs?: number,
): Array<{ entry: SubprocessForensicEntry; file: string }> {
  const fdir = path.join(instanceDir, 'forensic');
  if (!fs.existsSync(fdir)) return [];
  const files = fs.readdirSync(fdir).filter(f => /^subprocess-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  const out: Array<{ entry: SubprocessForensicEntry; file: string }> = [];
  for (const f of files) {
    const full = path.join(fdir, f);
    let content: string;
    try { content = fs.readFileSync(full, 'utf-8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SubprocessForensicEntry;
        if (!inWindow(entry.ts_start, sinceMs, untilMs)) continue;
        out.push({ entry, file: full });
      } catch { /* skip malformed */ }
    }
  }
  return out;
}

function parseMwLine(line: string): MwEvent | null {
  if (!line.includes('[MW-CYCLE]')) return null;
  const m = line.match(MW_CYCLE_RE);
  if (!m) return null;
  const tsMatch = line.match(LOG_TS_RE);
  const ts = tsMatch ? new Date(tsMatch[1].replace(' ', 'T') + 'Z').toISOString() : new Date().toISOString();
  const taskId = line.match(MW_TASKID_RE)?.[1];
  const duration = line.match(MW_DURATION_RE);
  const resultLen = line.match(MW_RESULT_LEN_RE);
  const source = line.match(MW_SOURCE_RE)?.[1];
  const rawEvent = m[1];
  const event: MwEvent['event'] =
    rawEvent === 'dispatched' ? 'dispatched'
    : rawEvent === 'completed' ? 'completed'
    : rawEvent === 'failed' ? 'failed'
    : rawEvent === 'timeout' ? 'timeout'
    : rawEvent === 'cancelled' ? 'cancelled'
    : rawEvent === 'poll-timeout' ? 'poll-timeout'
    : 'other';
  return {
    ts,
    event,
    line: line.slice(0, 500),
    taskId,
    duration_ms: duration ? parseInt(duration[1], 10) : undefined,
    result_len: resultLen ? parseInt(resultLen[1], 10) : undefined,
    source,
  };
}

function readMwEvents(instanceDir: string, sinceMs?: number, untilMs?: number): MwEvent[] {
  const logPath = path.join(instanceDir, 'logs', 'server.log');
  if (!fs.existsSync(logPath)) return [];
  let content: string;
  try { content = fs.readFileSync(logPath, 'utf-8'); } catch { return []; }
  const out: MwEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.includes('[MW-CYCLE]')) continue;
    const ev = parseMwLine(line);
    if (!ev) continue;
    if (!inWindow(ev.ts, sinceMs, untilMs)) continue;
    out.push(ev);
  }
  return out;
}

function detectAnomalies(
  entry: SubprocessForensicEntry | undefined,
  mwEvents: MwEvent[],
  baseline: MiddlewareBaseline,
): AnomalyType[] {
  const out: AnomalyType[] = [];
  if (entry) {
    // Aligned with forensic-log.ts:shouldDumpFullPrompt — middleware backend
    // doesn't expose tool_use to caller, so tool_calls=0 is normal there.
    // (KG discussion a051725d — P3 decision applies to both write and read sides.)
    if (
      entry.backend !== 'middleware' &&
      entry.tool_calls_count === 0 &&
      entry.duration_ms > 5000
    ) out.push('silent_failure');
    // noop_cycle — middleware-path silent fail relative to local baseline.
    // Percentile detection (Akari, KG e5fcbde6): prompt size above instance
    // median AND duration above max(P25, 5s). Cold-start fallback uses
    // absolute writer thresholds for small samples. Semantic: this cycle
    // had input + time + zero action — worth inspection, cause unknown.
    if (
      entry.backend === 'middleware' &&
      entry.tool_calls_count === 0 &&
      entry.full_prompt_size > baseline.p50_prompt &&
      entry.duration_ms > Math.max(baseline.p25_duration, NOOP_DURATION_FLOOR_MS)
    ) out.push('noop_cycle');
    if (
      typeof entry.turns_used === 'number' &&
      typeof entry.max_turns === 'number' &&
      entry.max_turns > 0 &&
      entry.turns_used === entry.max_turns
    ) out.push('truncation');
    if (entry.error_subtype === 'dispatch_failed' || mwEvents.some(e => e.event === 'failed' && e.line.includes('dispatch-failed'))) {
      out.push('dispatch_failed');
    }
    if (entry.error_subtype === 'poll_timeout' || mwEvents.some(e => e.event === 'poll-timeout')) {
      out.push('poll_timeout');
    }
  }
  return out;
}

function samplePromptMeta(fpath: string): { size_bytes: number; mtime: string } | undefined {
  try {
    const st = fs.statSync(fpath);
    return { size_bytes: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

function joinEvents(
  forensic: Array<{ entry: SubprocessForensicEntry; file: string }>,
  mwEvents: MwEvent[],
  instanceDir: string,
  baseline: MiddlewareBaseline,
  taskIdFilter?: string,
): {
  joined: JoinedEvent[];
  orphansForensic: Array<{ forensic_path: string; entry: SubprocessForensicEntry }>;
  orphansMw: MwEvent[];
} {
  // Group MW events by taskId
  const byTaskId = new Map<string, MwEvent[]>();
  for (const ev of mwEvents) {
    if (!ev.taskId) continue;
    if (taskIdFilter && ev.taskId !== taskIdFilter) continue;
    if (!byTaskId.has(ev.taskId)) byTaskId.set(ev.taskId, []);
    byTaskId.get(ev.taskId)!.push(ev);
  }

  const joined: JoinedEvent[] = [];
  const orphansForensic: Array<{ forensic_path: string; entry: SubprocessForensicEntry }> = [];
  const matchedTaskIds = new Set<string>();

  for (const { entry, file } of forensic) {
    if (entry.backend !== 'middleware') continue; // only join middleware entries
    const tid = entry.middleware_task_id;
    if (!tid) {
      orphansForensic.push({ forensic_path: file, entry });
      continue;
    }
    if (taskIdFilter && tid !== taskIdFilter) continue;
    const mwMatches = byTaskId.get(tid) ?? [];
    if (mwMatches.length === 0) {
      orphansForensic.push({ forensic_path: file, entry });
      continue;
    }
    matchedTaskIds.add(tid);
    const anomalies = detectAnomalies(entry, mwMatches, baseline);
    const retryChain = entry.middleware_retry_of ? [entry.middleware_retry_of] : [];
    const forensicDir = path.dirname(file);
    let fullPromptPath: string | undefined;
    let fullPromptMeta: ReturnType<typeof samplePromptMeta>;
    if (entry.dumped_full_prompt) {
      const fname = entry.dumped_full_prompt.split(':')[0];
      const candidate = path.join(forensicDir, fname);
      if (fs.existsSync(candidate)) {
        fullPromptPath = candidate;
        fullPromptMeta = samplePromptMeta(candidate);
      }
    }
    joined.push({
      taskId: tid,
      mini_agent_forensic: entry,
      forensic_file_path: file,
      middleware_log_events: mwMatches,
      retry_chain: retryChain,
      anomalies,
      full_prompt_path: fullPromptPath,
      full_prompt_meta: fullPromptMeta,
    });
  }

  const orphansMw: MwEvent[] = [];
  for (const [tid, evs] of byTaskId) {
    if (matchedTaskIds.has(tid)) continue;
    orphansMw.push(...evs);
  }

  return { joined, orphansForensic, orphansMw };
}

function printSummary(result: AnalysisResult): void {
  const lines: string[] = [];
  lines.push(`# Forensic Analysis Summary`);
  const sinceLabel = result.query.since ?? 'all';
  const sinceNote = result.query.since_defaulted ? ' (auto, pass --since all to disable)' : '';
  lines.push(`instance: ${result.query.instance}  window: ${sinceLabel}${sinceNote} → ${result.query.until ?? 'now'}  wait: ${result.query.wait_ms}ms`);
  lines.push('');
  lines.push(`joined_events: ${result.summary.total_joined}`);
  lines.push(`mini_agent_entries: ${result.summary.total_mini_agent_entries}`);
  lines.push(`mw_events: ${result.summary.total_mw_events}`);
  const orphanMwCount = result.orphans.middleware_no_mini_agent_forensic.length;
  lines.push(`orphans: forensic_no_mw=${result.orphans.mini_agent_no_middleware_match.length} mw_no_forensic=${orphanMwCount}`);
  if (orphanMwCount > 100) {
    lines.push(`  ⚠ large mw_no_forensic — consider narrowing --since window`);
  }
  const bl = result.summary.middleware_baseline;
  const blMode = bl.is_cold_start ? 'cold-start (absolute floors)' : `percentile (n=${bl.sample_count})`;
  lines.push(`mw_baseline: ${blMode}  p50_prompt=${bl.p50_prompt}B  p25_duration=${bl.p25_duration}ms`);
  lines.push('');
  lines.push(`## Anomalies`);
  const kinds = Object.keys(result.summary.anomaly_counts).sort();
  if (kinds.length === 0) lines.push('  (none)');
  for (const k of kinds) lines.push(`  ${k}: ${result.summary.anomaly_counts[k]}`);
  lines.push('');
  lines.push(`## Joined Events (first 10)`);
  for (const ev of result.joined_events.slice(0, 10)) {
    const dur = ev.mini_agent_forensic?.duration_ms ?? '?';
    const tools = ev.mini_agent_forensic?.tool_calls_count ?? 0;
    const anom = ev.anomalies.length > 0 ? ` [${ev.anomalies.join(',')}]` : '';
    const mwEvents = ev.middleware_log_events.map(e => e.event).join('→');
    lines.push(`  ${ev.taskId}  dur=${dur}ms  tools=${tools}  mw=${mwEvents}${anom}`);
    if (ev.full_prompt_path) {
      lines.push(`    full_prompt: ${ev.full_prompt_path} (${ev.full_prompt_meta?.size_bytes ?? '?'} bytes, mtime ${ev.full_prompt_meta?.mtime ?? '?'})`);
    }
  }
  if (result.joined_events.length > 10) lines.push(`  ... (${result.joined_events.length - 10} more)`);
  console.log(lines.join('\n'));
}

function printTable(result: AnalysisResult): void {
  console.log('taskId\tdur_ms\ttools\tturns\tmw_events\tanomalies\tforensic_path');
  for (const ev of result.joined_events) {
    const e = ev.mini_agent_forensic;
    const mwStr = ev.middleware_log_events.map(m => m.event).join(',');
    console.log(
      [
        ev.taskId,
        e?.duration_ms ?? '',
        e?.tool_calls_count ?? '',
        e?.turns_used ?? '',
        mwStr,
        ev.anomalies.join(','),
        ev.forensic_file_path ?? '',
      ].join('\t'),
    );
  }
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs<{ options: Record<string, { type: 'string' | 'boolean' }> }>>;
  try {
    parsed = parseArgs({
      options: {
        wait: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        taskId: { type: 'string' },
        format: { type: 'string' },
        'filter-anomaly': { type: 'string' },
        instance: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const values = parsed.values as {
    wait?: string;
    since?: string;
    until?: string;
    taskId?: string;
    format?: string;
    'filter-anomaly'?: string;
    instance?: string;
    help?: boolean;
  };

  if (values.help) {
    console.log(`Usage: forensic-analyze.ts [options]
  --wait <ms>              tail-based window delay (default 5000)
  --since <iso>            only include events after this timestamp
  --until <iso>            only include events before this timestamp
  --taskId <id>            filter to a specific middleware taskId
  --format <json|summary|table>  output format (default json)
  --filter-anomaly <type>  keep only events with this anomaly
                           (silent_failure|noop_cycle|truncation|dispatch_failed|poll_timeout)
  --instance <id>          instance id (default: most recently modified)`);
    process.exit(0);
  }

  const waitMs = values.wait ? Math.max(0, parseInt(values.wait, 10)) : 5000;
  const format = values.format ?? 'json';
  if (!['json', 'summary', 'table'].includes(format)) {
    console.error(`--format must be json|summary|table, got: ${format}`);
    process.exit(2);
  }

  if (waitMs > 0) {
    await new Promise<void>(r => setTimeout(r, waitMs));
  }

  const { id: instanceId, dir: instanceDir, mtimeMs: instanceMtimeMs } = resolveInstanceDir(values.instance);
  // Default --since to instance-scoped recent window to avoid noisy
  // mw_no_forensic orphans from pre-restart accumulated server.log lines.
  // Explicit 'all' keyword disables the default. Explicit ISO always wins.
  let sinceMs: number | undefined;
  let sinceDefaulted = false;
  if (values.since === 'all') {
    sinceMs = undefined;
  } else if (values.since) {
    sinceMs = Date.parse(values.since);
  } else {
    sinceMs = guessDefaultSinceMs(instanceDir, instanceMtimeMs);
    sinceDefaulted = true;
  }
  const untilMs = values.until ? Date.parse(values.until) : undefined;

  const forensic = readForensicEntries(instanceDir, sinceMs, untilMs);
  const mwEvents = readMwEvents(instanceDir, sinceMs, untilMs);

  if (forensic.length === 0 && mwEvents.length === 0) {
    console.error(`no forensic or MW-CYCLE data in window (instance=${instanceId})`);
    process.exit(1);
  }

  const baseline = computeMiddlewareBaseline(forensic.map(f => f.entry));
  const { joined, orphansForensic, orphansMw } = joinEvents(forensic, mwEvents, instanceDir, baseline, values.taskId);

  let filtered = joined;
  if (values['filter-anomaly']) {
    const f = values['filter-anomaly'];
    filtered = joined.filter(ev => ev.anomalies.includes(f as AnomalyType));
  }

  const anomalyCounts: Record<string, number> = {};
  for (const ev of filtered) for (const a of ev.anomalies) anomalyCounts[a] = (anomalyCounts[a] ?? 0) + 1;
  anomalyCounts.orphan_forensic_no_mw = orphansForensic.length;
  anomalyCounts.orphan_mw_no_forensic = orphansMw.length;

  const result: AnalysisResult = {
    query: {
      since: sinceMs !== undefined ? new Date(sinceMs).toISOString() : values.since,
      since_defaulted: sinceDefaulted || undefined,
      until: values.until,
      taskId: values.taskId,
      format,
      filter_anomaly: values['filter-anomaly'],
      wait_ms: waitMs,
      instance: instanceId,
    },
    joined_events: filtered,
    orphans: {
      mini_agent_no_middleware_match: orphansForensic,
      middleware_no_mini_agent_forensic: orphansMw,
    },
    summary: {
      total_joined: filtered.length,
      total_mini_agent_entries: forensic.length,
      total_mw_events: mwEvents.length,
      anomaly_counts: anomalyCounts,
      middleware_baseline: baseline,
    },
  };

  if (format === 'summary') printSummary(result);
  else if (format === 'table') printTable(result);
  else console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
