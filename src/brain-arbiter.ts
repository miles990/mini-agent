/**
 * Brain Arbiter — choose deliberation mode and actors for a work item.
 *
 * The scheduler decides which task gets attention. The arbiter decides who
 * should think, who may write, and whether peer review is worth the cost.
 */

import type { ActorId, ActorSelectionTrace, ArbitrationDecision, WorkItem } from './brain-types.js';
import {
  deriveConstraintTexture,
  isCheapLocalIntent,
  isCodingIntent,
  isReviewIntent,
  peerCritiqueReason,
} from './constraint-texture.js';
import { getDefaultDispatchableActors, getPeerCritiqueActors, isDispatchableActor } from './actor-registry.js';
import { pickActorForRole, pickActorsForRole, rankActorsForRole, type SelectionRole } from './actor-selection-policy.js';

export interface ArbiterOptions {
  availableActors?: ActorId[];
  forceAkariForP0?: boolean;
}

const DEFAULT_ACTORS: ActorId[] = getDefaultDispatchableActors();

export class BrainArbiter {
  private readonly actors: Set<ActorId>;
  private readonly forceAkariForP0: boolean;

  constructor(opts: ArbiterOptions = {}) {
    this.actors = new Set(opts.availableActors ?? DEFAULT_ACTORS);
    this.forceAkariForP0 = opts.forceAkariForP0 ?? false;
  }

  decide(item: WorkItem): ArbitrationDecision {
    const texture = deriveConstraintTexture(item, { forceAkariForP0: this.forceAkariForP0 });

    if (texture.humanApprovalRequired) {
      return this.decision({
        mode: 'human',
        primary: 'human',
        candidates: ['human'],
        reviewers: ['kuro'],
        reason: `${item.risk} requires human approval before execution`,
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['primary']),
      });
    }

