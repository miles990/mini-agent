export type AgentOwnedService = 'github' | 'google' | 'gmail' | 'x' | 'telegram';

export interface AgentOwnedIdentity {
  service: AgentOwnedService;
  expected: string;
  credentialEnv: string[];
  actor: 'kuro';
  inboundReads: 'delegated-observation-ok';
  outboundWrites: 'fail-closed';
}

const DEFAULTS: Record<AgentOwnedService, string> = {
  github: 'kuro-agent',
  google: 'kuro.ai.agent@gmail.com',
  gmail: 'kuro.ai.agent@gmail.com',
  x: 'kuro_agent',
  telegram: 'kuro',
};

const EXPECTED_ENV: Record<AgentOwnedService, string[]> = {
  github: ['KURO_GITHUB_LOGIN', 'KURO_GITHUB_USER', 'KURO_GITHUB'],
  google: ['KURO_GOOGLE_EMAIL', 'GOOGLE_EMAIL'],
  gmail: ['KURO_GMAIL_USER', 'KURO_GOOGLE_EMAIL', 'GMAIL_USER'],
  x: ['KURO_X_HANDLE', 'X_HANDLE'],
  telegram: ['KURO_TELEGRAM_BOT_USERNAME', 'TELEGRAM_BOT_USERNAME'],
};

const CREDENTIAL_ENV: Record<AgentOwnedService, string[]> = {
  github: ['KURO_GITHUB_TOKEN'],
  google: ['GOOGLE_EMAIL'],
  gmail: ['GMAIL_APP_PASSWORD'],
  x: ['KURO_X_SESSION', 'XAI_API_KEY'],
  telegram: ['TELEGRAM_BOT_TOKEN'],
};

export function getAgentOwnedIdentity(
  service: AgentOwnedService,
  env: NodeJS.ProcessEnv = process.env,
): AgentOwnedIdentity {
  return {
    service,
    expected: normalizeExpected(service, firstEnv(env, EXPECTED_ENV[service]) ?? DEFAULTS[service]),
    credentialEnv: CREDENTIAL_ENV[service],
    actor: 'kuro',
    inboundReads: 'delegated-observation-ok',
    outboundWrites: 'fail-closed',
  };
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
  const services: AgentOwnedService[] = ['github', 'google', 'gmail', 'x', 'telegram'];
  const rows = services.map(service => {
    const identity = getAgentOwnedIdentity(service, env);
    return `- ${service}: expected=${identity.expected}; reads=${identity.inboundReads}; outbound writes=${identity.outboundWrites}`;
  });
  return [
    '## Agent-Owned Identity Boundary',
    'Kuro has her own accounts. Read/observe and write/act are different permissions.',
    'It is OK to observe through Alex-authorized accounts when the task is only reading context. It is NOT OK to publish, comment, create issues/PRs, send mail, vote, react, follow, or post under Alex\'s account.',
    'Any outbound action done in Kuro\'s name must use Kuro-owned credentials. If only Alex\'s account is available, do read-only research/prep and record the write blocker.',
    ...rows,
    'If identity cannot be verified, stop that outbound write, record the blocker, and immediately do account-independent prep work instead.',
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
  if (service === 'x') return trimmed.split('/').pop()?.replace(/^@/, '') ?? trimmed;
  return trimmed.toLowerCase();
}
