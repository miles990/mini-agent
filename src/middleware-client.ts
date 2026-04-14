/**
 * Middleware Client — Dual Interface SDK
 *
 * Typed TypeScript client for agent-middleware (localhost:3200).
 * Transport-agnostic: HTTP is default, but swappable (unix socket, direct call, ...).
 *
 * Design principle (Constraint Texture):
 *   - Caller expresses intent (dispatch a worker, run a plan, wait for result)
 *   - Transport + serialization are invisible
 *   - Errors are typed — no string parsing
 *
 * See memory/proposals/2026-04-14-middleware-as-native-cognition.md
 */

// ── Types: semantic interface ──────────────────────────────────────────

export type WorkerName = string;
export type TaskId = string;
export type PlanId = string;

export type TaskStatusValue =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface DispatchRequest {
  worker: WorkerName;
  task: string;
  timeoutSeconds?: number;
  callbackUrl?: string;
  callbackFrom?: string;
}

export interface DispatchResponse {
  taskId: TaskId;
  status: TaskStatusValue;
}

export interface PlanStepSpec {
  id: string;
  worker: WorkerName;
  label?: string;
  task: string;
  dependsOn: string[];
  timeoutSeconds?: number;
  retry?: {
    maxRetries: number;
    backoffMs?: number;
    onExhausted?: 'skip' | 'fail';
  };
  condition?: { stepId: string; check: TaskStatusValue };
}

export interface PlanRequest {
  goal: string;
  acceptance?: string;
  steps: PlanStepSpec[];
  maxIterations?: number;
  failurePolicy?: 'none' | 'cancel-dependents' | 'cancel-all';
  callbackUrl?: string;
  callbackFrom?: string;
}

export interface PlanResponse {
  planId: PlanId;
  status: 'executing' | 'completed' | 'failed';
  steps: number;
}

export interface AccomplishRequest {
  goal: string;
  acceptance?: string;
  callbackUrl?: string;
  callbackFrom?: string;
}

export interface AccomplishResponse {
  planId: PlanId;
  status: 'executing' | 'completed' | 'failed';
  goal: string;
  plan: {
    goal: string;
    acceptance?: string;
    steps: Array<{ id: string; worker: WorkerName; label?: string; dependsOn: string[] }>;
  };
}

export interface TaskStatus {
  id: TaskId;
  worker: WorkerName;
  status: TaskStatusValue;
  result?: string;
  error?: string;
  retryCount?: number;
}

export interface PlanStatus {
  planId: PlanId;
  goal: string;
  totalSteps: number;
  completed: number;
  failed: number;
  accepted?: boolean;
  steps: Array<{ id: string; status: TaskStatusValue; label?: string }>;
}

export interface HealthResponse {
  status: 'ok' | string;
  service: string;
  workers: WorkerName[];
  tasks: number;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

// ── Typed errors ──────────────────────────────────────────────────────

export class MiddlewareError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'MiddlewareError';
  }
}

export class MiddlewareOfflineError extends MiddlewareError {
  constructor(baseUrl: string, cause?: unknown) {
    super(`middleware offline at ${baseUrl}`, cause);
    this.name = 'MiddlewareOfflineError';
  }
}

export class MiddlewareValidationError extends MiddlewareError {
  constructor(message: string, public errors?: string[]) {
    super(message);
    this.name = 'MiddlewareValidationError';
  }
}

export class TaskFailedError extends MiddlewareError {
  constructor(public taskId: TaskId, message: string) {
    super(`task ${taskId} failed: ${message}`);
    this.name = 'TaskFailedError';
  }
}

export class WaitTimeoutError extends MiddlewareError {
  constructor(public taskId: TaskId, public elapsedMs: number) {
    super(`task ${taskId} did not complete within ${elapsedMs}ms`);
    this.name = 'WaitTimeoutError';
  }
}

// ── Transport: swappable layer ────────────────────────────────────────

export interface Transport {
  request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
}

