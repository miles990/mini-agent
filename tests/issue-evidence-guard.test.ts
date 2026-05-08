import { describe, expect, it } from 'vitest';
import { evaluateIssueEvidenceGuard } from '../src/issue-evidence-guard.js';

describe('issue evidence guard', () => {
  it('allows ordinary non-recurrence issues without extra evidence', () => {
    const result = evaluateIssueEvidenceGuard({
      title: 'repair memory read side effect',
      body: 'A read-only query creates an empty file. Root cause and fix are included.',
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresRecurrenceEvidence).toBe(false);
  });

  it('blocks recurrence claims without structured recurrence evidence', () => {
    const result = evaluateIssueEvidenceGuard({
      title: 'agent-brain lane recurring max-turns failures',
      body: 'Ledger confirms worker=agent-brain bucket=max-turns for at least 6 of last 20 entries.',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('recurrence issue requires unique_events>=3');
    expect(result.reasons).toContain('recurrence issue requires first_seen and last_seen');
  });

  it('blocks same-burst evidence even when count is high enough', () => {
    const result = evaluateIssueEvidenceGuard({
      title: 'recurring max-turns failures',
      body: [
        'Recurrence evidence:',
        'count: 3',
        'unique_events: 3',
        'first_seen: 2026-05-08T09:41:06.810Z',
        'last_seen: 2026-05-08T09:41:06.810Z',
        'source: /Users/user/Workspace/mini-agent-memory/memory/index/middleware-failure-classifications.jsonl',
      ].join('\n'),
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('recurrence issue requires events spread across >=10 minutes, not a single burst');
  });

  it('allows recurrence claims with distinct events over time and source evidence', () => {
    const result = evaluateIssueEvidenceGuard({
      title: 'recurring middleware offline failures',
      body: [
        'Recurrence evidence:',
        'count: 4',
        'unique_events: 4',
        'first_seen: 2026-05-08T09:00:00.000Z',
        'last_seen: 2026-05-08T09:45:00.000Z',
        'source: curl http://localhost:3200/tasks | jq ...',
      ].join('\n'),
    });

    expect(result.allowed).toBe(true);
  });
});
