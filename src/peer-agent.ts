/**
 * Peer Agent seam.
 *
 * Akari/Tanren are peers with their own identity and memory, not provider
 * fallbacks. This interface keeps peer consultation separate from LLM provider
 * execution.
 */

import type { PeerAgentId, ProviderHealth, WorkItem } from './brain-types.js';

export interface PeerConsultRequest {
  task: WorkItem;
  brief: string;
  requestedRole: 'critic' | 'designer' | 'reviewer' | 'arbiter';
  contextPacket?: string;
}

export interface PeerConsultResult {
  peer: PeerAgentId;
  response: string;
  critiques: string[];
  recommendations: string[];
  claims: Array<{
    subject: string;
    predicate: string;
    object: string;
    evidence: string[];
    confidence?: number;
  }>;
}

export interface PeerAgent {
  id: PeerAgentId;
  consult(req: PeerConsultRequest): Promise<PeerConsultResult>;
  health(): Promise<ProviderHealth>;
}

export function emptyPeerResult(peer: PeerAgentId, response: string): PeerConsultResult {
  return {
    peer,
    response,
    critiques: [],
    recommendations: [],
    claims: [],
  };
}