    if (texture.deterministicExecution) {
      const primary = this.pickByRole(item, 'executor', 'shell', 'local');
      return this.decision({
        mode: 'solo',
        primary,
        candidates: [primary],
        reviewers: [],
        reason: 'deterministic verification belongs to shell/local execution',
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['executor']),
      });
    }

    if (isCheapLocalIntent(item.intent) && item.risk === 'read_only') {
      const primary = this.pickByRole(item, 'primary', 'local', 'claude');
      return this.decision({
        mode: 'solo',
        primary,
        candidates: [primary],
        reviewers: [],
        reason: `${item.intent} is cheap and read-only`,
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['primary']),
      });
    }

    if (texture.peerCritiqueRequired) {
      const availablePeerActors = this.filterAvailable(getPeerCritiqueActors());
      const candidates = pickActorsForRole(item, 'advisor', {
        availableActors: availablePeerActors,
        limit: 4,
      });
      return this.decision({
        mode: item.hasProviderConflict ? 'consensus' : 'panel',
        primary: 'kuro',
        candidates,
        reviewers: candidates.filter(a => a !== 'kuro'),
        reason: peerCritiqueReason(item, { forceAkariForP0: this.forceAkariForP0 }),
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['advisor']),
      });
    }

    if (isCodingIntent(item.intent) || item.risk === 'workspace_write') {
      const primary = this.pickByRole(item, 'primary', 'codex', 'claude');
      const reviewer = this.pickReviewer(item, primary);
      return this.decision({
        mode: reviewer ? 'split' : 'solo',
        primary,
        candidates: this.filterAvailable([primary, reviewer].filter(Boolean) as ActorId[]),
        reviewers: reviewer ? [reviewer] : [],
        reason: 'coding or diagnosis work benefits from a dedicated implementation lane and separate review',
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['primary', 'reviewer']),
      });
    }

    if (isReviewIntent(item.intent)) {
      const primary = this.pickByRole(item, 'primary', 'claude', 'codex');
      const reviewer = this.pickReviewer(item, primary);
      return this.decision({
        mode: reviewer ? 'race' : 'solo',
        primary,
        candidates: this.filterAvailable([primary, reviewer].filter(Boolean) as ActorId[]),
        reviewers: reviewer ? [reviewer] : [],
        reason: `${item.intent} benefits from independent second-pass judgment`,
        writeLeaseRequired: texture.writeLeaseRequired,
        kgClaimsRequired: texture.kgClaimsRequired,
        humanApprovalRequired: texture.humanApprovalRequired,
        selectionTrace: this.traceForRoles(item, ['primary', 'reviewer']),
      });
    }

    const primary = this.pickByRole(item, 'primary', 'claude', 'codex');
    return this.decision({
      mode: 'solo',
      primary,
      candidates: [primary],
      reviewers: [],
      reason: 'default semantic work uses the strongest available language lane',
      writeLeaseRequired: texture.writeLeaseRequired,
      kgClaimsRequired: texture.kgClaimsRequired,
      humanApprovalRequired: texture.humanApprovalRequired,
      selectionTrace: this.traceForRoles(item, ['primary']),
    });
  }

  private decision(decision: ArbitrationDecision): ArbitrationDecision {
    const candidates = this.filterAvailable(decision.candidates);
    const reviewers = this.filterAvailable(decision.reviewers);
    const considered = decision.selectionTrace?.considered ?? [];
    return {
      ...decision,
      candidates,
      reviewers,
      selectionTrace: {
        ...decision.selectionTrace,
        selected: decision.selectionTrace?.selected && decision.selectionTrace.selected.length > 0
          ? decision.selectionTrace.selected
          : selectedTrace(decision.primary, candidates, reviewers, considered),
        considered,
      },
    };
  }

  private pick(primary: ActorId, fallback: ActorId): ActorId {
    if (this.actors.has(primary) && isDispatchableActor(primary)) return primary;
    if (this.actors.has(fallback) && isDispatchableActor(fallback)) return fallback;
    return 'kuro';
  }

  private pickOptional(actor: ActorId): ActorId | null {
    return this.actors.has(actor) && isDispatchableActor(actor) ? actor : null;
  }

  private pickByRole(
    item: WorkItem,
    role: 'primary' | 'reviewer' | 'advisor' | 'executor',
    fallbackPrimary: ActorId,
    fallbackSecondary: ActorId,
  ): ActorId {
    return pickActorForRole(item, role, { availableActors: [...this.actors] })
      ?? this.pick(fallbackPrimary, fallbackSecondary);
  }

  private pickReviewer(item: WorkItem, primary: ActorId): ActorId | null {
    return pickActorsForRole(item, 'reviewer', {
      availableActors: [...this.actors],
      exclude: [primary],
      limit: 1,
    })[0] ?? null;
  }

  private traceForRoles(item: WorkItem, roles: SelectionRole[]): ActorSelectionTrace {
    return {
      selected: [],
      considered: roles.flatMap(role =>
        rankActorsForRole(item, role, { availableActors: [...this.actors] })
          .slice(0, 4)
          .map(score => ({
            actor: score.actor,
            role: score.role,
            score: score.score,
            reasons: score.reasons.slice(0, 4),
          })),
      ),
    };
  }

  private filterAvailable(actors: ActorId[]): ActorId[] {
    return actors.filter(a => (a === 'human' || a === 'kuro' || this.actors.has(a)) && isDispatchableActor(a));
  }
}

function selectedTrace(
  primary: ActorId,
  candidates: ActorId[],
  reviewers: ActorId[],
  considered: ActorSelectionTrace['considered'],
): ActorSelectionTrace['selected'] {
  const seen = new Set<string>();
  const selected: ActorSelectionTrace['selected'] = [];
  selected.push(enrichSelected(primary, 'primary', considered, ['selected by arbitration mode and scoring policy']));
  seen.add(`primary:${primary}`);
  for (const actor of candidates) {
    const role = actor === primary ? 'primary' : reviewers.includes(actor) ? 'reviewer' : 'candidate';
    const key = `${role}:${actor}`;
    if (seen.has(key)) continue;
    selected.push(enrichSelected(actor, role, considered, ['included in arbitration execution set']));
    seen.add(key);
  }
  for (const actor of reviewers) {
    const key = `reviewer:${actor}`;
    if (seen.has(key)) continue;
    selected.push(enrichSelected(actor, 'reviewer', considered, ['selected as arbitration reviewer']));
    seen.add(key);
  }
  return selected;
}

function enrichSelected(
  actor: ActorId,
  role: ActorSelectionTrace['selected'][number]['role'],
  considered: ActorSelectionTrace['considered'],
  fallbackReasons: string[],
): ActorSelectionTrace['selected'][number] {
  const match = considered.find(item => item.actor === actor && (item.role === role || role === 'candidate'))
    ?? considered.find(item => item.actor === actor);
  return {
    actor,
    role,
    ...(match?.score !== undefined ? { score: match.score } : {}),
    reasons: match?.reasons.length ? match.reasons : fallbackReasons,
  };
}

export function decideArbitration(item: WorkItem, opts?: ArbiterOptions): ArbitrationDecision {
  return new BrainArbiter(opts).decide(item);
}
