import { execFile } from 'node:child_process';
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
  forbiddenGrantedScopes: string[];
  authorizationRequests: AuthorizationRequest[];
  evidence: string[];
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
    return evaluateGithubAuthorizationScopes(parseGithubAuthStatusScopes(output));
  } catch (error) {
    return {
      service: 'github',
      status: 'unknown',
      actualScopes: [],
      missingRequiredScopes: GITHUB_AUTHORIZATION_POLICY.requiredScopes,
      missingApprovalRequiredScopes: GITHUB_AUTHORIZATION_POLICY.approvalRequiredScopes,
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
    `Forbidden granted scopes: ${evaluation.forbiddenGrantedScopes.join(', ') || 'none'}`,
    'Authorization requests:',
    requests,
  ].join('\n');
}

async function getGithubAuthStatusOutput(env: NodeJS.ProcessEnv): Promise<string> {
  const token = getKuroGithubToken(env);
  const ghEnv = token ? { ...env, GH_TOKEN: token, GITHUB_TOKEN: token } : env;
  const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status'], {
    encoding: 'utf-8',
    timeout: 10_000,
    env: ghEnv,
  });
  return `${stdout}\n${stderr}`;
}

function normalizeScopes(scopes: string[]): Set<string> {
  return new Set(scopes.map(scope => scope.trim()).filter(Boolean));
}
