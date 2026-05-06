import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { issueTaskId, planIssueTask, syncGitHubIssuesToTasks } from '../src/issue-autopilot.js';
import { appendMemoryIndexEntry, queryMemoryIndexSync } from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-issue-autopilot-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('issue autopilot', () => {
  it('plans stable priority tasks from GitHub issues', () => {
    const plan = planIssueTask({
      number: 100,
      title: 'Fix autonomous review loop failure',
      labels: [{ name: 'bug' }],
    }, { repo: 'miles990/mini-agent' });

    expect(plan).toEqual(expect.objectContaining({
      id: 'idx-github-issue-miles990-mini-agent-100',
      priority: 1,
      summary: 'P1 GitHub issue #100: Fix autonomous review loop failure',
      url: 'https://github.com/miles990/mini-agent/issues/100',
    }));
    expect(plan.verifyCommand).toContain('gh issue view 100 --repo miles990/mini-agent');
  });

  it('treats autonomous runtime failure language as P1 work', () => {
    const plan = planIssueTask({
      number: 91,
      title: 'graphify delegation routes prose to shell worker -> 156 cumulative bash FAILs',
      labels: [],
    }, { repo: 'miles990/mini-agent' });

    expect(plan.priority).toBe(1);
    expect(plan.summary).toBe('P1 GitHub issue #91: graphify delegation routes prose to shell worker -> 156 cumulative bash FAILs');
  });

  it('creates one scheduler-visible task per open issue and does not duplicate on resync', async () => {
    const issues = [
      { number: 100, title: 'Deploy failed after merge', labels: ['bug'] },
      { number: 101, title: 'Document dashboard controls', labels: ['docs'] },
    ];

    const first = await syncGitHubIssuesToTasks(tmpDir, issues, {
      repo: 'miles990/mini-agent',
      now: new Date('2026-05-06T00:00:00.000Z'),
    });
    const second = await syncGitHubIssuesToTasks(tmpDir, issues, {
      repo: 'miles990/mini-agent',
      now: new Date('2026-05-06T00:01:00.000Z'),
    });

    expect(first).toEqual(expect.objectContaining({ scanned: 2, created: 2, updated: 0, skipped: 0 }));
    expect(second).toEqual(expect.objectContaining({ scanned: 2, created: 0, updated: 0, skipped: 2 }));

    const tasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] });
    expect(tasks).toHaveLength(2);
    expect(tasks.map(t => t.summary).sort()).toEqual([
      'P0 GitHub issue #100: Deploy failed after merge',
      'P2 GitHub issue #101: Document dashboard controls',
    ]);
    expect(tasks[0].payload).toEqual(expect.objectContaining({
      origin: 'github-issue',
      assignee: 'kuro',
      repo: 'miles990/mini-agent',
      verify_command: expect.stringContaining('pnpm test'),
    }));
  });

  it('updates abandoned issue tasks back to pending when the issue is still open', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      id: issueTaskId('miles990/mini-agent', 88),
      type: 'task',
      status: 'abandoned',
      source: 'github-issue',
      summary: 'P2 GitHub issue #88: old title',
      refs: [],
    });

    const result = await syncGitHubIssuesToTasks(tmpDir, [
      { number: 88, title: 'Self-healing conflict guard is stuck', labels: ['bug'] },
    ], { repo: 'miles990/mini-agent' });

    expect(result).toEqual(expect.objectContaining({ created: 0, updated: 1, skipped: 0 }));
    const task = queryMemoryIndexSync(tmpDir, { id: issueTaskId('miles990/mini-agent', 88) })[0];
    expect(task).toEqual(expect.objectContaining({
      status: 'pending',
      summary: 'P1 GitHub issue #88: Self-healing conflict guard is stuck',
    }));
  });

  it('does not reopen completed tasks without an explicit lifecycle diagnosis', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      id: issueTaskId('miles990/mini-agent', 77),
      type: 'task',
      status: 'completed',
      source: 'github-issue',
      summary: 'P1 GitHub issue #77: done',
      refs: [],
    });

    const result = await syncGitHubIssuesToTasks(tmpDir, [
      { number: 77, title: 'Still open but task completed', labels: ['bug'] },
    ], { repo: 'miles990/mini-agent' });

    expect(result).toEqual(expect.objectContaining({ created: 0, updated: 0, skipped: 1 }));
    expect(queryMemoryIndexSync(tmpDir, { id: issueTaskId('miles990/mini-agent', 77) })[0].status).toBe('completed');
  });

  it('reconciles GitHub-closed issues by marking local pending entries completed', async () => {
    // Seed: a local task entry for what was previously an open issue.
    await appendMemoryIndexEntry(tmpDir, {
      id: issueTaskId('miles990/mini-agent', 75),
      type: 'task',
      status: 'pending',
      source: 'github-issue',
      summary: 'P2 GitHub issue #75: stale-pending despite closed remote',
      refs: ['https://github.com/miles990/mini-agent/issues/75'],
      tags: ['github', 'issue', 'issue:75', 'P2'],
      payload: { origin: 'github-issue', issue_number: 75, repo: 'miles990/mini-agent' },
    });

    // Now the remote is CLOSED. The fetch returns the closed issue alongside any open ones.
    const issues = [
      { number: 75, title: 'stale-pending despite closed remote', state: 'CLOSED' as const, labels: [] },
      { number: 200, title: 'still open work', state: 'OPEN' as const, labels: [] },
    ];

    const result = await syncGitHubIssuesToTasks(tmpDir, issues, {
      repo: 'miles990/mini-agent',
      now: new Date('2026-05-06T09:00:00.000Z'),
    });

    expect(result).toEqual(expect.objectContaining({ scanned: 2, created: 1, closed: 1 }));

    const stillPending = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] });
    expect(stillPending.map(t => t.payload?.issue_number).sort()).toEqual([200]);

    const completed = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['completed'] });
    expect(completed.map(t => t.payload?.issue_number)).toContain(75);
    expect(completed[0].payload).toEqual(expect.objectContaining({
      closed_via: 'issue-autopilot-reconciliation',
      github_state: 'CLOSED',
    }));
  });

  it('does not create entries for closed issues with no prior local record', async () => {
    const issues = [
      { number: 999, title: 'closed before we ever saw it', state: 'CLOSED' as const, labels: [] },
    ];
    const result = await syncGitHubIssuesToTasks(tmpDir, issues, {
      repo: 'miles990/mini-agent',
      now: new Date('2026-05-06T09:00:00.000Z'),
    });
    expect(result).toEqual(expect.objectContaining({ scanned: 1, created: 0, closed: 0, skipped: 1 }));
    expect(queryMemoryIndexSync(tmpDir, { type: ['task'] })).toHaveLength(0);
  });

});
