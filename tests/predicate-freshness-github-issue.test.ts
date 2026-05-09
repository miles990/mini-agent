import { describe, expect, it } from 'vitest';
import { reverifyPredicate, checkGitHubIssueOpen, type FreshnessContext } from '../src/predicate-freshness.js';

const baseCtx = (overrides: Partial<FreshnessContext> = {}): FreshnessContext => ({
  repoRoot: '/tmp/repo-doesnt-matter',
  memoryDir: '/tmp/mem-doesnt-matter',
  ...overrides,
});

describe('reverifyPredicate("github-issue-open")', () => {
  it('returns false (fresh = skip dispatch) when live state is CLOSED', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: { id: 'idx-github-issue-miles990-mini-agent-999', payload: { repo: 'miles990/mini-agent', issue_number: 999 } },
      ghIssueView: async () => ({ state: 'CLOSED' }),
    }));
    expect(result).toBe(false);
  });

  it('returns true (stale = dispatch) when live state is OPEN', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: { id: 'idx-github-issue-miles990-mini-agent-465', payload: { repo: 'miles990/mini-agent', issue_number: 465 } },
      ghIssueView: async () => ({ state: 'OPEN' }),
    }));
    expect(result).toBe(true);
  });

  it('fail-opens (null) when entry is missing', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({ ghIssueView: async () => ({ state: 'CLOSED' }) }));
    expect(result).toBeNull();
  });

  it('fail-opens (null) when payload lacks repo/issue_number', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: { id: 'idx-github-issue-foo-1', payload: { issue_number: 1 } }, // no repo
      ghIssueView: async () => ({ state: 'CLOSED' }),
    }));
    expect(result).toBeNull();
  });

  it('fail-opens (null) when ghIssueView throws', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: { id: 'idx-github-issue-x-1', payload: { repo: 'a/b', issue_number: 1 } },
      ghIssueView: async () => { throw new Error('gh: not found'); },
    }));
    expect(result).toBeNull();
  });

  it('rejects malformed repo strings', async () => {
    const result = await checkGitHubIssueOpen(baseCtx({
      entry: { payload: { repo: 'no-slash', issue_number: 1 } },
      ghIssueView: async () => ({ state: 'CLOSED' }),
    }));
    expect(result).toBeNull();
  });
});

describe('reverifyPredicate("github-issue-open") — kuro-agent monologue (issue #456)', () => {
  const meta = {
    id: 'idx-github-issue-miles990-mini-agent-456',
    payload: { repo: 'miles990/mini-agent', issue_number: 456 },
  };

  it('returns false (skip dispatch) when last 3+ comments are all kuro-agent', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: meta,
      ghIssueView: async () => ({
        state: 'OPEN',
        comments: [
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
        ],
      }),
    }));
    expect(result).toBe(false);
  });

  it('returns true (dispatch) when an external comment interleaves kuro-agent', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: meta,
      ghIssueView: async () => ({
        state: 'OPEN',
        comments: [
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
          { author: { login: 'miles990' } },
          { author: { login: 'kuro-agent' } },
        ],
      }),
    }));
    expect(result).toBe(true);
  });

  it('returns true (dispatch) when fewer than 3 consecutive kuro-agent comments at tail', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: meta,
      ghIssueView: async () => ({
        state: 'OPEN',
        comments: [
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
        ],
      }),
    }));
    expect(result).toBe(true);
  });

  it('returns true (dispatch) when comments field is omitted', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: meta,
      ghIssueView: async () => ({ state: 'OPEN' }),
    }));
    expect(result).toBe(true);
  });

  it('treats trailing non-kuro-agent comment as breaking the monologue (3 kuro then 1 external)', async () => {
    const result = await reverifyPredicate('github-issue-open', baseCtx({
      entry: meta,
      ghIssueView: async () => ({
        state: 'OPEN',
        comments: [
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
          { author: { login: 'kuro-agent' } },
          { author: { login: 'miles990' } },
        ],
      }),
    }));
    expect(result).toBe(true);
  });
});
