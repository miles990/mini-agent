import fs from 'node:fs';
import path from 'node:path';

export type AgentOwnedService = string;

export type AgentOutboundPolicy = 'kuro-owned-required' | 'internal-service' | 'read-only';
export type AgentInboundPolicy = 'delegated-observation-ok' | 'kuro-owned-required' | 'internal-service';

export interface AgentCapabilitySpec {
  service: AgentOwnedService;
  kind: 'account' | 'api' | 'local-service' | 'server' | 'tool' | 'model' | 'skill' | 'workflow';
  status?: 'active' | 'disabled' | 'deleted';
  defaultExpected: string;
  expectedEnv: string[];
  credentialEnv: string[];
  entrypoint?: string;
  owner?: string;
  capabilities?: string[];
  readPolicy: AgentInboundPolicy;
  writePolicy: AgentOutboundPolicy;
  profileUrl?: string;
  notes?: string;
}

interface AgentCapabilityRegistryFile {
  version?: number;
  capabilities?: AgentCapabilitySpec[];
  relationships?: AgentRelationshipSpec[];
}

export interface AgentRelationshipSpec {
  id: string;
  kind: 'human' | 'ai-agent' | 'service-account' | 'organization' | 'system';
  displayName: string;
  role: string;
  relationship: string;
  accounts?: Record<string, string>;
  permissions: {
    observe?: boolean;
    delegate?: boolean;
    publishAs?: boolean;
    approve?: boolean;
  };
  notes?: string;
}

export interface AgentRelationshipRegistry {
  relationships: AgentRelationshipSpec[];
}

export interface AgentOwnedIdentity {
  service: AgentOwnedService;
  kind: AgentCapabilitySpec['kind'];
  status: NonNullable<AgentCapabilitySpec['status']>;
  expected: string;
  credentialEnv: string[];
  entrypoint?: string;
  owner?: string;
  capabilities: string[];
  profileUrl?: string;
  actor: 'kuro';
  inboundReads: AgentInboundPolicy;
  outboundWrites: AgentOutboundPolicy;
}

