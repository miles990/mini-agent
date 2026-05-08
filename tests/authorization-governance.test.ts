import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationGovernancePrompt,
  evaluateGithubAuthorizationScopes,
  parseGithubAuthStatusScopes,
} from '../src/authorization-governance.js';

describe('authorization governance', () => {
  it('requires webhook scope while forbidding repo deletion authority', () => {
    const evaluation = evaluateGithubAuthorizationScopes([
      'repo',
      'workflow',
      'user',
      'notifications',
      'read:org',
    ]);

    expect(evaluation.status).toBe('needs_authorization');
    expect(evaluation.missingRequiredScopes).toEqual([]);
    expect(evaluation.missingApprovalRequiredScopes).toEqual(['admin:repo_hook']);
    expect(evaluation.authorizationRequests[0]).toEqual(expect.objectContaining({
      scope: 'admin:repo_hook',
      command: 'gh auth refresh -h github.com -s admin:repo_hook',
    }));
  });

  it('flags delete_repo as unsafe even when all useful scopes exist', () => {
    const evaluation = evaluateGithubAuthorizationScopes([
      'repo',
      'workflow',
      'user',
      'notifications',
      'read:org',
      'admin:repo_hook',
      'delete_repo',
    ]);

    expect(evaluation.status).toBe('unsafe_scope_granted');
    expect(evaluation.forbiddenGrantedScopes).toEqual(['delete_repo']);
  });

  it('parses gh auth status scope lines', () => {
    const scopes = parseGithubAuthStatusScopes(`
github.com
  ✓ Logged in to github.com account kuro-agent (GH_TOKEN)
  - Token scopes: 'audit_log', 'repo', 'read:org', 'workflow'
`);

    expect(scopes).toEqual(['audit_log', 'read:org', 'repo', 'workflow']);
  });

  it('renders missing authorization into the agent prompt contract', () => {
    const evaluation = evaluateGithubAuthorizationScopes(['repo']);
    const prompt = buildAuthorizationGovernancePrompt(evaluation);

    expect(prompt).toContain('Authorization Governance');
    expect(prompt).toContain('Missing baseline scopes');
    expect(prompt).toContain('Missing owner-approved scopes: admin:repo_hook');
    expect(prompt).toContain('delete_repo');
    expect(prompt).toContain('Authorization requests');
  });
});
