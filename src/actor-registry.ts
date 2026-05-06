/**
 * Actor/Organ Registry.
 *
 * Not every system participant is a brain. Some are executors, sensors,
 * memory organs, or frameworks that shape agents but should not receive work
 * directly. The arbiter uses this registry as the stable source of capability
 * and dispatchability metadata.
 */

import type { ActorId, WorkIntent, WorkRisk } from './brain-types.js';

export type ActorKind =
  | 'host-agent'
  | 'brain'
  | 'peer-agent'
  | 'executor'
  | 'sensor'
  | 'memory'
  | 'framework'
  | 'human';

export type CognitionLevel = 'none' | 'reactive' | 'reasoning' | 'agentic';

export type ActorRoleTendency =
  | 'primary'
  | 'reviewer'
  | 'advisor'
  | 'critic'
  | 'executor'
  | 'sensor'
  | 'memory'
  | 'arbiter';

export interface ActorProfile {
  id: ActorId | string;
  kind: ActorKind;
  cognition: CognitionLevel;
  dispatchable: boolean;
  capabilities: string[];
  bestFor?: WorkIntent[];
  risk?: WorkRisk[];
  roleTendency: ActorRoleTendency[];
  framework?: string;
  autonomy?: 'none' | 'tool' | 'independent' | 'host';
  finalAuthority?: string[];
  cost?: 'low' | 'medium' | 'high';
  notes?: string;
}

export const ACTOR_REGISTRY: Record<string, ActorProfile> = {
  kuro: {
    id: 'kuro',
    kind: 'host-agent',
    cognition: 'agentic',
    dispatchable: false,
    capabilities: ['orchestrate', 'synthesize', 'memory-owner', 'persona-owner', 'taste-owner', 'final-arbitration'],
    roleTendency: ['arbiter'],
    autonomy: 'host',
    finalAuthority: ['persona', 'taste', 'preference', 'memory', 'user-relationship'],
    cost: 'medium',
    notes: 'Host identity and coordinator authority. Runtime may synthesize as Kuro, but Kuro is not a worker/provider competing for delegated tasks.',
  },
  claude: {
    id: 'claude',
    kind: 'brain',
    cognition: 'reasoning',
    dispatchable: true,
    capabilities: ['long-context', 'reasoning', 'architecture', 'review', 'writing', 'product-judgment'],
    bestFor: ['plan', 'review', 'architecture', 'research', 'summarize', 'policy'],
    risk: ['read_only', 'workspace_write'],
    roleTendency: ['primary', 'reviewer'],
    autonomy: 'tool',
    cost: 'high',
  },
  codex: {
    id: 'codex',
    kind: 'brain',
    cognition: 'reasoning',
    dispatchable: true,
    capabilities: ['code', 'repo-edit', 'tests', 'debug', 'shell-guided-verification', 'commit-ready-implementation'],
    bestFor: ['code', 'diagnose', 'verify', 'review'],
    risk: ['read_only', 'workspace_write'],
    roleTendency: ['primary', 'reviewer'],
    autonomy: 'tool',
    cost: 'high',
  },
  local: {
    id: 'local',
    kind: 'brain',
    cognition: 'reasoning',
    dispatchable: true,
    capabilities: ['cheap-summary', 'classification', 'local-draft', 'low-cost-reasoning'],
    bestFor: ['chat', 'summarize', 'json', 'memory'],
    risk: ['read_only'],
    roleTendency: ['primary'],
    autonomy: 'tool',
    cost: 'low',
  },
  shell: {
    id: 'shell',
    kind: 'executor',
    cognition: 'none',
    dispatchable: true,
    capabilities: ['run-command', 'inspect-files', 'health-check', 'smoke-test', 'deterministic-verification'],
    bestFor: ['verify'],
    risk: ['read_only', 'workspace_write'],
    roleTendency: ['executor', 'primary'],
    autonomy: 'tool',
    cost: 'low',
  },
  akari: {
    id: 'akari',
    kind: 'peer-agent',
    cognition: 'agentic',
    dispatchable: true,
    framework: 'tanren',
    capabilities: ['strategy', 'critique', 'reflection', 'companion-perspective', 'independent-agent-perspective'],
    bestFor: ['architecture', 'policy', 'plan', 'review'],
    risk: ['read_only'],
    roleTendency: ['advisor', 'critic', 'reviewer'],
    autonomy: 'independent',
    cost: 'medium',
    notes: 'Independent Tanren-based AI agent; invited as peer/advisor, not owned by Kuro.',
  },
  tanren: {
    id: 'tanren',
    kind: 'framework',
    cognition: 'none',
    dispatchable: false,
    capabilities: ['discipline-loop', 'reflection-protocol', 'training-patterns', 'agent-construction-framework'],
    roleTendency: [],
    autonomy: 'none',
    cost: 'low',
    notes: 'Framework beneath Akari; not a directly dispatched peer brain.',
  },
  human: {
    id: 'human',
    kind: 'human',
    cognition: 'agentic',
    dispatchable: true,
    capabilities: ['approval', 'external-write-consent', 'preference-source', 'goal-authority'],
    roleTendency: ['primary'],
    autonomy: 'independent',
    finalAuthority: ['external-write', 'deploy', 'irreversible-action'],
    cost: 'high',
  },
  'knowledge-graph': {
    id: 'knowledge-graph',
    kind: 'memory',
    cognition: 'none',
    dispatchable: false,
    capabilities: ['retrieve', 'link', 'detect-conflict', 'shared-context'],
    roleTendency: ['memory'],
    cost: 'low',
  },
  myelin: {
    id: 'myelin',
    kind: 'memory',
    cognition: 'none',
    dispatchable: false,
    capabilities: ['decision-patterns', 'habit-crystallization', 'soft-guidance'],
    roleTendency: ['memory'],
    cost: 'low',
  },
  perception: {
    id: 'perception',
    kind: 'sensor',
    cognition: 'reactive',
    dispatchable: false,
    capabilities: ['observe-environment', 'plugins', 'inbox', 'status-streams'],
    roleTendency: ['sensor'],
    cost: 'low',
  },
};

export function getActorProfile(id: string): ActorProfile | null {
  return ACTOR_REGISTRY[id] ?? null;
}

export function isDispatchableActor(id: string): id is ActorId {
  const profile = getActorProfile(id);
  return Boolean(profile?.dispatchable);
}

export function getDefaultDispatchableActors(): ActorId[] {
  return Object.values(ACTOR_REGISTRY)
    .filter((profile): profile is ActorProfile & { id: ActorId } => profile.dispatchable && isRuntimeActor(profile.id))
    .map(profile => profile.id);
}

export function getPeerCritiqueActors(): ActorId[] {
  return getDefaultDispatchableActors().filter(actor => {
    const profile = getActorProfile(actor);
    return Boolean(profile && ['brain', 'peer-agent'].includes(profile.kind) && actor !== 'local');
  });
}

function isRuntimeActor(id: string): id is ActorId {
  return ['claude', 'codex', 'local', 'shell', 'akari', 'tanren', 'kuro', 'human'].includes(id);
}
