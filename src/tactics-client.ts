/**
 * Tactics Client — Mini-agent side consumer of middleware Tactical Command Board.
 *
 * Per brain-only-kuro-v2 proposal §7 Phase C T6. Typed HTTP wrapper for:
 *   - GET  /api/tactics/in-flight    (active tasks for agent)
 *   - GET  /api/tactics/history      (terminal tasks within window)
 *   - POST /api/tactics/needs-attention  (rubric-driven filter)
 *
 * Design principles:
 *   - Throws typed errors on failure (callers decide graceful degrade)
 *   - Uses AbortController for timeout (parity with sdk-client.ts)
 *   - Base URL via env MIDDLEWARE_URL (default localhost:3200)
 *   - No auth header by default (middleware tactics endpoints don't require it);
 *     callers can pass apiKey opts for authenticated envs.
 */

export type TacticStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export interface TacticRecord {
  task_id: string;
  plan_id?: string;
  worker: string;
  label?: string;
  status: TacticStatus;
  caller?: string;
  submitted_at: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
}

export type AttentionSeverity = 'critical' | 'anomaly' | 'blocked' | 'routine';

export interface NeedsAttentionItem {
  task_id: string;
  severity: AttentionSeverity;
  confidence: number;
  rationale: string;
}

export interface NeedsAttentionResult {
  count: number;
  total_assessed: number;
  total_seen: number;
  truncated: boolean;
  agent: string | null;
  window_seconds: number;
  items: NeedsAttentionItem[];
}

export interface TacticsClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
}

export class TacticsClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'network' | 'http' | 'parse' | 'timeout' | 'validation',
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TacticsClientError';
  }
}

function resolveBaseUrl(opts?: TacticsClientOptions): string {
  return opts?.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes('timeout') ? 'timeout' : 'network';
    throw new TacticsClientError(`fetch failed: ${msg}`, code);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text().catch(() => undefined); }
    throw new TacticsClientError(
      `HTTP ${res.status} from ${url}`,
      'http',
      res.status,
      body,
    );
  }

  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new TacticsClientError(
      `parse failed: ${e instanceof Error ? e.message : String(e)}`,
      'parse',
    );
  }
}

function buildHeaders(opts?: TacticsClientOptions): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.apiKey) h['Authorization'] = `Bearer ${opts.apiKey}`;
  return h;
}

/** T1: Get active (pending + running) tasks for agent. */
export async function getInFlight(
  agent: string,
  opts?: TacticsClientOptions,
): Promise<TacticRecord[]> {
  const base = resolveBaseUrl(opts);
  const url = `${base}/api/tactics/in-flight?agent=${encodeURIComponent(agent)}`;
  const res = await fetchJson<{ count: number; agent: string | null; items: TacticRecord[] }>(
    url,
    { method: 'GET', headers: buildHeaders(opts) },
    opts?.timeoutMs ?? 10_000,
  );
  return res.items ?? [];
}

/** T2: Get terminal tasks (completed/failed/timeout/cancelled) within window. */
export async function getHistory(
  agent: string,
  window: string = '24h',
  opts?: TacticsClientOptions,
): Promise<TacticRecord[]> {
  const base = resolveBaseUrl(opts);
  const url = `${base}/api/tactics/history?agent=${encodeURIComponent(agent)}&window=${encodeURIComponent(window)}`;
  const res = await fetchJson<{
    count: number;
    agent: string | null;
    window_seconds: number;
    items: TacticRecord[];
  }>(url, { method: 'GET', headers: buildHeaders(opts) }, opts?.timeoutMs ?? 10_000);
  return res.items ?? [];
}

/** T4: Rubric-driven filter — returns only items flagged as critical/anomaly/blocked. */
export async function getNeedsAttention(
  args: {
    agent?: string;
    /** Rubric text (品味不外包 — middleware rejects empty). Load via memory/rubrics/*.md. */
    rubric: string;
    window?: string;
    max_items?: number;
  },
  opts?: TacticsClientOptions,
): Promise<NeedsAttentionResult> {
  if (!args.rubric || !args.rubric.trim()) {
    throw new TacticsClientError(
      'rubric is required (品味不外包 — provide from memory/rubrics/)',
      'validation',
    );
  }
  const base = resolveBaseUrl(opts);
  const url = `${base}/api/tactics/needs-attention`;
  // Scorer may take up to 2 min for N items; default timeout higher than simple GET
  const timeoutMs = opts?.timeoutMs ?? 150_000;
  return fetchJson<NeedsAttentionResult>(
    url,
    {
      method: 'POST',
      headers: buildHeaders(opts),
      body: JSON.stringify(args),
    },
    timeoutMs,
  );
}

/**
 * Graceful-degrade wrapper: returns null on any error (network/parse/timeout).
 * For use inside buildContext() / perception plugins — callers that prefer
 * degraded context over crash.
 */
export async function tryGetNeedsAttention(
  args: Parameters<typeof getNeedsAttention>[0],
  opts?: TacticsClientOptions,
): Promise<NeedsAttentionResult | null> {
  try {
    return await getNeedsAttention(args, opts);
  } catch {
    return null;
  }
}