export class HttpTransport implements Transport {
  constructor(
    public baseUrl: string,
    private timeoutMs = 30000,
  ) {}

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    signal?.addEventListener('abort', () => ac.abort(), { once: true });

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      throw new MiddlewareOfflineError(this.baseUrl, e);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const msg = (parsed as { error?: string })?.error ?? `HTTP ${res.status}`;
      const errs = (parsed as { errors?: string[] })?.errors;
      if (res.status === 400 && errs) throw new MiddlewareValidationError(msg, errs);
      throw new MiddlewareError(`${method} ${path}: ${msg}`);
    }

    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Client: the stable API callers depend on ──────────────────────────

export interface MiddlewareClient {
  dispatch(req: DispatchRequest): Promise<DispatchResponse>;
  plan(req: PlanRequest): Promise<PlanResponse>;
  accomplish(req: AccomplishRequest): Promise<AccomplishResponse>;
  status(id: TaskId): Promise<TaskStatus>;
  planStatus(id: PlanId): Promise<PlanStatus>;
  waitFor(id: TaskId, opts?: WaitOptions): Promise<TaskStatus>;
  waitForPlan(id: PlanId, opts?: WaitOptions): Promise<PlanStatus>;
  health(): Promise<HealthResponse>;
  listWorkers(): Promise<WorkerName[]>;
  cancel(id: TaskId): Promise<void>;
  cancelPlan(id: PlanId): Promise<void>;
}

export interface CreateClientOptions {
  baseUrl?: string;
  transport?: Transport;
  requestTimeoutMs?: number;
}

export function createMiddlewareClient(opts: CreateClientOptions = {}): MiddlewareClient {
  const baseUrl = opts.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
  const transport = opts.transport ?? new HttpTransport(baseUrl, opts.requestTimeoutMs);

  const client: MiddlewareClient = {
    dispatch: (req) => transport.request('POST', '/dispatch', req),
    plan: (req) => transport.request('POST', '/plan', req),
    accomplish: (req) => transport.request('POST', '/accomplish', req),
    status: (id) => transport.request('GET', `/status/${encodeURIComponent(id)}`),
    planStatus: (id) => transport.request('GET', `/plan/${encodeURIComponent(id)}`),
    health: () => transport.request('GET', '/health'),
    cancel: (id) =>
      transport.request<void>('DELETE', `/task/${encodeURIComponent(id)}`),
    cancelPlan: (id) =>
      transport.request<void>('DELETE', `/plan/${encodeURIComponent(id)}`),

    async listWorkers() {
      const h = await client.health();
      return h.workers;
    },

    async waitFor(id, wopts = {}) {
      return waitForTerminal(() => client.status(id), id, wopts);
    },

    async waitForPlan(id, wopts = {}) {
      const terminal = (s: PlanStatus) =>
        s.completed + s.failed >= s.totalSteps ? s : null;
      const pollMs = wopts.pollMs ?? 2000;
      const timeoutMs = wopts.timeoutMs ?? 120000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (wopts.signal?.aborted) throw new MiddlewareError('aborted');
        const s = await client.planStatus(id);
        const done = terminal(s);
        if (done) return done;
        await sleep(pollMs, wopts.signal);
      }
      throw new WaitTimeoutError(id, timeoutMs);
    },
  };

  return client;
}

async function waitForTerminal(
  fetchStatus: () => Promise<TaskStatus>,
  id: TaskId,
  opts: WaitOptions,
): Promise<TaskStatus> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new MiddlewareError('aborted');
    const s = await fetchStatus();
    if (s.status === 'completed' || s.status === 'cancelled' || s.status === 'skipped') {
      return s;
    }
    if (s.status === 'failed') {
      throw new TaskFailedError(id, s.error ?? 'unknown');
    }
    await sleep(pollMs, opts.signal);
  }
  throw new WaitTimeoutError(id, timeoutMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MiddlewareError('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new MiddlewareError('aborted'));
    }, { once: true });
  });
}

// ── Lazy-initialized default client ──────────────────────────────────

let _default: MiddlewareClient | undefined;

export function middleware(): MiddlewareClient {
  if (!_default) _default = createMiddlewareClient();
  return _default;
}

export function resetDefaultClient(): void {
  _default = undefined;
}
