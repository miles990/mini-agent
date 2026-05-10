import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyCloudPrompt,
  decideCloudTokenRoute,
  readCloudPromptUsage,
} from '../src/cloud-token-governor.js';
import type { SchedulingDecision } from '../src/scheduler.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-cloud-token-governor-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function decision(overrides: Partial<SchedulingDecision> = {}): SchedulingDecision {
  return {
    taskId: null,
    reason: 'discovery slot: no tasks, free exploration',
    action: 'discovery',
    suspended: null,
    ...overrides,
  };
}

function writeClaudeLog(date: string, prompt: string, timestamp = `${date}T01:00:00.000Z`): void {
  const dir = path.join(tmpDir, '03bbc29a', 'logs', 'claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${date}.jsonl`), `${JSON.stringify({
    timestamp,
    data: { input: { userMessage: prompt }, duration: 1000 },
  })}\n`);
}

describe('cloud token governor', () => {
  it('classifies cloud prompt buckets used by routing reports', () => {
    expect(classifyCloudPrompt('<current-task binding="open-cycle">OPEN CYCLE</current-task>')).toBe('open-cycle/discovery');
    expect(classifyCloudPrompt('<current-task binding="scheduler">autonomy closure</current-task>')).toBe('autonomy-closure/scheduler');
    expect(classifyCloudPrompt('telegram-user says hello')).toBe('foreground/status-room');
  });

  it('reads daily cloud prompt usage from instance logs', () => {
    writeClaudeLog('2026-05-10', '<current-task binding="open-cycle">OPEN CYCLE</current-task>', '2026-05-10T02:00:00.000Z');
    const usage = readCloudPromptUsage('2026-05-10', tmpDir);

    expect(usage['open-cycle/discovery'].calls).toBe(1);
    expect(usage['open-cycle/discovery'].estInputTokens).toBeGreaterThan(0);
    expect(usage['open-cycle/discovery'].lastSeenAt).toBe('2026-05-10T02:00:00.000Z');
  });

  it('preserves cloud budget for direct user-visible triggers', () => {
    const route = decideCloudTokenRoute({
      decision: decision(),
      events: [{ source: 'room', priority: 0, isAlexDirectMessage: true }],
      cycleMode: 'act',
      promptChars: 10_000,
      hasPendingTasks: false,
      hasHighPriorityTasks: false,
      trueNoopStreak: 0,
      date: '2026-05-10',
      logsRoot: tmpDir,
      now: new Date('2026-05-10T03:00:00.000Z'),
      env: {},
    });

    expect(route.action).toBe('call-cloud');
    expect(route.reason).toContain('direct');
  });

  it('routes routine idle cycles to deterministic probes', () => {
    const route = decideCloudTokenRoute({
      decision: decision({ action: 'idle', reason: 'idle: no schedulable tasks until next discovery slot' }),
      events: [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }],
      cycleMode: 'idle',
      promptChars: 1000,
      hasPendingTasks: false,
      hasHighPriorityTasks: false,
      trueNoopStreak: 0,
      date: '2026-05-10',
      logsRoot: tmpDir,
      env: {},
    });

    expect(route.action).toBe('deterministic-probe');
    expect(route.reason).toContain('routine idle');
  });

  it('cooldowns routine open-cycle discovery after a recent cloud discovery', () => {
    writeClaudeLog(
      '2026-05-10',
      '<current-task binding="open-cycle">OPEN CYCLE: free exploration</current-task>',
      '2026-05-10T02:30:00.000Z',
    );

    const route = decideCloudTokenRoute({
      decision: decision(),
      events: [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }],
      cycleMode: 'act',
      promptChars: 20_000,
      hasPendingTasks: false,
      hasHighPriorityTasks: false,
      trueNoopStreak: 0,
      date: '2026-05-10',
      logsRoot: tmpDir,
      now: new Date('2026-05-10T03:00:00.000Z'),
      env: {},
    });

    expect(route.action).toBe('deterministic-probe');
    expect(route.reason).toContain('cooling down');
  });

  it('allows budgeted cloud discovery when no recent open-cycle exists', () => {
    const route = decideCloudTokenRoute({
      decision: decision(),
      events: [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }],
      cycleMode: 'act',
      promptChars: 20_000,
      hasPendingTasks: false,
      hasHighPriorityTasks: false,
      trueNoopStreak: 0,
      date: '2026-05-10',
      logsRoot: tmpDir,
      now: new Date('2026-05-10T03:00:00.000Z'),
      env: {},
    });

    expect(route.action).toBe('call-cloud');
  });
});
