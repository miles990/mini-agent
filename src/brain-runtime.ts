/**
 * Brain Runtime — execute arbiter decisions through provider/peer adapters.
 *
 * The arbiter decides who should think. The runtime turns that decision into
 * health-checked execution, fallback, and provider claims.
 */

import { appendProviderClaim } from './claim-ledger.js';
import { appendBrainRunEvent } from './brain-run-ledger.js';
import type { BrainRunEvent } from './brain-run-ledger.js';
import type {
  ActorId,
  ArbitrationDecision,
  BrainProvider,
  BrainRequest,
  BrainResult,
  PeerAgentId,
  ProviderHealth,
  ProviderId,
  WorkItem,
} from './brain-types.js';
import type { PeerAgent, PeerConsultResult } from './peer-agent.js';
import { createProviderClaim, type ProviderClaim } from './provider-claims.js';
import { coordinateAsKuro, type KuroCoordinationResult } from './internal-kuro-coordinator.js';
import { eventBus } from './event-bus.js';

export interface BrainRuntimeOptions {
  providers?: BrainProvider[];
  peers?: PeerAgent[];
  memoryDir?: string;
}

export interface BrainExecutionInput {
  workItem: WorkItem;
  request: BrainRequest;
  decision: ArbitrationDecision;
}

export interface BrainActorRun {
  actor: ActorId;
  role: 'primary' | 'candidate' | 'reviewer' | 'coordinator';
  status: 'success' | 'skipped' | 'failed';
  health?: ProviderHealth;
  result?: BrainResult | PeerConsultResult | KuroCoordinationResult;
  claimIds: string[];
  error?: string;
}

export interface BrainRuntimeResult {
  taskId: string;
  decision: ArbitrationDecision;
  primary: ActorId | null;
  runs: BrainActorRun[];
  claims: ProviderClaim[];
  status: 'success' | 'partial' | 'failed' | 'skipped';
}

export class BrainRuntime {
  private readonly providers = new Map<ProviderId, BrainProvider>();
  private readonly peers = new Map<PeerAgentId, PeerAgent>();
  private readonly memoryDir?: string;

  constructor(opts: BrainRuntimeOptions = {}) {
    for (const provider of opts.providers ?? []) this.providers.set(provider.id, provider);
    for (const peer of opts.peers ?? []) this.peers.set(peer.id, peer);
    this.memoryDir = opts.memoryDir;
  }

  async execute(input: BrainExecutionInput): Promise<BrainRuntimeResult> {
    const startedAt = Date.now();
    if (input.decision.humanApprovalRequired || input.decision.primary === 'human') {
      this.observe(input, {
        event: 'runtime_started',
        status: 'skipped',
        primary: input.decision.primary,
        mode: input.decision.mode,
        rationale: input.decision.reason,
        detail: 'human approval required before execution',
      });
      return this.result(input, null, [{
        actor: 'human',
        role: 'primary',
        status: 'skipped',
        claimIds: [],
        error: 'human approval required before execution',
      }], []);
    }

    const plan = this.executionPlan(input.decision);
    const runs: BrainActorRun[] = [];
    const claims: ProviderClaim[] = [];
    let executedPrimary: ActorId | null = null;

    this.observe(input, {
      event: 'runtime_started',
      status: 'running',
      primary: input.decision.primary,
      mode: input.decision.mode,
      rationale: input.decision.reason,
      detail: `planned actors: ${plan.map(step => `${step.actor}:${step.role}`).join(', ') || 'none'}`,
    });

    for (const step of plan) {
      this.observe(input, {
        event: 'actor_queued',
        status: 'queued',
        actor: step.actor,
        role: step.role,
        primary: input.decision.primary,
        mode: input.decision.mode,
        rationale: roleRationale(input.decision.reason, step.role),
      });
    }

    for (const step of plan) {
      const run = await this.runActor(input, step.actor, step.role);
      runs.push(run);
      claims.push(...this.claimsForRun(input, run));
      if (!executedPrimary && run.status === 'success') {
        executedPrimary = step.actor;
      }

      if (input.decision.mode === 'solo' && run.status === 'success') break;
    }

    if (input.decision.primary === 'kuro' && runs.some(run => run.status === 'success')) {
      this.observe(input, {
        event: 'actor_started',
        status: 'running',
        actor: 'kuro',
        role: 'coordinator',
        primary: 'kuro',
        mode: input.decision.mode,
        rationale: 'synthesize provider and peer outputs into one observable decision',
      });
      const run = this.coordinateKuro(input, runs);
      runs.push(run);
      this.observeRun(input, run, Date.now(), 'synthesized panel outputs');
      claims.push(...this.claimsForRun(input, run));
      executedPrimary = 'kuro';
    }

    for (const claim of claims) {
      if (this.memoryDir) appendProviderClaim(this.memoryDir, claim);
      this.observe(input, {
        event: 'claim_written',
        status: 'success',
        actor: claim.provider,
        primary: executedPrimary,
        mode: input.decision.mode,
        claimIds: [claim.id],
        detail: `${claim.provider} ${claim.predicate} ${claim.subject}`,
      });
      const run = runs.find(r => r.actor === claim.provider && r.status === 'success');
      if (run) run.claimIds.push(claim.id);
    }

    const result = this.result(input, executedPrimary, runs, claims);
    this.observe(input, {
      event: 'runtime_finished',
      status: result.status,
      primary: result.primary,
      mode: result.decision.mode,
      durationMs: Date.now() - startedAt,
      claimIds: claims.map(claim => claim.id),
      detail: `runs=${runs.length} claims=${claims.length}`,
    });
    return result;
  }

