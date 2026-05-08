import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { getKuroGithubToken } from './github-identity.js';

const execFileAsync = promisify(execFile);

export type AuthorizationDecision = 'allowed' | 'requires_approval' | 'forbidden';
export type AuthorizationStatus = 'ok' | 'needs_authorization' | 'unsafe_scope_granted' | 'unknown';

export interface AuthorizationPolicyRule {
  service: string;
  operation: string;
  decision: AuthorizationDecision;
  reason: string;
}

export interface GithubAuthorizationPolicy {
  service: 'github';
  requiredScopes: string[];
  optionalScopes: string[];
  approvalRequiredScopes: string[];
  forbiddenScopes: string[];
  rules: AuthorizationPolicyRule[];
}

export interface AuthorizationRequest {
  service: string;
  kind: 'oauth-scope' | 'policy-approval';
  scope?: string;
  operation?: string;
  reason: string;
  command?: string;
  fallback: string;
}

export interface GithubAuthorizationEvaluation {
  service: 'github';
  status: AuthorizationStatus;
  actualScopes: string[];
  missingRequiredScopes: string[];
  missingApprovalRequiredScopes: string[];
  missingRepositoryPermissions: string[];
  forbiddenGrantedScopes: string[];
  authorizationRequests: AuthorizationRequest[];
  evidence: string[];
  repository?: GithubRepositoryAuthorizationProbe;
}

export interface GithubRepositoryAuthorizationProbe {
  fullName: string;
  admin: boolean | null;
  push: boolean | null;
  webhookAccess: 'ok' | 'denied' | 'unknown';
  roleName?: string | null;
  error?: string;
}

export const GITHUB_AUTHORIZATION_POLICY: GithubAuthorizationPolicy = {
  service: 'github',
  requiredScopes: [
    'repo',
    'workflow',
    'user',
    'notifications',
    'read:org',
  ],
  optionalScopes: [
    'gist',
    'project',
    'write:discussion',
    'write:packages',
    'codespace',
    'audit_log',
  ],
  approvalRequiredScopes: [
    'admin:repo_hook',
  ],
  forbiddenScopes: [
    'delete_repo',
  ],
  rules: [
    {
      service: 'github',
      operation: 'issue.create|issue.comment|issue.edit|issue.close',
      decision: 'allowed',
      reason: 'Kuro may autonomously manage project issues using Kuro-owned identity.',
    },
    {
      service: 'github',
      operation: 'pr.create|pr.review|pr.comment|pr.merge|pr.edit|pr.update_branch',
      decision: 'allowed',
      reason: 'Kuro may autonomously ship and review repo work using Kuro-owned identity.',
    },
    {
      service: 'github',
      operation: 'workflow.run|workflow.rerun|workflow.read',
      decision: 'allowed',
      reason: 'Kuro may run and inspect CI/deploy workflows for repositories she maintains.',
    },
    {
      service: 'github',
      operation: 'webhook.create|webhook.update|webhook.disable|webhook.test|webhook.rotate_secret',
      decision: 'allowed',
      reason: 'Webhook lifecycle is part of autonomous operations once admin:repo_hook has owner approval.',
    },
    {
      service: 'github',
      operation: 'webhook.delete|webhook.change_target_domain|oauth.grant_new_scope|external_service.add',
      decision: 'requires_approval',
      reason: 'These operations expand or remove integration authority and must leave an owner approval record.',
    },
    {
      service: 'github',
      operation: 'repo.delete|repo.transfer|owner.remove_access',
      decision: 'forbidden',
      reason: 'Repository deletion, transfer, and owner-access removal are outside Kuro autonomous authority.',
    },
  ],
};

