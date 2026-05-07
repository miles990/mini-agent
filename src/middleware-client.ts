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
  // cwd: working dir for subprocess. mini-agent allocates forge worktree for
  // `code` worker and passes path; middleware spawns in that cwd.
  cwd?: string;
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
  /**
   * Per-step stall-kill cap in seconds (overrides worker-level progressTimeoutSeconds).
   * Used by shell worker to abort on no-stdout idle; prevents LLM-heavy pipelines
   * from being killed by the default worker stall cap during long LLM round-trips.
   */
  progressTimeoutSeconds?: number;
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
  /** Convergence condition — observable end state (maps to middleware success_criteria) */
  acceptance?: string;
  /** Worker routing constraints (brain respects but may override) */
  constraints?: {
    /** Preferred workers — hard pin (e.g. ['coder', 'shell']) */
    must_use?: string[];
    /** Workers to avoid */
    must_not?: string[];
    max_latency_ms?: number;
    max_cost_usd?: number;
  };
  /** Extra context for brain (cwd, sibling info, etc.) */
  context?: {
    caller_identity?: string;
    extra?: string;
    /** Previous failed attempts — brain uses this to avoid repeating mistakes */
    prior_attempts?: Array<{ error?: string; tried?: string }>;
  };
  callbackUrl?: string;
  callbackFrom?: string;
  /** If true, wait for plan completion before returning */
  wait?: boolean;
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
  steps: Array<{ id: string; status: TaskStatusValue; label?: string; error?: string; result?: string }>;
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

// ── Commitments ledger (P1-d, proposal v2 §5) ─────────────────────────

export type CommitmentStatus = 'active' | 'fulfilled' | 'superseded' | 'cancelled';
export type CommitmentResolutionKind = 'commit' | 'chat' | 'task-close' | 'supersede' | 'cancel';
// free-form string, max 64 chars (server-enforced). Examples: 'kuro', 'cc',
// 'alex', 'akari', or any external agent/user identifier. See [2026-04-15-279].
export type CommitmentOwner = string;

export interface CommitmentSource {
  channel: 'room' | 'inner' | 'delegate' | 'user-prompt';
  message_id?: string;
  cycle_id?: string;
}

export interface CommitmentCreate {
  owner: CommitmentOwner;
  source: CommitmentSource;
  text: string;
  parsed: { action: string; deadline?: string; to?: string };
  acceptance: string;
  linked_task_id?: string;
  linked_dag_id?: string;
}

export interface Commitment extends CommitmentCreate {
  id: string;
  created_at: string;
  status: CommitmentStatus;
  resolved_at?: string;
  resolution?: { kind: CommitmentResolutionKind; evidence: string; note?: string };
}

export interface CommitmentQuery {
  status?: CommitmentStatus;
  owner?: CommitmentOwner;
  channel?: CommitmentSource['channel'];
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

export class MiddlewareCircuitOpenError extends MiddlewareError {
  constructor(
    public baseUrl: string,
    public retryAt: string,
    public failureCount: number,
  ) {
    super(`middleware circuit open at ${baseUrl}; retry after ${retryAt} (${failureCount} offline failures)`);
    this.name = 'MiddlewareCircuitOpenError';
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
      const err = e as Error & { cause?: { code?: string } };
      if (err.name === 'AbortError') {
        throw new MiddlewareError(`${method} ${path} timed out after ${this.timeoutMs}ms`, e);
      }
      const code = err.cause?.code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
        throw new MiddlewareOfflineError(this.baseUrl, e);
      }
      throw new MiddlewareError(`${method} ${path}: ${err.message}`, e);
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
  createCommitment(req: CommitmentCreate): Promise<{ id: string; created_at: string }>;
  getCommitment(id: string): Promise<Commitment>;
  resolveCommitment(id: string, resolution: { kind: CommitmentResolutionKind; evidence: string; note?: string }): Promise<void>;
  listCommitments(query?: CommitmentQuery): Promise<Commitment[]>;
}

export interface CreateClientOptions {
  baseUrl?: string;
  transport?: Transport;
  requestTimeoutMs?: number;
  circuitBreaker?: false | Partial<MiddlewareCircuitConfig>;
}

export interface MiddlewareCircuitConfig {
  failureThreshold: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export interface MiddlewareCircuitState {
  baseUrl: string;
  state: 'closed' | 'open';
  failureCount: number;
  openedUntil?: string;
  lastFailureAt?: string;
}

const DEFAULT_CIRCUIT: MiddlewareCircuitConfig = {
  failureThreshold: 3,
  initialBackoffMs: 5 * 60 * 1000,
  maxBackoffMs: 60 * 60 * 1000,
};

const circuitStates = new Map<string, {
  failureCount: number;
  openedUntilMs: number;
  lastFailureAtMs?: number;
}>();

export function createMiddlewareClient(opts: CreateClientOptions = {}): MiddlewareClient {
  const baseUrl = opts.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
  const transport = opts.transport ?? new HttpTransport(baseUrl, opts.requestTimeoutMs);
  const circuitConfig = opts.circuitBreaker === false
    ? null
    : { ...DEFAULT_CIRCUIT, ...(opts.circuitBreaker ?? {}) };

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (circuitConfig && isCircuitGatedPath(method, path)) {
      assertCircuitAllows(baseUrl);
    }

    try {
      const result = await transport.request<T>(method, path, body, signal);
      if (circuitConfig && (path === '/health' || isCircuitGatedPath(method, path))) {
        resetMiddlewareCircuitBreaker(baseUrl);
      }
      return result;
    } catch (err) {
      if (circuitConfig && err instanceof MiddlewareOfflineError) {
        recordMiddlewareOfflineFailure(baseUrl, circuitConfig);
      }
      throw err;
    }
  }

