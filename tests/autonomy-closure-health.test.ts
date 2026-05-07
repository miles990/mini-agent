import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeResolvedAutonomyClosureTasks,
  ensureAutonomyClosureTask,
  evaluateAutonomyClosure,
} from '../src/autonomy-closure-health.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';
import { writeOpenPrSnapshot } from '../src/pr-autopilot.js';
import { appendPrReviewClaim, createPrReviewClaim } from '../src/pr-review-runner.js';

describe('autonomy closure health', () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-autonomy-closure-'));
    repoRoot = path.join(tmpDir, 'runtime');
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
    vi.stubEnv('MINI_AGENT_MEMORY_DIR', tmpDir);
    vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports a healthy closed loop when observable memory has no blockers', () => {
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.recommendedTask).toBeNull();
    expect(snapshot.stages.map(s => s.stage)).toContain('memory-context');
  });

  it('creates one repair task for exhausted autonomous execution', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      JSON.stringify({
        id: 'idx-exhausted',
        ts: '2026-05-07T00:00:00.000Z',
        type: 'task',
        status: 'hold',
        summary: 'P1 failing autonomous issue repair',
        refs: [],
        payload: {
          origin: 'github-issue',
          priority: 1,
          verify_command: 'pnpm test',
          auto_executor_failures: 3,
        },
      }) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockingStages).toContain('task-execution');

    const task = await ensureAutonomyClosureTask(tmpDir, snapshot);
    const duplicate = await ensureAutonomyClosureTask(tmpDir, snapshot);

    expect(task?.summary).toContain('P0 autonomy closure: repair task-execution');
    expect(duplicate?.id).toBe(task?.id);
    const tasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] })
      .filter(t => (t.payload as Record<string, unknown>)?.origin === 'autonomy-closure');
    expect(tasks).toHaveLength(1);
  });

  it('blocks closure when a Kuro-intended public write used the wrong account', () => {
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/public-write-provenance.jsonl'), JSON.stringify({
      id: 'pub-mismatch',
      observedAt: '2026-05-07T10:00:00.000Z',
      service: 'github',
      action: 'pr.create',
      subject: 'PR #261',
      expectedActor: 'kuro-agent',
      actualActor: 'miles990',
      intentActor: 'kuro',
      source: 'codex-github-connector',
      status: 'open',
      evidence: [],
    }) + '\n', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockingStages).toContain('public-write-identity');
    expect(snapshot.stages.find(s => s.stage === 'public-write-identity')?.evidence[0]).toContain('expected=kuro-agent actual=miles990');
  });

  it('does not block PR review consensus on handoffs for PRs absent from the open PR snapshot', () => {
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');
    mkdirSync(path.join(tmpDir, 'handoffs'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'handoffs/active.md'), [
      '| source | owner | item | status | opened | closed |',
      '| github | codex | PR #313 stale closed PR | changes-requested | 05-07 | - |',
    ].join('\n') + '\n', 'utf-8');
    appendPrReviewClaim(tmpDir, createPrReviewClaim({
      prNumber: 313,
      reviewer: 'codex',
      framework: 'code-review',
      verdict: 'request_changes',
      risk: 'medium',
      summary: 'Stale change request for a closed PR.',
      evidence: ['handoff'],
    }));
    writeOpenPrSnapshot(tmpDir, [], new Date('2026-05-08T00:00:00.000Z'));

    const snapshot = evaluateAutonomyClosure(tmpDir, {
      repoRoot,
      now: new Date('2026-05-08T00:01:00.000Z'),
    });

    expect(snapshot.blockingStages).not.toContain('pr-review-consensus');
    expect(snapshot.stages.find(s => s.stage === 'pr-review-consensus')).toEqual(expect.objectContaining({
      status: 'ok',
      summary: 'no pending PR review handoffs and open PR snapshot is current',
    }));
  });

  it('closes active autonomy closure task after blockers resolve', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      [
        JSON.stringify({
          id: 'idx-existing',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'pending',
          summary: 'P0 autonomy closure: repair task-execution',
          refs: [],
          tags: ['autonomy-closure'],
          payload: { origin: 'autonomy-closure', priority: 0 },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    const closed = await closeResolvedAutonomyClosureTasks(tmpDir, snapshot);

    expect(snapshot.status).toBe('healthy');
    expect(closed).toHaveLength(1);
    expect(queryMemoryIndexSync(tmpDir, { id: 'idx-existing', limit: 1 })[0].status).toBe('completed');
  });

  it('refreshes an existing repair task with the latest closure snapshot', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      [
        JSON.stringify({
          id: 'idx-existing',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'pending',
          summary: 'P0 autonomy closure: repair old-stage',
          refs: [],
          tags: ['autonomy-closure'],
          payload: {
            origin: 'autonomy-closure',
            priority: 0,
            acceptance_criteria: 'old stale blocker',
          },
        }),
        JSON.stringify({
          id: 'idx-exhausted',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'hold',
          summary: 'P1 failing autonomous issue repair',
          refs: [],
          payload: {
            origin: 'github-issue',
            priority: 1,
            verify_command: 'pnpm test',
            auto_executor_failures: 3,
          },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    const task = await ensureAutonomyClosureTask(tmpDir, snapshot);

    expect(task?.id).toBe('idx-existing');
    expect(task?.summary).toBe('P0 autonomy closure: repair task-execution');
    expect(task?.payload?.acceptance_criteria).toContain('1 task(s) exhausted autonomous retries');
    expect(task?.payload?.closure_refreshed_at).toEqual(expect.any(String));
  });

  it('releases a stale autonomy closure hold when it has no unblock condition', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      [
        JSON.stringify({
          id: 'idx-existing',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'hold',
          summary: 'P0 autonomy closure: repair old-stage',
          refs: [],
          tags: ['autonomy-closure'],
          payload: {
            origin: 'autonomy-closure',
            priority: 0,
            staleWarning: 'old provider failure',
          },
        }),
        JSON.stringify({
          id: 'idx-exhausted',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'hold',
          summary: 'P1 failing autonomous issue repair',
          refs: [],
          payload: {
            origin: 'github-issue',
            priority: 1,
            verify_command: 'pnpm test',
            auto_executor_failures: 3,
          },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const task = await ensureAutonomyClosureTask(tmpDir, evaluateAutonomyClosure(tmpDir, { repoRoot }));

    expect(task?.status).toBe('pending');
    expect(task?.payload?.closure_unheld_reason).toBe('refreshed stale autonomy closure hold without unblock condition');
  });

  it('keeps a timed provider resource hold in hold status', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      JSON.stringify({
        id: 'idx-existing',
        ts: '2026-05-07T00:00:00.000Z',
        type: 'task',
        status: 'hold',
        summary: 'P0 autonomy closure: repair old-stage',
        refs: [],
        tags: ['autonomy-closure'],
        payload: {
          origin: 'autonomy-closure',
          priority: 0,
          holdCondition: { type: 'date-after', value: '2026-05-07T02:40:00.000Z' },
        },
      }) + '\n' + JSON.stringify({
        id: 'idx-exhausted',
        ts: '2026-05-07T00:00:00.000Z',
        type: 'task',
        status: 'hold',
        summary: 'P1 failing autonomous issue repair',
        refs: [],
        payload: {
          origin: 'github-issue',
          priority: 1,
          verify_command: 'pnpm test',
          auto_executor_failures: 3,
        },
      }) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const task = await ensureAutonomyClosureTask(tmpDir, evaluateAutonomyClosure(tmpDir, { repoRoot }));

    expect(task?.status).toBe('hold');
    expect(task?.payload?.closure_unheld_reason).toBeUndefined();
  });
});
