import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ExternalMemoryHealthResult {
  status: 'ok' | 'warn' | 'blocked';
  summary: string;
  evidence: string[];
  repair?: string;
}

export interface KgExternalMemoryOptions {
  kgUrl?: string;
  timeoutSeconds?: number;
  staleDiscussionDays?: number;
}

const CRITICAL_JSONL_RELATIVE_PATHS = [
  'state/task-events.jsonl',
  'index/relations.jsonl',
  'index/entries.jsonl',
  'index/pr-review-claims.jsonl',
];

export function evaluateMemoryStateTruth(memoryDir: string, repoRoot: string): ExternalMemoryHealthResult {
  const evidence: string[] = [`memoryRoot=${memoryDir}`];
  const malformed = findMalformedCriticalJsonl(memoryDir);
  if (malformed.length > 0) {
    return {
      status: 'blocked',
      summary: `${malformed.length} critical memory JSONL file(s) are malformed`,
      evidence: malformed.slice(0, 8).map(item => `${item.file}:${item.line} ${item.error}`),
      repair: 'Repair or quarantine malformed JSONL lines, keeping .repair-bak-* files local and ignored.',
    };
  }

  const gitDir = path.join(memoryDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      status: 'ok',
      summary: 'external memory git snapshot is not configured for this workspace',
      evidence,
    };
  }

  const status = gitStatus(memoryDir);
  if (status === null) {
    return {
      status: 'warn',
      summary: 'external memory git status could not be evaluated',
      evidence,
      repair: 'Run git status in the external memory workspace and fix repository corruption or permission issues.',
    };
  }

  const dirtyLines = status.split('\n').filter(Boolean);
  if (dirtyLines.length > 0) {
    return {
      status: 'warn',
      summary: `${dirtyLines.length} curated memory git change(s) not snapshotted`,
      evidence: [...evidence, ...dirtyLines.slice(0, 8)],
      repair: 'Commit curated memory changes locally; keep high-frequency telemetry ignored.',
    };
  }

  return {
    status: 'ok',
    summary: 'external file memory is parseable and snapshotted',
    evidence,
  };
}

