/**
 * Brain orchestration shared types.
 *
 * These types describe who should think, who may write, and which outputs
 * must be recorded as verifiable claims. Runtime execution stays behind
 * provider and peer-agent adapters.
 */

export type ProviderId = 'claude' | 'codex' | 'local' | 'shell';
export type PeerAgentId = 'akari' | 'tanren';
export type ActorId = ProviderId | PeerAgentId | 'kuro' | 'human';

export type WorkIntent =
  | 'chat'
  | 'plan'
  | 'code'
  | 'research'
  | 'summarize'
  | 'json'
  | 'diagnose'
  | 'review'
  | 'verify'
  | 'architecture'
  | 'memory'
  | 'policy';

export type WorkRisk = 'read_only' | 'workspace_write' | 'external_write' | 'deploy';
export type WorkPriority = 'P0' | 'P1' | 'P2';
export type DecisionCost = 'low' | 'medium' | 'high';
export type DecisionStopCondition =
  | 'verified'
  | 'primary_confident'
  | 'no_dissent'
  | 'human_approved';

export interface DecisionBudget {
  maxActors: 1 | 2 | 4;
  requireReviewer: boolean;
  allowPanel: boolean;
  maxCost: DecisionCost;
  stopWhen: DecisionStopCondition;
  reason: string;
}

export interface WorkItem {
  id: string;
  title: string;
  intent: WorkIntent;
  priority: WorkPriority;
  risk: WorkRisk;
  prompt?: string;
  writeScope?: string[];
  tags?: string[];
  hasProviderConflict?: boolean;
}

export type ArbitrationMode = 'solo' | 'race' | 'panel' | 'split' | 'consensus' | 'human';

export interface ArbitrationDecision {
  mode: ArbitrationMode;
  primary: ActorId;
  candidates: ActorId[];
  reviewers: ActorId[];
  reason: string;
  decisionBudget?: DecisionBudget;
  writeLeaseRequired: boolean;
  kgClaimsRequired: boolean;
  humanApprovalRequired: boolean;
  selectionTrace?: ActorSelectionTrace;
}

export interface ActorSelectionTrace {
  selected: Array<{
    actor: ActorId;
    role: 'primary' | 'reviewer' | 'advisor' | 'executor' | 'candidate';
    score?: number;
    reasons: string[];
  }>;
  considered: Array<{
    actor: ActorId;
    role: 'primary' | 'reviewer' | 'advisor' | 'executor';
    score: number;
    reasons: string[];
  }>;
}

export interface ProviderCapabilities {
  canWrite: boolean;
  canUseShell: boolean;
  canUseMcp: boolean;
  bestFor: WorkIntent[];
}

export interface ProviderHealth {
  available: boolean;
  detail?: string;
}

export interface BrainRequest {
  taskId: string;
  source: 'loop' | 'foreground' | 'ask' | 'background';
  intent: WorkIntent;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  timeoutMs: number;
  maxTurns?: number;
  schema?: unknown;
  tools?: Array<'read' | 'write' | 'shell' | 'web' | 'mcp'>;
  risk: WorkRisk;
}

export interface BrainResult {
  provider: ProviderId;
  text: string;
  structured?: unknown;
  toolCalls: Array<Record<string, unknown>>;
  usage?: unknown;
  durationMs: number;
  finishReason: 'success' | 'timeout' | 'rate_limit' | 'error' | 'cancelled';
}

export interface BrainProvider {
  id: ProviderId;
  capabilities: ProviderCapabilities;
  run(req: BrainRequest): Promise<BrainResult>;
  abort(taskId: string, reason: string): Promise<void>;
  health(): Promise<ProviderHealth>;
}
