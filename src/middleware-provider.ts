/**
 * Middleware Provider Adapter.
 *
 * This lets BrainRuntime use the existing agent-middleware workers as one
 * execution backend without making middleware the brain orchestration core.
 */

import type {
  BrainProvider,
  BrainRequest,
  BrainResult,
  ProviderCapabilities,
  ProviderHealth,
  ProviderId,
  WorkIntent,
} from './brain-types.js';
import {
  middleware,
  TaskFailedError,
  WaitTimeoutError,
  type MiddlewareClient,
  type TaskStatus,
  type TaskStatusValue,
  type WorkerName,
} from './middleware-client.js';

export interface MiddlewareProviderOptions {
  id: ProviderId;
  worker: WorkerName;
  client?: MiddlewareClient;
  capabilities?: Partial<ProviderCapabilities>;
  pollMs?: number;
}

const DEFAULT_BEST_FOR: Record<ProviderId, WorkIntent[]> = {
  claude: ['chat', 'plan', 'research', 'summarize', 'review', 'architecture', 'memory', 'policy'],
  codex: ['code', 'diagnose', 'verify', 'review'],
  local: ['chat', 'summarize', 'json', 'memory'],
  shell: ['verify', 'json'],
};

const DEFAULT_CAN_WRITE: Record<ProviderId, boolean> = {
  claude: false,
  codex: true,
  local: false,
  shell: false,
};

export class MiddlewareProvider implements BrainProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  private readonly worker: WorkerName;
  private readonly client: MiddlewareClient;
  private readonly pollMs: number;

  constructor(opts: MiddlewareProviderOptions) {
    this.id = opts.id;
    this.worker = opts.worker;
    this.client = opts.client ?? middleware();
    this.pollMs = opts.pollMs ?? 2000;
    this.capabilities = {
      canWrite: DEFAULT_CAN_WRITE[opts.id],
      canUseShell: opts.id === 'shell',
      canUseMcp: false,
      bestFor: DEFAULT_BEST_FOR[opts.id],
      ...opts.capabilities,
    };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const health = await this.client.health();
      const available = health.status === 'ok' && health.workers.includes(this.worker);
      return {
        available,
        detail: available
          ? `middleware worker ${this.worker} available`
          : `middleware worker ${this.worker} unavailable`,
      };
    } catch (err) {
      return {
        available: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async run(req: BrainRequest): Promise<BrainResult> {
    const startedAt = Date.now();
    try {
      const dispatch = await this.client.dispatch({
        worker: this.worker,
        task: this.formatTask(req),
        timeoutSeconds: Math.max(1, Math.ceil(req.timeoutMs / 1000)),
        cwd: req.cwd,
      });
      const status = await this.client.waitFor(dispatch.taskId, {
        timeoutMs: req.timeoutMs,
        pollMs: this.pollMs,
      });
      return this.resultFromStatus(status, startedAt);
    } catch (err) {
      return this.errorResult(err, startedAt);
    }
  }

  async abort(taskId: string, _reason: string): Promise<void> {
    await this.client.cancel(taskId);
  }

  private formatTask(req: BrainRequest): string {
    if (this.id === 'shell') return req.prompt;
    const parts = [
      req.systemPrompt.trim(),
      `<brain-request task="${req.taskId}" intent="${req.intent}" risk="${req.risk}" source="${req.source}">`,
      req.prompt.trim(),
      '</brain-request>',
    ].filter(Boolean);
    return parts.join('\n\n');
  }

  private resultFromStatus(status: TaskStatus, startedAt: number): BrainResult {
    return {
      provider: this.id,
      text: status.result ?? status.error ?? '',
      toolCalls: [],
      usage: { middlewareTaskId: status.id, worker: status.worker, retryCount: status.retryCount },
      durationMs: Date.now() - startedAt,
      finishReason: finishReasonFromStatus(status.status),
    };
  }

  private errorResult(err: unknown, startedAt: number): BrainResult {
    const finishReason = err instanceof WaitTimeoutError
      ? 'timeout'
      : err instanceof TaskFailedError ? 'error' : 'error';
    return {
      provider: this.id,
      text: err instanceof Error ? err.message : String(err),
      toolCalls: [],
      usage: { worker: this.worker },
      durationMs: Date.now() - startedAt,
      finishReason,
    };
  }
}

export function createDefaultMiddlewareProviders(client?: MiddlewareClient): BrainProvider[] {
  return [
    new MiddlewareProvider({ id: 'claude', worker: 'agent-brain', client }),
    new MiddlewareProvider({ id: 'codex', worker: 'coder', client }),
    new MiddlewareProvider({ id: 'local', worker: 'agent-brain', client, capabilities: { canWrite: false } }),
    new MiddlewareProvider({ id: 'shell', worker: 'shell', client, capabilities: { canUseShell: true } }),
  ];
}

function finishReasonFromStatus(status: TaskStatusValue): BrainResult['finishReason'] {
  switch (status) {
    case 'completed': return 'success';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'error';
    default: return 'error';
  }
}