export function evaluateKgExternalMemoryTruth(memoryDir: string, now = new Date(), options: KgExternalMemoryOptions = {}): ExternalMemoryHealthResult {
  const hasKgFootprint = fs.existsSync(path.join(memoryDir, 'state', 'kg-memory-cache.jsonl'))
    || fs.existsSync(path.join(memoryDir, 'index', 'kg-push-state.json'));
  if (!hasKgFootprint && !process.env.KG_URL && !options.kgUrl) {
    return {
      status: 'ok',
      summary: 'KG context fabric has no local footprint in this memory workspace',
      evidence: [],
    };
  }

  const kgUrl = (options.kgUrl ?? process.env.KG_URL ?? 'http://127.0.0.1:3300').replace(/\/+$/, '');
  const timeout = options.timeoutSeconds ?? 2;
  const health = curlJson(`${kgUrl}/health`, timeout);
  if (!health.ok) {
    return {
      status: 'warn',
      summary: 'KG context fabric service is unreachable',
      evidence: [`kgUrl=${kgUrl}`, health.error ?? 'unknown curl failure'],
      repair: 'Start knowledge-graph or disable KG-backed context exchange until the service is intentionally unavailable.',
    };
  }

  const healthBody = health.value as Record<string, unknown>;
  const stats = curlJson(`${kgUrl}/api/stats`, timeout);
  const discussions = curlJson(`${kgUrl}/api/discussions?status=open`, timeout);
  const evidence = [
    `kgUrl=${kgUrl}`,
    `status=${String(healthBody.status ?? 'unknown')}`,
    `worker=${String((healthBody.worker as Record<string, unknown> | undefined)?.running ?? 'unknown')}`,
    `bufferDepth=${String(healthBody.buffer_depth ?? 'unknown')}`,
  ];
  if (stats.ok) {
    const statsBody = stats.value as Record<string, unknown>;
    evidence.push(`nodes=${String(statsBody.nodes ?? 'unknown')}`);
    evidence.push(`edges=${String(statsBody.edges ?? 'unknown')}`);
    evidence.push(`avgConfidence=${String(statsBody.avg_confidence ?? 'unknown')}`);
  } else {
    evidence.push(`stats=unreachable:${stats.error ?? 'unknown'}`);
  }
  if (!discussions.ok) evidence.push(`discussions=unreachable:${discussions.error ?? 'unknown'}`);

  const bufferDepth = Number(healthBody.buffer_depth ?? 0);
  const workerRunning = (healthBody.worker as Record<string, unknown> | undefined)?.running;
  const staleDiscussions = discussions.ok
    ? findStaleOpenDiscussions(discussions.value, now, options.staleDiscussionDays ?? 14)
    : [];
  if (discussions.ok) evidence.push(`staleOpenDiscussions=${staleDiscussions.length}`);

  if (!stats.ok || !discussions.ok) {
    return {
      status: 'warn',
      summary: 'KG context fabric is reachable but not fully queryable',
      evidence,
      repair: 'Restore KG stats and discussion APIs so AI agents can exchange, classify, link, and analyze shared context.',
    };
  }

  if (Number.isFinite(bufferDepth) && bufferDepth > 1000) {
    return {
      status: 'warn',
      summary: `KG ingest buffer is high (${bufferDepth})`,
      evidence,
      repair: 'Let KG worker drain the buffer or inspect worker failures before relying on KG context freshness.',
    };
  }
  if (workerRunning === false) {
    return {
      status: 'warn',
      summary: 'KG worker is not running',
      evidence,
      repair: 'Restart KG worker so shared AI context can keep ingesting, linking, and maintaining confidence.',
    };
  }
  if (staleDiscussions.length > 0) {
    return {
      status: 'warn',
      summary: `${staleDiscussions.length} stale KG context discussion(s) need closure`,
      evidence,
      repair: 'Resolve, archive, or refresh stale KG discussions so shared AI context does not accumulate unresolved analysis threads.',
    };
  }

  return {
    status: 'ok',
    summary: 'KG context fabric is reachable, queryable, and maintaining shared AI context',
    evidence,
  };
}

function findMalformedCriticalJsonl(memoryDir: string): Array<{ file: string; line: number; error: string }> {
  const malformed: Array<{ file: string; line: number; error: string }> = [];
  const files = [
    ...CRITICAL_JSONL_RELATIVE_PATHS,
    ...listJsonlFiles(path.join(memoryDir, 'conversations')).map(file => path.relative(memoryDir, file)),
  ];

  for (const rel of files) {
    const filePath = path.join(memoryDir, rel);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        JSON.parse(line);
      } catch (err) {
        malformed.push({ file: rel, line: i + 1, error: String(err).slice(0, 120) });
        break;
      }
    }
  }
  return malformed;
}

function listJsonlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => path.join(dir, entry.name));
}

function gitStatus(cwd: string): string | null {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function curlJson(url: string, timeoutSeconds: number): { ok: true; value: unknown } | { ok: false; error?: string } {
  try {
    const stdout = execFileSync('curl', ['-sS', '--max-time', String(timeoutSeconds), url], {
      encoding: 'utf-8',
      timeout: (timeoutSeconds + 1) * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, value: JSON.parse(stdout) };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

function findStaleOpenDiscussions(value: unknown, now: Date, staleDays: number): unknown[] {
  const records = Array.isArray((value as Record<string, unknown>)?.discussions)
    ? (value as Record<string, unknown>).discussions as Array<Record<string, unknown>>
    : Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
  const thresholdMs = staleDays * 24 * 60 * 60 * 1000;
  return records.filter(record => {
    const topic = String(record.topic ?? record.name ?? '');
    if (/^room-\d{4}-\d{2}-\d{2}$/.test(topic)) return false;
    const updatedAt = Date.parse(String(record.updated_at ?? record.updatedAt ?? record.created_at ?? ''));
    return Number.isFinite(updatedAt) && (now.getTime() - updatedAt) > thresholdMs;
  });
}