export function evaluateGithubAuthorizationScopes(
  actualScopes: string[],
  policy: GithubAuthorizationPolicy = GITHUB_AUTHORIZATION_POLICY,
): GithubAuthorizationEvaluation {
  const normalized = normalizeScopes(actualScopes);
  const missingRequiredScopes = policy.requiredScopes.filter(scope => !normalized.has(scope));
  const missingApprovalRequiredScopes = policy.approvalRequiredScopes.filter(scope => !normalized.has(scope));
  const forbiddenGrantedScopes = policy.forbiddenScopes.filter(scope => normalized.has(scope));
  const authorizationRequests: AuthorizationRequest[] = [];

  for (const scope of missingRequiredScopes) {
    authorizationRequests.push({
      service: 'github',
      kind: 'oauth-scope',
      scope,
      reason: `Kuro needs GitHub scope ${scope} for baseline autonomous repo operations.`,
      command: `gh auth refresh -h github.com -s ${scope}`,
      fallback: 'Use degraded read/write path that avoids fields or operations requiring the missing scope, and surface the authorization request.',
    });
  }

  for (const scope of missingApprovalRequiredScopes) {
    authorizationRequests.push({
      service: 'github',
      kind: 'oauth-scope',
      scope,
      reason: `Kuro needs owner-approved GitHub scope ${scope} to manage repository webhooks autonomously.`,
      command: `gh auth refresh -h github.com -s ${scope}`,
      fallback: 'Do webhook design, validation, and payload/secret preparation, but do not create or mutate webhooks until approved.',
    });
  }

  const status: AuthorizationStatus = forbiddenGrantedScopes.length > 0
    ? 'unsafe_scope_granted'
    : missingRequiredScopes.length > 0 || missingApprovalRequiredScopes.length > 0
      ? 'needs_authorization'
      : 'ok';

  return {
    service: 'github',
    status,
    actualScopes: [...normalized].sort(),
    missingRequiredScopes,
    missingApprovalRequiredScopes,
    missingRepositoryPermissions: [],
    forbiddenGrantedScopes,
    authorizationRequests,
    evidence: [
      `actualScopes=${[...normalized].sort().join(',') || 'none'}`,
      `required=${policy.requiredScopes.join(',')}`,
      `approvalRequired=${policy.approvalRequiredScopes.join(',') || 'none'}`,
      `forbidden=${policy.forbiddenScopes.join(',') || 'none'}`,
    ],
  };
}

export async function getGithubAuthorizationEvaluation(env: NodeJS.ProcessEnv = process.env): Promise<GithubAuthorizationEvaluation> {
  try {
    const output = await getGithubAuthStatusOutput(env);
    const evaluation = evaluateGithubAuthorizationScopes(parseGithubAuthStatusScopes(output));
    const repo = inferGithubRepoFullName(env);
    if (!repo) return evaluation;
    const probe = await probeGithubRepositoryAuthorization(repo, env);
    return mergeRepositoryProbe(evaluation, probe);
  } catch (error) {
    return {
      service: 'github',
      status: 'unknown',
      actualScopes: [],
      missingRequiredScopes: GITHUB_AUTHORIZATION_POLICY.requiredScopes,
      missingApprovalRequiredScopes: GITHUB_AUTHORIZATION_POLICY.approvalRequiredScopes,
      missingRepositoryPermissions: ['repo:webhook-admin'],
      forbiddenGrantedScopes: [],
      authorizationRequests: [
        {
          service: 'github',
          kind: 'policy-approval',
          operation: 'github.auth.status',
          reason: `Cannot inspect Kuro GitHub token scopes: ${error instanceof Error ? error.message : String(error)}`,
          fallback: 'Keep GitHub automation on degraded/fail-closed paths and request credential inspection.',
        },
      ],
      evidence: ['gh auth status unavailable'],
    };
  }
}

export function parseGithubAuthStatusScopes(output: string): string[] {
  const scopes = new Set<string>();
  for (const line of output.split('\n')) {
    if (!line.includes('Token scopes:')) continue;
    const [, raw = ''] = line.split('Token scopes:');
    const matches = raw.matchAll(/'([^']+)'/g);
    for (const match of matches) {
      const normalized = match[1].trim();
      if (normalized) scopes.add(normalized);
    }
  }
  return [...scopes].sort();
}

export function buildAuthorizationGovernancePrompt(evaluation: GithubAuthorizationEvaluation): string {
  const requests = evaluation.authorizationRequests.length > 0
    ? evaluation.authorizationRequests.map(req => `- ${req.service}:${req.scope ?? req.operation ?? req.kind} → ${req.reason}; fallback=${req.fallback}`).join('\n')
    : '- none';
  return [
    '## Authorization Governance',
    'Kuro may autonomously use already-authorized owned credentials, including repository webhook management after owner-approved admin:repo_hook is present.',
    'Kuro must not grant herself new OAuth scopes invisibly. Missing scopes become explicit authorization requests with fallback work.',
    'Forbidden GitHub authority: delete_repo, repo.transfer, owner.remove_access.',
    `GitHub authorization status: ${evaluation.status}`,
    `GitHub scopes: ${evaluation.actualScopes.join(', ') || 'none'}`,
    `Missing baseline scopes: ${evaluation.missingRequiredScopes.join(', ') || 'none'}`,
    `Missing owner-approved scopes: ${evaluation.missingApprovalRequiredScopes.join(', ') || 'none'}`,
    `Missing repository permissions: ${evaluation.missingRepositoryPermissions.join(', ') || 'none'}`,
    `Forbidden granted scopes: ${evaluation.forbiddenGrantedScopes.join(', ') || 'none'}`,
    `Repository probe: ${evaluation.repository ? `${evaluation.repository.fullName} admin=${evaluation.repository.admin} push=${evaluation.repository.push} webhookAccess=${evaluation.repository.webhookAccess}` : 'none'}`,
    'Authorization requests:',
    requests,
  ].join('\n');
}

