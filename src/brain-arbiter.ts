/**
 * Brain Arbiter — choose deliberation mode and actors for a work item.
 *
 * The scheduler decides which task gets attention. The arbiter decides who
 * should think, who may write, and whether peer review is worth the cost.
 */

import type { ActorId, ArbitrationDecision, WorkIntent, WorkItem } from './brain-types.js';

const CHEAP_LOCAL_INTENTS = new Set<WorkIntent>(['json', 'summarize']);
const CODING_INTENTS = new Set<WorkIntent>(['code', 'diagnose']);
const PEER_REVIEW_INTENTS = new Set<WorkIntent>(['architecture', 'memory', 'policy']);
const REVIEW_INTENTS = new Set<WorkIntent>(['review', 'plan', 'research']);

export interface ArbiterOptions {
  availableActors?: ActorId[];
  forceAkariForP0?: boolean;
}

const DEFAULT_ACTORS: ActorId[] = ['claude', 'codex', 'local', 'shell', 'akari'];

export class BrainArbiter {
  private readonly actors: Set<ActorId>;
  private readonly forceAkariForP0: boolean;

  constructor(opts: ArbiterOptions = {}) {
    this.actors = new Set(opts.availableActors ?? DEFAULT_ACTORS);
    this.forceAkariForP0 = opts.forceAkariForP0 ?? false;
  }

  decide(item: WorkItem): ArbitrationDecision {
    if (item.risk === 'deploy' || item.risk === 'external_write') {
      return this.decision({
        mode: 'human',
        primary: 'human',
        candidates: ['human'],
        reviewers: ['kuro'],
        reason: `${item.risk} requires human approval before execution`,
        writeLeaseRequired: item.writeScope?.length ? true : false,
        kgClaimsRequired: true,
        humanApprovalRequired: true,
      });
    }

    if (item.intent === 'verify') {
      return this.decision({
        mode: 'solo',
        primary: this.pick('shell', 'local'),
        candidates: [this.pick('shell', 'local')],
        reviewers: [],
        reason: 'deterministic verification belongs to shell/local execution',
        writeLeaseRequired: false,
        kgClaimsRequired: false,
        humanApprovalRequired: false,
      });
    }

    if (CHEAP_LOCAL_INTENTS.has(item.intent) && item.risk === 'read_only') {
      const primary = this.pick('local', 'claude');
      return this.decision({
        mode: 'solo',
        primary,
        candidates: [primary],
        reviewers: [],
        reason: `${item.intent} is cheap and read-only`,
        writeLeaseRequired: false,
        kgClaimsRequired: item.priority === 'P0',
        humanApprovalRequired: false,
      });
    }

    const needsAkari = this.needsPeerCritic(item);
    if (needsAkari) {
      const candidates = this.filterAvailable(['claude', 'codex', 'akari']);
      return this.decision({
        mode: item.hasProviderConflict ? 'consensus' : 'panel',
        primary: 'kuro',
        candidates,
        reviewers: candidates.filter(a => a !== 'kuro'),
        reason: this.peerReason(item),
        writeLeaseRequired: item.risk === 'workspace_write',
        kgClaimsRequired: true,
        humanApprovalRequired: false,
      });
    }

    if (CODING_INTENTS.has(item.intent) || item.risk === 'workspace_write') {
      const primary = this.pick('codex', 'claude');
      const reviewer = primary === 'codex' ? this.pickOptional('claude') : this.pickOptional('codex');
      return this.decision({
        mode: reviewer ? 'split' : 'solo',
        primary,
        candidates: this.filterAvailable([primary, reviewer].filter(Boolean) as ActorId[]),
        reviewers: reviewer ? [reviewer] : [],
        reason: 'coding or diagnosis work benefits from a dedicated implementation lane and separate review',
        writeLeaseRequired: item.risk === 'workspace_write' || Boolean(item.writeScope?.length),
        kgClaimsRequired: true,
        humanApprovalRequired: false,
      });
    }

    if (REVIEW_INTENTS.has(item.intent)) {
      const primary = this.pick('claude', 'codex');
      const reviewer = this.pickOptional(primary === 'claude' ? 'codex' : 'claude');
      return this.decision({
        mode: reviewer ? 'race' : 'solo',
        primary,
        candidates: this.filterAvailable([primary, reviewer].filter(Boolean) as ActorId[]),
        reviewers: reviewer ? [reviewer] : [],
        reason: `${item.intent} benefits from independent second-pass judgment`,
        writeLeaseRequired: false,
        kgClaimsRequired: true,
        humanApprovalRequired: false,
      });
    }

    const primary = this.pick('claude', 'codex');
    return this.decision({
      mode: 'solo',
      primary,
      candidates: [primary],
      reviewers: [],
      reason: 'default semantic work uses the strongest available language lane',
      writeLeaseRequired: false,
      kgClaimsRequired: item.priority === 'P0',
      humanApprovalRequired: false,
    });
  }

  private needsPeerCritic(item: WorkItem): boolean {
    return item.hasProviderConflict === true
      || PEER_REVIEW_INTENTS.has(item.intent)
      || (this.forceAkariForP0 && item.priority === 'P0')
      || item.tags?.some(t => ['architecture', 'soul', 'memory', 'policy', 'kg'].includes(t.toLowerCase())) === true;
  }

  private peerReason(item: WorkItem): string {
    if (item.hasProviderConflict) return 'provider conflict needs peer critique before convergence';
    if (PEER_REVIEW_INTENTS.has(item.intent)) return `${item.intent} work has high long-term coupling and needs Akari critique`;
    if (item.priority === 'P0') return 'P0 work is configured to request Akari critique';
    return 'task tags indicate peer critique is worth the added cost';
  }

  private decision(decision: ArbitrationDecision): ArbitrationDecision {
    return {
      ...decision,
      candidates: this.filterAvailable(decision.candidates),
      reviewers: this.filterAvailable(decision.reviewers),
    };
  }

  private pick(primary: ActorId, fallback: ActorId): ActorId {
    if (this.actors.has(primary)) return primary;
    if (this.actors.has(fallback)) return fallback;
    return 'kuro';
  }

  private pickOptional(actor: ActorId): ActorId | null {
    return this.actors.has(actor) ? actor : null;
  }

  private filterAvailable(actors: ActorId[]): ActorId[] {
    return actors.filter(a => a === 'human' || a === 'kuro' || this.actors.has(a));
  }
}

export function decideArbitration(item: WorkItem, opts?: ArbiterOptions): ArbitrationDecision {
  return new BrainArbiter(opts).decide(item);
}