  private executionPlan(decision: ArbitrationDecision): Array<{ actor: ActorId; role: BrainActorRun['role'] }> {
    if (decision.mode === 'solo') {
      return uniqueActors([decision.primary, ...decision.candidates])
        .filter(actor => actor !== 'kuro')
        .map(actor => ({ actor, role: actor === decision.primary ? 'primary' : 'candidate' }));
    }

    const candidates = decision.mode === 'split'
      ? uniqueActors([decision.primary, ...decision.reviewers])
      : uniqueActors([...decision.candidates, ...decision.reviewers]);

    return candidates
      .filter(actor => actor !== 'kuro' && actor !== 'human')
      .map(actor => ({
        actor,
        role: actor === decision.primary
          ? 'primary'
          : decision.reviewers.includes(actor) ? 'reviewer' : 'candidate',
      }));
  }

  private async runActor(
    input: BrainExecutionInput,
    actor: ActorId,
    role: BrainActorRun['role'],
  ): Promise<BrainActorRun> {
    const startedAt = Date.now();
    this.observe(input, {
      event: 'actor_started',
      status: 'running',
      actor,
      role,
      primary: input.decision.primary,
      mode: input.decision.mode,
      rationale: roleRationale(input.decision.reason, role),
    });
    const adapter = this.adapterFor(actor);
    if (!adapter) {
      const run: BrainActorRun = { actor, role, status: 'skipped', claimIds: [], error: `no adapter registered for ${actor}` };
      this.observeRun(input, run, startedAt);
      return run;
    }

    try {
      const health = await adapter.health();
      if (!health.available) {
        const run: BrainActorRun = { actor, role, status: 'skipped', health, claimIds: [], error: health.detail ?? `${actor} unavailable` };
        this.observeRun(input, run, startedAt);
        return run;
      }

      if (adapter.kind === 'provider') {
        const result = await adapter.provider.run(this.requestForRole(input.request, role, actor));
        const run: BrainActorRun = { actor, role, status: result.finishReason === 'success' ? 'success' : 'failed', health, result, claimIds: [] };
        this.observeRun(input, run, startedAt, summarizeRunResult(run));
        return run;
      }

      const result = await adapter.peer.consult({
        task: input.workItem,
        brief: input.request.prompt,
        requestedRole: role === 'reviewer' ? 'reviewer' : 'critic',
        contextPacket: input.request.systemPrompt,
      });
      const run: BrainActorRun = { actor, role, status: 'success', health, result, claimIds: [] };
      this.observeRun(input, run, startedAt, summarizeRunResult(run));
      return run;
    } catch (err) {
      const run: BrainActorRun = {
        actor,
        role,
        status: 'failed',
        claimIds: [],
        error: err instanceof Error ? err.message : String(err),
      };
      this.observeRun(input, run, startedAt);
      return run;
    }
  }

  private observeRun(input: BrainExecutionInput, run: BrainActorRun, startedAt: number, detail?: string): void {
    this.observe(input, {
      event: 'actor_finished',
      status: run.status,
      actor: run.actor,
      role: run.role,
      primary: input.decision.primary,
      mode: input.decision.mode,
      durationMs: Date.now() - startedAt,
      detail: detail ?? run.error ?? run.health?.detail,
    });
  }

  private observe(input: BrainExecutionInput, event: Omit<BrainRunEvent, 'id' | 'createdAt' | 'taskId'>): void {
    const payload = { taskId: input.request.taskId, ...event };
    if (this.memoryDir) appendBrainRunEvent(this.memoryDir, payload);
    eventBus.emit('action:brain-state', payload);
  }

  private adapterFor(actor: ActorId):
    | { kind: 'provider'; provider: BrainProvider; health: () => Promise<ProviderHealth> }
    | { kind: 'peer'; peer: PeerAgent; health: () => Promise<ProviderHealth> }
    | null {
    if (isProviderId(actor)) {
      const provider = this.providers.get(actor);
      return provider ? { kind: 'provider', provider, health: () => provider.health() } : null;
    }
    if (isPeerAgentId(actor)) {
      const peer = this.peers.get(actor);
      return peer ? { kind: 'peer', peer, health: () => peer.health() } : null;
    }
    return null;
  }

