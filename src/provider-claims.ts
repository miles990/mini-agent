/**
 * Provider Claims — provenance records for KG-backed arbitration.
 *
 * A claim is not memory truth until verification updates its status. This lets
 * Claude, Codex, Akari, Kuro, tests, and humans share information without
 * collapsing hypotheses into accepted facts.
 */

import { randomUUID } from 'node:crypto';
import type { ActorId } from './brain-types.js';

export type ClaimStatus = 'hypothesis' | 'verified' | 'rejected' | 'superseded' | 'disputed';

export interface ProviderClaimInput {
  provider: ActorId;
  taskId: string;
  subject: string;
  predicate: string;
  object: string;
  evidence?: string[];
  confidence?: number;
}

export interface ProviderClaim extends ProviderClaimInput {
  id: string;
  status: ClaimStatus;
  createdAt: string;
  updatedAt: string;
}

const ALLOWED_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  hypothesis: ['verified', 'rejected', 'superseded', 'disputed'],
  disputed: ['verified', 'rejected', 'superseded'],
  verified: ['superseded', 'disputed'],
  rejected: ['superseded', 'disputed'],
  superseded: [],
};

export function createProviderClaim(input: ProviderClaimInput, now = new Date()): ProviderClaim {
  validateClaimInput(input);
  const ts = now.toISOString();
  return {
    ...input,
    id: randomUUID(),
    evidence: input.evidence ?? [],
    status: 'hypothesis',
    createdAt: ts,
    updatedAt: ts,
  };
}

export function transitionClaimStatus(
  claim: ProviderClaim,
  nextStatus: ClaimStatus,
  now = new Date(),
): ProviderClaim {
  const allowed = ALLOWED_TRANSITIONS[claim.status];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`invalid claim transition: ${claim.status} -> ${nextStatus}`);
  }
  return {
    ...claim,
    status: nextStatus,
    updatedAt: now.toISOString(),
  };
}

export function claimToKgRecord(claim: ProviderClaim): Record<string, unknown> {
  return {
    type: 'provider_claim',
    id: claim.id,
    provider: claim.provider,
    task_id: claim.taskId,
    subject: claim.subject,
    predicate: claim.predicate,
    object: claim.object,
    evidence: claim.evidence,
    confidence: claim.confidence,
    status: claim.status,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  };
}

function validateClaimInput(input: ProviderClaimInput): void {
  if (!input.taskId.trim()) throw new Error('claim taskId is required');
  if (!input.subject.trim()) throw new Error('claim subject is required');
  if (!input.predicate.trim()) throw new Error('claim predicate is required');
  if (!input.object.trim()) throw new Error('claim object is required');
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error('claim confidence must be between 0 and 1');
  }
}
