import { describe, expect, it } from 'vitest';
import {
  autonomyClosureSignature,
  buildAutonomyClosureBlockMessage,
  shouldNotifyAutonomyClosureBlock,
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

  it('does not notify when there are no blocking stages', () => {
    expect(shouldNotifyAutonomyClosureBlock({
      ...blockedSnapshot,
      status: 'healthy',
      blockingStages: [],
    }, null)).toBe(false);
  });

  it('renders blocking evidence and next action', () => {
    const message = buildAutonomyClosureBlockMessage(blockedSnapshot);

    expect(message).toContain('Autonomy closure blocked');
    expect(message).toContain('blocking: task-execution');
    expect(message).toContain('next: P0 autonomy closure: repair task-execution');
    expect(message).toContain('idx-github-i hold');
  });
});
