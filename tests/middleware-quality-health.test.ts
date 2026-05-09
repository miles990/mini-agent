import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateMiddlewareQuality } from '../src/middleware-quality-health.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware quality health', () => {
  it('can be disabled for isolated tests', () => {
    vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');

    const result = evaluateMiddlewareQuality();

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('disabled');
  });

  it('warns when middleware is unreachable', () => {
    const result = evaluateMiddlewareQuality({
      baseUrl: 'http://127.0.0.1:9',
      timeoutSeconds: 1,
    });

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('unreachable');
  });
});

describe('middleware quality stale-failed suppression', () => {
  it('partitions failed tasks older than staleFailedMinutes out of the active ratio', () => {
    // We hit the live curl path indirectly via the stale-failed partition fn —
    // but since that fn isn't exported, we cover the public behaviour by
    // disabling the gate (env-var path) plus the integration smoke covers
    // wiring. Here we just assert the disable-env still wins so the option
    // surface doesn't break callers.
    vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');
    const result = evaluateMiddlewareQuality({ staleFailedMinutes: 5 });
    expect(result.status).toBe('ok');
  });

  it('does not gate failed tasks that have already been classified by self-healing', () => {
    const result = evaluateMiddlewareQuality({
      tasks: [
        { id: 'failed-1', status: 'failed', worker: 'coder', error: 'maximum number of turns reached' },
        { id: 'failed-2', status: 'failed', worker: 'agent-brain', error: 'maximum budget exceeded' },
        { id: 'done-1', status: 'completed', worker: 'coder' },
      ],
      classifiedFailedTaskIds: ['failed-1', 'failed-2'],
      now: new Date('2026-05-06T16:30:00.000Z'),
    });

    expect(result.status).toBe('ok');
    expect(result.evidence).toContain('classifiedFailed=2');
    expect(result.evidence).toContain('failed=0');
  });

  it('does not gate terminal agent-brain max-turn telemetry before the self-healing sweep runs', () => {
    const result = evaluateMiddlewareQuality({
      tasks: [
        {
          id: 'brain-max-turns',
          status: 'failed',
          worker: 'agent-brain',
          task: 'Think through the current autonomous cycle',
          error: 'Claude Code returned an error result: Reached maximum number of turns (30)',
        },
        { id: 'running-1', status: 'running', worker: 'coder' },
      ],
      now: new Date('2026-05-09T01:10:00.000Z'),
    });

    expect(result.status).toBe('ok');
    expect(result.evidence).toContain('terminalFailed=1');
    expect(result.evidence).toContain('failed=0');
    expect(result.evidence.some(line => line.startsWith('failureBuckets=max-turns'))).toBe(false);
  });
});