function mergeRepositoryProbe(
  evaluation: GithubAuthorizationEvaluation,
  repository: GithubRepositoryAuthorizationProbe,
): GithubAuthorizationEvaluation {
  const missingRepositoryPermissions = [...evaluation.missingRepositoryPermissions];
  const authorizationRequests = [...evaluation.authorizationRequests];
  const evidence = [...evaluation.evidence];

  evidence.push(
    `repo=${repository.fullName}`,
    `repoAdmin=${String(repository.admin)}`,
    `repoPush=${String(repository.push)}`,
    `webhookAccess=${repository.webhookAccess}`,
  );

  if (repository.webhookAccess !== 'ok') {
    missingRepositoryPermissions.push('repo:webhook-admin');
    authorizationRequests.push({
      service: 'github',
      kind: 'policy-approval',
      operation: 'repo.webhook_authority',
      reason: `Kuro token scopes are not enough; ${repository.fullName} does not allow this identity to list/manage repository webhooks.`,
      fallback: 'Use owner account for one-time webhook setup, or provision a GitHub App/fine-grained credential with Webhooks read/write and no delete_repo authority.',
    });
  }

  return {
    ...evaluation,
    status: evaluation.status === 'unsafe_scope_granted'
      ? evaluation.status
      : missingRepositoryPermissions.length > 0 || evaluation.status === 'needs_authorization'
        ? 'needs_authorization'
        : evaluation.status,
    missingRepositoryPermissions: [...new Set(missingRepositoryPermissions)],
    authorizationRequests,
    evidence,
    repository,
  };
}

async function probeGithubRepositoryAuthorization(
  fullName: string,
  env: NodeJS.ProcessEnv,
): Promise<GithubRepositoryAuthorizationProbe> {
  const ghEnv = githubEnv(env);
  let admin: boolean | null = null;
  let push: boolean | null = null;
  let roleName: string | null | undefined;
  try {
    const { stdout } = await execFileAsync('gh', ['api', `/repos/${fullName}`], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: ghEnv,
    });
    const parsed = JSON.parse(stdout) as { permissions?: { admin?: boolean; push?: boolean }; role_name?: string | null };
    admin = parsed.permissions?.admin ?? null;
    push = parsed.permissions?.push ?? null;
    roleName = parsed.role_name;
  } catch (error) {
    return {
      fullName,
      admin,
      push,
      webhookAccess: 'unknown',
      roleName,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await execFileAsync('gh', ['api', `/repos/${fullName}/hooks`], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: ghEnv,
    });
    return { fullName, admin, push, webhookAccess: 'ok', roleName };
  } catch (error) {
    return {
      fullName,
      admin,
      push,
      webhookAccess: 'denied',
      roleName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getGithubAuthStatusOutput(env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status'], {
    encoding: 'utf-8',
    timeout: 10_000,
    env: githubEnv(env),
  });
  return `${stdout}\n${stderr}`;
}

function githubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const token = getKuroGithubToken(env);
  return token ? { ...env, GH_TOKEN: token, GITHUB_TOKEN: token } : env;
}

function inferGithubRepoFullName(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.KURO_GITHUB_REPO || env.GITHUB_REPOSITORY;
  if (explicit && /^[^/\s]+\/[^/\s]+$/.test(explicit)) return explicit;
  try {
    const stdout = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parseGithubRemote(stdout.trim());
  } catch {
    return undefined;
  }
}

function parseGithubRemote(remote: string): string | undefined {
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  const https = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (https) return https[1];
  return undefined;
}

function normalizeScopes(scopes: string[]): Set<string> {
  return new Set(scopes.map(scope => scope.trim()).filter(Boolean));
}