  private requestForRole(request: BrainRequest, role: BrainActorRun['role'], actor: ActorId): BrainRequest {
    if (role !== 'reviewer') return request;
    return {
      ...request,
      prompt: `Review the proposed work for task ${request.taskId} as ${actor}.\n\n${request.prompt}`,
      risk: 'read_only',
      tools: request.tools?.filter(tool => tool !== 'write' && tool !== 'shell'),
    };
  }

  private claimsForRun(input: BrainExecutionInput, run: BrainActorRun): ProviderClaim[] {
    if (run.status !== 'success' || !run.result) return [];

    if (isKuroCoordinationResult(run.result)) {
      return [createProviderClaim({
        provider: 'kuro',
        taskId: input.request.taskId,
        subject: `task:${input.request.taskId}`,
        predicate: 'coordinated_result',
        object: run.result.response.slice(0, 1000),
        evidence: [`brain-runtime:kuro:${run.role}`],
        confidence: run.result.conflicts.length > 0 ? 0.55 : 0.75,
      })];
    }

    if (isBrainResult(run.result)) {
      return [createProviderClaim({
        provider: run.actor,
        taskId: input.request.taskId,
        subject: `task:${input.request.taskId}`,
        predicate: run.result.finishReason === 'success' ? 'reported_result' : 'reported_failure',
        object: run.result.text.slice(0, 1000),
        evidence: [`brain-runtime:${run.actor}:${run.role}`],
        confidence: run.result.finishReason === 'success' ? 0.7 : 0.4,
      })];
    }

    const peerClaims = run.result.claims.map(claim => createProviderClaim({
      provider: run.actor,
      taskId: input.request.taskId,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      evidence: claim.evidence,
      confidence: claim.confidence,
    }));

    if (peerClaims.length > 0) return peerClaims;
    return [createProviderClaim({
      provider: run.actor,
      taskId: input.request.taskId,
      subject: `task:${input.request.taskId}`,
      predicate: 'reported_review',
      object: run.result.response.slice(0, 1000),
      evidence: [`brain-runtime:${run.actor}:${run.role}`],
      confidence: 0.6,
    })];
  }

  private coordinateKuro(input: BrainExecutionInput, runs: BrainActorRun[]): BrainActorRun {
    const result = coordinateAsKuro({
      workItem: input.workItem,
      decision: input.decision,
      runs: runs.map(run => ({
        actor: run.actor,
        role: run.role,
        status: run.status,
        text: resultText(run.result),
        ...(run.error ? { error: run.error } : {}),
      })),
    });
    return {
      actor: 'kuro',
      role: 'coordinator',
      status: 'success',
      result,
      claimIds: [],
    };
  }

  private result(
    input: BrainExecutionInput,
    primary: ActorId | null,
    runs: BrainActorRun[],
    claims: ProviderClaim[],
  ): BrainRuntimeResult {
    const successes = runs.filter(run => run.status === 'success').length;
    const attempted = runs.filter(run => run.status !== 'skipped').length;
    const status = successes === 0
      ? attempted === 0 ? 'skipped' : 'failed'
      : successes === runs.length ? 'success' : 'partial';

    return {
      taskId: input.request.taskId,
      decision: input.decision,
      primary,
      runs,
      claims,
      status,
    };
  }
}

function uniqueActors(actors: ActorId[]): ActorId[] {
  return [...new Set(actors)];
}

function isProviderId(actor: ActorId): actor is ProviderId {
  return actor === 'claude' || actor === 'codex' || actor === 'local' || actor === 'shell';
}

function isPeerAgentId(actor: ActorId): actor is PeerAgentId {
  return actor === 'akari' || actor === 'tanren';
}

function isBrainResult(result: BrainResult | PeerConsultResult | KuroCoordinationResult): result is BrainResult {
  return 'finishReason' in result;
}

function isKuroCoordinationResult(
  result: BrainResult | PeerConsultResult | KuroCoordinationResult,
): result is KuroCoordinationResult {
  return 'coordinator' in result && result.coordinator === 'kuro';
}

function resultText(result: BrainActorRun['result']): string {
  if (!result) return '';
  if (isBrainResult(result)) return result.text;
  if (isKuroCoordinationResult(result)) return result.response;
  return result.response;
}

function roleRationale(reason: string, role: BrainActorRun['role']): string {
  if (role === 'coordinator') return 'coordinate and resolve multi-brain outputs';
  if (role === 'reviewer') return `review due to arbitration: ${reason}`;
  if (role === 'candidate') return `compete or complement due to arbitration: ${reason}`;
  return reason;
}

function summarizeRunResult(run: BrainActorRun): string {
  if (!run.result) return run.error ?? '';
  const text = resultText(run.result).replace(/\s+/g, ' ').trim();
  return text.slice(0, 300);
}