  const client: MiddlewareClient = {
    dispatch: (req) => request('POST', '/dispatch', req),
    plan: (req) => request('POST', '/plan', req),
    accomplish: (req) => {
      // Map AccomplishRequest fields to middleware's body schema
      const body: Record<string, unknown> = { goal: req.goal };
      if (req.acceptance) body.success_criteria = req.acceptance;
      if (req.constraints) body.constraints = req.constraints;
      if (req.context) body.context = req.context;
      if (req.callbackUrl) body.callback = req.callbackUrl;
      if (req.callbackFrom) body.callbackFrom = req.callbackFrom;
      if (req.wait) body.wait = req.wait;
      return request('POST', '/accomplish', body);
    },
    status: (id) => request('GET', `/status/${encodeURIComponent(id)}`),
    planStatus: (id) => request('GET', `/plan/${encodeURIComponent(id)}`),
    health: () => request('GET', '/health'),
    cancel: (id) =>
      request<void>('DELETE', `/task/${encodeURIComponent(id)}`),
    cancelPlan: (id) =>
      request<void>('DELETE', `/plan/${encodeURIComponent(id)}`),

    createCommitment: (req) => request('POST', '/commit', req),
    getCommitment: (id) => request('GET', `/commit/${encodeURIComponent(id)}`),
    resolveCommitment: (id, resolution) =>
      request<void>('PATCH', `/commit/${encodeURIComponent(id)}`, {
        status: 'fulfilled',
        resolution,
      }),
    listCommitments: (query = {}) => {
      const qs = new URLSearchParams();
      if (query.status) qs.set('status', query.status);
      if (query.owner) qs.set('owner', query.owner);
      if (query.channel) qs.set('channel', query.channel);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/commits${suffix}`);
    },

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

export function getMiddlewareCircuitState(baseUrl = process.env.MIDDLEWARE_URL ?? 'http://localhost:3200'): MiddlewareCircuitState {
  const state = circuitStates.get(baseUrl);
  const openedUntilMs = state?.openedUntilMs ?? 0;
  const open = openedUntilMs > Date.now();
  return {
    baseUrl,
    state: open ? 'open' : 'closed',
    failureCount: state?.failureCount ?? 0,
    ...(open ? { openedUntil: new Date(openedUntilMs).toISOString() } : {}),
    ...(state?.lastFailureAtMs ? { lastFailureAt: new Date(state.lastFailureAtMs).toISOString() } : {}),
  };
}

export function resetMiddlewareCircuitBreaker(baseUrl?: string): void {
  if (baseUrl) {
    circuitStates.delete(baseUrl);
    return;
  }
  circuitStates.clear();
}

function assertCircuitAllows(baseUrl: string): void {
  const state = circuitStates.get(baseUrl);
  if (!state || state.openedUntilMs <= Date.now()) return;
  throw new MiddlewareCircuitOpenError(
    baseUrl,
    new Date(state.openedUntilMs).toISOString(),
    state.failureCount,
  );
}

function recordMiddlewareOfflineFailure(baseUrl: string, config: MiddlewareCircuitConfig): void {
  const now = Date.now();
  const state = circuitStates.get(baseUrl) ?? { failureCount: 0, openedUntilMs: 0 };
  const failureCount = state.failureCount + 1;
  const openedUntilMs = failureCount >= config.failureThreshold
    ? now + backoffForFailure(failureCount, config)
    : 0;
  circuitStates.set(baseUrl, { failureCount, openedUntilMs, lastFailureAtMs: now });
}

function backoffForFailure(failureCount: number, config: MiddlewareCircuitConfig): number {
  const exponent = Math.max(0, failureCount - config.failureThreshold);
  return Math.min(config.maxBackoffMs, config.initialBackoffMs * (2 ** exponent));
}

function isCircuitGatedPath(method: string, path: string): boolean {
  return method === 'POST' && ['/dispatch', '/plan', '/accomplish'].includes(path);
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
