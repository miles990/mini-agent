import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordSkillUsage } from '../src/agent-skill-manager.js';
import { queryMemoryIndexSync, updateMemoryIndexEntry } from '../src/memory-index.js';
import {
  maybeQueueSkillPromotion,
  readSkillPromotionRecords,
  summarizeSkillPromotionAutopilot,
  sweepSkillPromotionBacktests,
} from '../src/skill-promotion-autopilot.js';

function memoryDir(): string {
  return mkdtempSync(join(tmpdir(), 'mini-agent-skill-promotion-'));
}

function seedPromotionUsage(dir: string, pattern = 'always-on autonomy health gate for phantom task suppression'): void {
  for (let i = 0; i < 3; i += 1) {
    recordSkillUsage(dir, {
      skill: 'constraint-texture-analysis',
      outcome: 'success',
      pattern,
      savedTokensEstimate: 2_000,
      combinedWith: ['kg-context-synthesis', 'task-decomposition'],
      note: 'runtime gate should close loop automatically',
      ts: `2026-05-07T00:0${i}:00.000Z`,
    });
  }
}

describe('skill promotion autopilot', () => {
  it('queues the top promotion candidate as a scheduler-visible task', async () => {
    const dir = memoryDir();
    seedPromotionUsage(dir);

    const result = await maybeQueueSkillPromotion(dir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-07T01:00:00.000Z'),
    });

    expect(result.queued).toBe(true);
    expect(result.task?.summary).toContain('P1 skill promotion:');
    expect(result.task?.payload).toEqual(expect.objectContaining({
      origin: 'skill-promotion-autopilot',
      recommended_kind: 'code',
      effect_backtest: expect.objectContaining({ next_uses: 3 }),
    }));
    expect(queryMemoryIndexSync(dir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
    expect(readSkillPromotionRecords(dir)[0]).toEqual(expect.objectContaining({
      status: 'queued',
      queuedTaskId: result.task?.id,
    }));
  });

  it('does not queue a second candidate while a promotion task is active', async () => {
    const dir = memoryDir();
    seedPromotionUsage(dir);

    await maybeQueueSkillPromotion(dir, { triggerReason: 'heartbeat' });
    const second = await maybeQueueSkillPromotion(dir, { triggerReason: 'heartbeat' });

    expect(second).toEqual(expect.objectContaining({
      queued: false,
      reason: 'active-promotion-task-exists',
    }));
  });

  it('moves completed promotion tasks into observing and accepts after successful backtest uses', async () => {
    const dir = memoryDir();
    const pattern = 'always-on autonomy health gate for phantom task suppression';
    seedPromotionUsage(dir, pattern);
    const queued = await maybeQueueSkillPromotion(dir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-07T01:00:00.000Z'),
    });
    await updateMemoryIndexEntry(dir, queued.task!.id, { status: 'completed' });

    const observing = await sweepSkillPromotionBacktests(dir, { now: new Date('2026-05-07T02:00:00.000Z') });
    expect(observing.updated).toBe(1);
    expect(observing.records[0].status).toBe('observing');

    for (let i = 0; i < 3; i += 1) {
      recordSkillUsage(dir, {
        skill: 'constraint-texture-analysis',
        outcome: 'success',
        pattern,
        ts: `2026-05-07T03:0${i}:00.000Z`,
      });
    }

    const accepted = await sweepSkillPromotionBacktests(dir, { now: new Date('2026-05-07T04:00:00.000Z') });
    expect(accepted.accepted).toBe(1);
    expect(summarizeSkillPromotionAutopilot(dir).accepted[0]).toEqual(expect.objectContaining({
      observedUses: 3,
      observedSuccessRate: 1,
    }));
  });

  it('does not queue repeated patterns without measurable impact evidence', async () => {
    const dir = memoryDir();
    for (let i = 0; i < 3; i += 1) {
      recordSkillUsage(dir, {
        skill: 'constraint-texture-analysis',
        outcome: 'success',
        pattern: 'p0 low responsiveness scheduler task stack ranked from this',
        combinedWith: ['kg-context-synthesis', 'task-decomposition'],
        ts: `2026-05-07T00:1${i}:00.000Z`,
      });
    }

    const result = await maybeQueueSkillPromotion(dir, { triggerReason: 'heartbeat' });

    expect(result).toEqual(expect.objectContaining({
      queued: false,
      reason: 'no-eligible-candidate',
    }));
    expect(queryMemoryIndexSync(dir, { type: ['task'], status: ['pending'] })).toHaveLength(0);
  });

  it('dismisses queued promotions that lose measurable impact eligibility', async () => {
    const dir = memoryDir();
    const queuedTaskId = (await maybeQueueSkillPromotionWithImpact(dir)).taskId;
    const queued = queryMemoryIndexSync(dir, { id: queuedTaskId })[0];
    expect(queued.status).toBe('pending');

    const ledgerDir = join(dir, 'state');
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(join(ledgerDir, 'skill-usage.jsonl'), '', 'utf-8');

    const dismissed = await sweepSkillPromotionBacktests(dir, { now: new Date('2026-05-07T02:00:00.000Z') });
    const task = queryMemoryIndexSync(dir, { id: queued.id })[0];

    expect(dismissed.dismissed).toBe(1);
    expect(dismissed.records[0]).toEqual(expect.objectContaining({ status: 'dismissed' }));
    expect(task.status).toBe('abandoned');
    expect(task.payload).toEqual(expect.objectContaining({
      abandoned_reason: 'skill-promotion-insufficient-impact-evidence',
    }));
  });
});

async function maybeQueueSkillPromotionWithImpact(dir: string): Promise<{ taskId: string }> {
  seedPromotionUsage(dir);
  const result = await maybeQueueSkillPromotion(dir, { triggerReason: 'heartbeat' });
  return { taskId: result.task!.id };
}
