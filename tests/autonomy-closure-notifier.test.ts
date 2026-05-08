import { describe, expect, it } from 'vitest';
import {
  autonomyClosureSignature,
  buildAutonomyClosureBlockMessage,
  buildAutonomyClosureResolvedMessage,
  shouldNotifyAutonomyClosureBlock,
  shouldNotifyAutonomyClosureResolved,
} from '../src/autonomy-closure-notifier.js';

const blockedSnapshot = {
  status: 'blocked',
  score: 62,
  blockingStages: ['task-execution'],
  warningStages: ['memory-state-truth'],
  recommendedTask: { title: 'P0 autonomy closure: repair task-execution' },
  stages: [
    {
      stage: 'task-execution',
      status: 'blocked',
      summary: '1 task(s) exhausted autonomous retries',
      evidence: ['idx-github-i hold: P0 GitHub issue #256'],
    },
  ],
};

describe('autonomy closure notifier', () => {
  it('notifies when a blocking signature first appears', () => {
    expect(shouldNotifyAutonomyClosureBlock(blockedSnapshot, null)).toBe(true);
  });

  it('does not notify repeatedly for the same blocking signature', () => {
    expect(shouldNotifyAutonomyClosureBlock(blockedSnapshot, autonomyClosureSignature(blockedSnapshot))).toBe(false);
  });

  it('does not repeat a block notification when only warning stages change', () => {
    const sameBlockDifferentWarnings = {
      ...blockedSnapshot,
      score: 70,
      warningStages: ['operational-efficiency'],
    };

    expect(shouldNotifyAutonomyClosureBlock(sameBlockDifferentWarnings, autonomyClosureSignature(blockedSnapshot))).toBe(false);
  });

  it('does not notify when there are no blocking stages', () => {
    expect(shouldNotifyAutonomyClosureBlock({
      ...blockedSnapshot,
      status: 'healthy',
      blockingStages: [],
    }, null)).toBe(false);
  });

  it('notifies once when a previously blocked closure becomes healthy', () => {
    const healthySnapshot = {
      ...blockedSnapshot,
      status: 'healthy',
      score: 100,
      blockingStages: [],
      warningStages: [],
      recommendedTask: null,
    };

    expect(shouldNotifyAutonomyClosureResolved(healthySnapshot, autonomyClosureSignature(blockedSnapshot))).toBe(true);
    expect(shouldNotifyAutonomyClosureResolved(healthySnapshot, autonomyClosureSignature(healthySnapshot))).toBe(false);
  });

  it('renders blocking evidence and next action', () => {
    const message = buildAutonomyClosureBlockMessage(blockedSnapshot);

    expect(message).toContain('Autonomy closure blocked');
    expect(message).toContain('blocking: task-execution');
    expect(message).toContain('next: P0 autonomy closure: repair task-execution');
    expect(message).toContain('idx-github-i hold');
  });

  it('renders resolved notification', () => {
    const message = buildAutonomyClosureResolvedMessage({
      ...blockedSnapshot,
      status: 'healthy',
      score: 100,
      blockingStages: [],
      warningStages: [],
      recommendedTask: null,
    });

    expect(message).toContain('Autonomy closure healthy');
    expect(message).toContain('warnings: none');
  });
});