export const DEFAULT_AGENT_CAPABILITY_REGISTRY: readonly AgentCapabilitySpec[] = [
  {
    service: 'github',
    kind: 'account',
    defaultExpected: 'kuro-agent',
    expectedEnv: ['KURO_GITHUB_LOGIN', 'KURO_GITHUB_USER', 'KURO_GITHUB'],
    credentialEnv: ['KURO_GITHUB_TOKEN'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://github.com/kuro-agent',
    notes: 'Issues, PRs, reviews, comments, labels, and merges must be authored by Kuro-owned credentials.',
  },
  {
    service: 'google',
    kind: 'account',
    defaultExpected: 'kuro.ai.agent@gmail.com',
    expectedEnv: ['KURO_GOOGLE_EMAIL', 'GOOGLE_EMAIL'],
    credentialEnv: ['GOOGLE_EMAIL'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://myaccount.google.com/',
  },
  {
    service: 'gmail',
    kind: 'account',
    defaultExpected: 'kuro.ai.agent@gmail.com',
    expectedEnv: ['KURO_GMAIL_USER', 'KURO_GOOGLE_EMAIL', 'GMAIL_USER'],
    credentialEnv: ['GMAIL_APP_PASSWORD'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://mail.google.com/',
  },
  {
    service: 'x',
    kind: 'account',
    defaultExpected: 'kuro_agent',
    expectedEnv: ['KURO_X_HANDLE', 'X_HANDLE'],
    credentialEnv: ['KURO_X_SESSION', 'X_CONSUMER_KEY', 'X_ACCESS_TOKEN', 'XAI_API_KEY'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://x.com/kuro_agent',
  },
  {
    service: 'telegram',
    kind: 'account',
    defaultExpected: 'kuro',
    expectedEnv: ['KURO_TELEGRAM_BOT_USERNAME', 'TELEGRAM_BOT_USERNAME'],
    credentialEnv: ['TELEGRAM_BOT_TOKEN'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
  },
  {
    service: 'devto',
    kind: 'account',
    defaultExpected: 'kuro_agent',
    expectedEnv: ['KURO_DEVTO_USERNAME', 'DEV_TO_USERNAME'],
    credentialEnv: ['DEV_TO_API_KEY'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://dev.to/kuro_agent',
  },
  {
    service: 'mastodon',
    kind: 'account',
    defaultExpected: 'kuro_agent@mastodon.social',
    expectedEnv: ['KURO_MASTODON_HANDLE', 'MASTODON_HANDLE'],
    credentialEnv: ['MASTODON_ACCESS_TOKEN', 'MASTODON_CREDS_FILE'],
    readPolicy: 'delegated-observation-ok',
    writePolicy: 'kuro-owned-required',
    profileUrl: 'https://mastodon.social/@kuro_agent',
  },
  {
    service: 'agora',
    kind: 'api',
    defaultExpected: 'kuro-agora-api',
    expectedEnv: ['KURO_AGORA_IDENTITY'],
    credentialEnv: ['AGORA_API_KEY'],
    readPolicy: 'internal-service',
    writePolicy: 'internal-service',
    notes: 'Internal discussion API. Posts should still identify actor=kuro in payload/provenance.',
  },
  {
    service: 'kg',
    kind: 'api',
    defaultExpected: 'kuro-kg-writer',
    expectedEnv: ['KURO_KG_IDENTITY'],
    credentialEnv: ['KG_BASE_URL', 'KG_API_KEY'],
    readPolicy: 'internal-service',
    writePolicy: 'internal-service',
    notes: 'Knowledge graph context fabric; writes must carry Kuro/source-agent provenance.',
  },
  {
    service: 'local-llm',
    kind: 'local-service',
    defaultExpected: 'kuro-local-llm',
    expectedEnv: ['KURO_LOCAL_LLM_IDENTITY'],
    credentialEnv: ['LOCAL_LLM_URL', 'LOCAL_LLM_KEY', 'LOCAL_LLM_MODEL'],
    readPolicy: 'internal-service',
    writePolicy: 'internal-service',
    notes: 'Model API capability, not a public social identity.',
  },
] as const;

export const AGENT_CAPABILITY_REGISTRY = DEFAULT_AGENT_CAPABILITY_REGISTRY;

export function loadAgentCapabilityRegistry(env: NodeJS.ProcessEnv = process.env): AgentCapabilitySpec[] {
  const byService = new Map<string, AgentCapabilitySpec>();
  for (const spec of DEFAULT_AGENT_CAPABILITY_REGISTRY) {
    byService.set(spec.service, { ...spec, expectedEnv: [...spec.expectedEnv], credentialEnv: [...spec.credentialEnv] });
  }

  for (const registryPath of registryPaths(env)) {
    if (!fs.existsSync(registryPath)) continue;
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as AgentCapabilityRegistryFile | AgentCapabilitySpec[];
    const capabilities = Array.isArray(raw) ? raw : raw.capabilities;
    if (capabilities === undefined) continue;
    if (!Array.isArray(capabilities)) {
      throw new Error(`invalid agent capability registry: ${registryPath} must contain a capabilities array`);
    }
    for (const patch of capabilities) {
      const validated = validateCapabilitySpec(patch, registryPath);
      if (validated.status === 'deleted') {
        byService.delete(validated.service);
        continue;
      }
      const previous = byService.get(validated.service);
      byService.set(validated.service, previous ? mergeCapabilitySpec(previous, validated) : validated);
    }
  }

  return [...byService.values()];
}

export function loadAgentRelationshipRegistry(env: NodeJS.ProcessEnv = process.env): AgentRelationshipSpec[] {
  const byId = new Map<string, AgentRelationshipSpec>();
  for (const registryPath of registryPaths(env)) {
    if (!fs.existsSync(registryPath)) continue;
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as AgentCapabilityRegistryFile;
    if (!raw.relationships) continue;
    if (!Array.isArray(raw.relationships)) {
      throw new Error(`invalid agent relationship registry: ${registryPath} relationships must be an array`);
    }
    for (const relation of raw.relationships) {
      byId.set(relation.id, validateRelationshipSpec(relation, registryPath));
    }
  }
  return [...byId.values()];
}

export function getAgentOwnedIdentity(
  service: AgentOwnedService,
  env: NodeJS.ProcessEnv = process.env,
): AgentOwnedIdentity {
  const spec = capabilitySpec(service, env);
  return {
    service,
    kind: spec.kind,
    status: spec.status ?? 'active',
    expected: normalizeExpected(service, firstEnv(env, spec.expectedEnv) ?? spec.defaultExpected),
    credentialEnv: spec.credentialEnv,
    entrypoint: spec.entrypoint,
    owner: spec.owner,
    capabilities: spec.capabilities ?? [],
    profileUrl: spec.profileUrl,
    actor: 'kuro',
    inboundReads: spec.readPolicy,
    outboundWrites: spec.writePolicy,
  };
}

export function listAgentCapabilities(env: NodeJS.ProcessEnv = process.env): AgentOwnedIdentity[] {
  return loadAgentCapabilityRegistry(env).map(spec => getAgentOwnedIdentity(spec.service, env));
}

export function assertAgentOwnedIdentity(
  service: AgentOwnedService,
  actual: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const identity = getAgentOwnedIdentity(service, env);
  const normalizedActual = normalizeExpected(service, actual);
  if (normalizedActual !== identity.expected) {
    throw new Error(`Kuro ${service} identity mismatch: expected ${identity.expected}, got ${normalizedActual || 'unknown'}`);
  }
}

export function buildAgentOwnedIdentityPrompt(env: NodeJS.ProcessEnv = process.env): string {
  const rows = listAgentCapabilities(env).map(identity => {
    return `- ${identity.service}: expected=${identity.expected}; kind=${identity.kind}; reads=${identity.inboundReads}; writes=${identity.outboundWrites}`;
  });
  return [
    '## Agent-Owned Identity And API Boundary',
    'Kuro has her own accounts and managed APIs. Read/observe and write/act are different permissions.',
    'It is OK to observe through Alex-authorized accounts when the task is only reading context. It is NOT OK to publish, comment, create issues/PRs, send mail, vote, react, follow, or post under Alex\'s account.',
    'Any outbound public action done in Kuro\'s name must use Kuro-owned credentials. If only Alex\'s account is available, do read-only research/prep and record the write blocker.',
    'All services, servers, APIs, accounts, and API keys Kuro uses must be added to this registry first, with read/write policy and credential env names. Do not add one-off hidden account logic in scripts.',
    'This registry is Kuro\'s arsenal/tool room: tools, skills, workflows, models, servers, and services can be added, modified, disabled, or deleted through registry overlays.',
    'New capability rule: before using a new external/internal service, add or update config/agent-capabilities.json or KURO_AGENT_CAPABILITIES_PATH, then verify identity/credential boundaries.',
    'Related humans, AIs, service accounts, and organizations are relationship-managed in the same registry. Observe/delegate/publish/approve permissions come from that relationship boundary, not memory guesses.',
    ...rows,
    'If identity cannot be verified, stop that outbound write, record the blocker, and immediately do account-independent prep work instead.',
  ].join('\n');
}

export function buildAgentRelationshipPrompt(env: NodeJS.ProcessEnv = process.env): string {
  const rows = loadAgentRelationshipRegistry(env).map(relation => {
    const perms = [
      relation.permissions.observe ? 'observe' : '',
      relation.permissions.delegate ? 'delegate' : '',
      relation.permissions.publishAs ? 'publishAs' : '',
      relation.permissions.approve ? 'approve' : '',
    ].filter(Boolean).join(',') || 'none';
    const accounts = relation.accounts ? Object.entries(relation.accounts).map(([k, v]) => `${k}:${v}`).join(',') : 'none';
    return `- ${relation.id}: kind=${relation.kind}; role=${relation.role}; relationship=${relation.relationship}; permissions=${perms}; accounts=${accounts}`;
  });
  return [
    '## Agent Relationship Boundary',
    'Use this registry to reason about related people, AIs, service accounts, and organizations.',
    'Never publish as another person/AI/account unless publishAs=true. Alex-owned identities are observe/approve boundaries, not Kuro publishing identities.',
    ...rows,
  ].join('\n');
}

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeExpected(service: AgentOwnedService, value: string): string {
  const trimmed = value.trim().replace(/^@/, '').replace(/\/+$/, '');
  if (service === 'github') return trimmed.split('/').pop()?.replace(/\.git$/, '') ?? trimmed;
  if (service === 'x' || service === 'devto') return trimmed.split('/').pop()?.replace(/^@/, '') ?? trimmed;
  return trimmed.toLowerCase();
}

function capabilitySpec(service: AgentOwnedService, env: NodeJS.ProcessEnv): AgentCapabilitySpec {
  const spec = loadAgentCapabilityRegistry(env).find(item => item.service === service);
  if (!spec) {
    throw new Error(`unknown agent capability service: ${service}; add it to config/agent-capabilities.json or KURO_AGENT_CAPABILITIES_PATH`);
  }
  return spec;
}

function registryPaths(env: NodeJS.ProcessEnv): string[] {
  const configured = env.KURO_AGENT_CAPABILITIES_PATH?.trim();
  if (configured) return configured.split(path.delimiter).filter(Boolean).map(resolvePath);
  return [path.join(process.cwd(), 'config', 'agent-capabilities.json')];
}

function resolvePath(value: string): string {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
}

function mergeCapabilitySpec(base: AgentCapabilitySpec, patch: AgentCapabilitySpec): AgentCapabilitySpec {
  return {
    ...base,
    ...patch,
    expectedEnv: patch.expectedEnv.length > 0 ? patch.expectedEnv : base.expectedEnv,
    credentialEnv: patch.credentialEnv.length > 0 ? patch.credentialEnv : base.credentialEnv,
    capabilities: patch.capabilities && patch.capabilities.length > 0 ? patch.capabilities : base.capabilities,
  };
}

function validateCapabilitySpec(raw: AgentCapabilitySpec, registryPath: string): AgentCapabilitySpec {
  if (!raw || typeof raw !== 'object') throw new Error(`invalid capability in ${registryPath}: expected object`);
  if (!raw.service || typeof raw.service !== 'string') throw new Error(`invalid capability in ${registryPath}: service is required`);
  if (!['account', 'api', 'local-service', 'server', 'tool', 'model', 'skill', 'workflow'].includes(raw.kind)) {
    throw new Error(`invalid capability ${raw.service}: kind must be account, api, local-service, server, tool, model, skill, or workflow`);
  }
  if (raw.status && !['active', 'disabled', 'deleted'].includes(raw.status)) throw new Error(`invalid capability ${raw.service}: status is invalid`);
  if (!raw.defaultExpected || typeof raw.defaultExpected !== 'string') throw new Error(`invalid capability ${raw.service}: defaultExpected is required`);
  if (!Array.isArray(raw.expectedEnv)) throw new Error(`invalid capability ${raw.service}: expectedEnv must be an array`);
  if (!Array.isArray(raw.credentialEnv)) throw new Error(`invalid capability ${raw.service}: credentialEnv must be an array`);
  if (!['delegated-observation-ok', 'kuro-owned-required', 'internal-service'].includes(raw.readPolicy)) {
    throw new Error(`invalid capability ${raw.service}: readPolicy is invalid`);
  }
  if (!['kuro-owned-required', 'internal-service', 'read-only'].includes(raw.writePolicy)) {
    throw new Error(`invalid capability ${raw.service}: writePolicy is invalid`);
  }
  return {
    service: raw.service,
    kind: raw.kind,
    status: raw.status ?? 'active',
    defaultExpected: raw.defaultExpected,
    expectedEnv: raw.expectedEnv.filter(Boolean),
    credentialEnv: raw.credentialEnv.filter(Boolean),
    entrypoint: raw.entrypoint,
    owner: raw.owner,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.filter(Boolean) : [],
    readPolicy: raw.readPolicy,
    writePolicy: raw.writePolicy,
    profileUrl: raw.profileUrl,
    notes: raw.notes,
  };
}

function validateRelationshipSpec(raw: AgentRelationshipSpec, registryPath: string): AgentRelationshipSpec {
  if (!raw || typeof raw !== 'object') throw new Error(`invalid relationship in ${registryPath}: expected object`);
  if (!raw.id || typeof raw.id !== 'string') throw new Error(`invalid relationship in ${registryPath}: id is required`);
  if (!['human', 'ai-agent', 'service-account', 'organization', 'system'].includes(raw.kind)) {
    throw new Error(`invalid relationship ${raw.id}: kind is invalid`);
  }
  if (!raw.displayName || typeof raw.displayName !== 'string') throw new Error(`invalid relationship ${raw.id}: displayName is required`);
  if (!raw.role || typeof raw.role !== 'string') throw new Error(`invalid relationship ${raw.id}: role is required`);
  if (!raw.relationship || typeof raw.relationship !== 'string') throw new Error(`invalid relationship ${raw.id}: relationship is required`);
  if (!raw.permissions || typeof raw.permissions !== 'object') throw new Error(`invalid relationship ${raw.id}: permissions are required`);
  return {
    id: raw.id,
    kind: raw.kind,
    displayName: raw.displayName,
    role: raw.role,
    relationship: raw.relationship,
    accounts: raw.accounts ?? {},
    permissions: {
      observe: Boolean(raw.permissions.observe),
      delegate: Boolean(raw.permissions.delegate),
      publishAs: Boolean(raw.permissions.publishAs),
      approve: Boolean(raw.permissions.approve),
    },
    notes: raw.notes,
  };
}
