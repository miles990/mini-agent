/**
 * Constraint Texture — explicit execution constraints for brain orchestration.
 *
 * Scheduler chooses which DAG receives attention. DAG planner decomposes work.
 * Arbiter chooses actors per node. Runtime executes. This module keeps the
 * hard constraints shared across those layers instead of burying them in
 * arbiter branch logic.
 */

import type { WorkIntent, WorkItem, WorkRisk } from './brain-types.js';

const CHEAP_LOCAL_INTENTS = new Set<WorkIntent>(['json', 'summarize']);
const CODING_INTENTS = new Set<WorkIntent>(['code', 'diagnose']);
const PEER_REVIEW_INTENTS = new Set<WorkIntent>(['architecture', 'memory', 'policy']);
const REVIEW_INTENTS = new Set<WorkIntent>(['review', 'plan', 'research']);

export type ConstraintKind =
  | 'deterministic_execution'
  | 'human_gate'
  | 'provider_claims'
  | 'peer_critique'
  | 'write_lease';

export interface WorkConstraint {
  kind: ConstraintKind;
  required: boolean;
  reason: string;
}

export interface ConstraintTexture {
  taskId: string;
  intent: WorkIntent;
  risk: WorkRisk;
  humanApprovalRequired: boolean;
  writeLeaseRequired: boolean;
  kgClaimsRequired: boolean;
  peerCritiqueRequired: boolean;
  deterministicExecution: boolean;
  constraints: WorkConstraint[];
}

export interface ConstraintTextureOptions {
  forceAkariForP0?: boolean;
}

export function deriveConstraintTexture(
  item: WorkItem,
  opts: ConstraintTextureOptions = {},
): ConstraintTexture {
  const deterministicExecution = item.intent === 'verify';
  const humanApprovalRequired = item.risk === 'deploy' || item.risk === 'external_write';
  const peerCritiqueRequired = needsPeerCritic(item, opts);
  const writeLeaseRequired = humanApprovalRequired
    ? Boolean(item.writeScope?.length)
    : item.risk === 'workspace_write' || Boolean(item.writeScope?.length);
  const kgClaimsRequired = requiresProviderClaims(item, {
    deterministicExecution,
    humanApprovalRequired,
    peerCritiqueRequired,
  });

  return {
    taskId: item.id,
    intent: item.intent,
    risk: item.risk,
    humanApprovalRequired,
    writeLeaseRequired,
    kgClaimsRequired,
    peerCritiqueRequired,
    deterministicExecution,
    constraints: [
      {
        kind: 'human_gate',
        required: humanApprovalRequired,
        reason: humanApprovalRequired
          ? `${item.risk} requires human approval before execution`
          : 'local execution is allowed without human gate',
      },
      {
        kind: 'write_lease',
        required: writeLeaseRequired,
        reason: writeLeaseRequired
          ? 'workspace-affecting work needs an exclusive write lease'
          : 'read-only or deterministic work does not need a write lease',
      },
      {
        kind: 'provider_claims',
        required: kgClaimsRequired,
        reason: kgClaimsRequired
          ? 'provider output must remain traceable until verified'
          : 'deterministic local verification does not create semantic claims',
      },
      {
        kind: 'peer_critique',
        required: peerCritiqueRequired,
        reason: peerCritiqueReason(item, opts),
      },
      {
        kind: 'deterministic_execution',
        required: deterministicExecution,
        reason: deterministicExecution
          ? 'verification should run through shell/local execution'
          : 'semantic work may use provider judgment',
      },
    ],
  };
}

export function isCheapLocalIntent(intent: WorkIntent): boolean {
  return CHEAP_LOCAL_INTENTS.has(intent);
}

export function isCodingIntent(intent: WorkIntent): boolean {
  return CODING_INTENTS.has(intent);
}

export function isReviewIntent(intent: WorkIntent): boolean {
  return REVIEW_INTENTS.has(intent);
}

export function peerCritiqueReason(item: WorkItem, opts: ConstraintTextureOptions = {}): string {
  if (item.hasProviderConflict) return 'provider conflict needs peer critique before convergence';
  if (PEER_REVIEW_INTENTS.has(item.intent)) return `${item.intent} work has high long-term coupling and needs peer critique`;
  if (opts.forceAkariForP0 && item.priority === 'P0') return 'P0 work is configured to request peer critique';
  if (item.tags?.some(t => ['architecture', 'soul', 'memory', 'policy', 'kg'].includes(t.toLowerCase())) === true) {
    return 'task tags indicate peer critique is worth the added cost';
  }
  return 'peer critique is optional for this task';
}

function needsPeerCritic(item: WorkItem, opts: ConstraintTextureOptions): boolean {
  return item.hasProviderConflict === true
    || PEER_REVIEW_INTENTS.has(item.intent)
    || (opts.forceAkariForP0 === true && item.priority === 'P0')
    || item.tags?.some(t => ['architecture', 'soul', 'memory', 'policy', 'kg'].includes(t.toLowerCase())) === true;
}

function requiresProviderClaims(
  item: WorkItem,
  state: {
    deterministicExecution: boolean;
    humanApprovalRequired: boolean;
    peerCritiqueRequired: boolean;
  },
): boolean {
  if (state.humanApprovalRequired) return true;
  if (state.deterministicExecution) return false;
  if (state.peerCritiqueRequired) return true;
  if (isCodingIntent(item.intent) || item.risk === 'workspace_write') return true;
  if (isReviewIntent(item.intent)) return true;
  if (isCheapLocalIntent(item.intent) && item.risk === 'read_only') return item.priority === 'P0';
  return item.priority === 'P0';
}
