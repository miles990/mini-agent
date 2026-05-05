/**
 * Middleware Peer Agent Adapter.
 *
 * Peer agents keep their own identity and claims while reusing middleware as a
 * transport. This is intentionally separate from MiddlewareProvider: Akari and
 * Tanren are critics/designers, not provider fallbacks.
 */

import type { PeerAgentId, ProviderHealth } from './brain-types.js';
import type { PeerAgent, PeerConsultRequest, PeerConsultResult } from './peer-agent.js';
import {
  middleware,
  WaitTimeoutError,
  type MiddlewareClient,
  type WorkerName,
} from './middleware-client.js';

export interface MiddlewarePeerAgentOptions {
  id: PeerAgentId;
  worker: WorkerName;
  client?: MiddlewareClient;
  pollMs?: number;
  timeoutMs?: number;
}

export class MiddlewarePeerAgent implements PeerAgent {
  readonly id: PeerAgentId;
  private readonly worker: WorkerName;
  private readonly client: MiddlewareClient;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(opts: MiddlewarePeerAgentOptions) {
    this.id = opts.id;
    this.worker = opts.worker;
    this.client = opts.client ?? middleware();
    this.pollMs = opts.pollMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const health = await this.client.health();
      const available = health.status === 'ok' && health.workers.includes(this.worker);
      return {
        available,
        detail: available
          ? `middleware peer ${this.id} via ${this.worker} available`
          : `middleware peer ${this.id} via ${this.worker} unavailable`,
      };
    } catch (err) {
      return {
        available: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async consult(req: PeerConsultRequest): Promise<PeerConsultResult> {
    try {
      const dispatch = await this.client.dispatch({
        worker: this.worker,
        task: this.formatTask(req),
        timeoutSeconds: Math.ceil(this.timeoutMs / 1000),
      });
      const status = await this.client.waitFor(dispatch.taskId, {
        timeoutMs: this.timeoutMs,
        pollMs: this.pollMs,
      });
      return {
        peer: this.id,
        response: status.result ?? status.error ?? '',
        critiques: [],
        recommendations: [],
        claims: [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        peer: this.id,
        response: message,
        critiques: [message],
        recommendations: err instanceof WaitTimeoutError ? ['retry with a narrower brief'] : [],
        claims: [],
      };
    }
  }

  private formatTask(req: PeerConsultRequest): string {
    return [
      `<peer-consult peer="${this.id}" role="${req.requestedRole}" task="${req.task.id}">`,
      `Title: ${req.task.title}`,
      `Intent: ${req.task.intent}`,
      `Risk: ${req.task.risk}`,
      req.contextPacket ? `Context:\n${req.contextPacket}` : '',
      `Brief:\n${req.brief}`,
      '</peer-consult>',
    ].filter(Boolean).join('\n\n');
  }
}

export function createDefaultMiddlewarePeers(client?: MiddlewareClient): PeerAgent[] {
  const peers: PeerAgent[] = [
    new MiddlewarePeerAgent({ id: 'akari', worker: process.env.AKARI_MIDDLEWARE_WORKER ?? 'cloud-agent', client }),
  ];
  if (process.env.TANREN_MIDDLEWARE_WORKER) {
    peers.push(new MiddlewarePeerAgent({ id: 'tanren', worker: process.env.TANREN_MIDDLEWARE_WORKER, client }));
  }
  return peers;
}
