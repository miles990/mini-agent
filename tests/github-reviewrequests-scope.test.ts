import { describe, expect, it } from 'vitest';
import { isGithubReviewRequestsScopeError } from '../src/github.js';

describe('GitHub reviewRequests scope degradation', () => {
  it('recognizes gh reviewRequests read:org scope failures as expected fallback cases', () => {
    const err = new Error([
      'Command failed: gh pr list --state open --json number,title,reviewRequests --limit 50',
      "GraphQL: Your token has not been granted the required scopes to execute this query. The 'login' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['repo'] scopes.",
    ].join('\n'));

    expect(isGithubReviewRequestsScopeError(err)).toBe(true);
  });

  it('does not hide unrelated GitHub errors', () => {
    expect(isGithubReviewRequestsScopeError(new Error('HTTP 500 from GitHub'))).toBe(false);
  });
});
