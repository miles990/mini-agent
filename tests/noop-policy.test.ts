import { describe, expect, it } from 'vitest';
import {
  canHardSkipRoutineTrigger,
  effectiveTrueNoopStreak,
  nextTrueNoopStreakAfterCycle,
  shouldApplyNoopBackoff,
  shouldBypassTriageForPendingWork,
} from '../src/noop-policy.js';

describe('noop policy', () => {
  it('clears restored trueNoopStreak when high-priority work exists', () => {
    expect(effectiveTrueNoopStreak({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
    })).toBe(0);
  });

  it('always lets P0/P1 pending work bypass mushi triage unless the trigger is a direct message', () => {
    expect(shouldBypassTriageForPendingWork({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
      isDirectMessage: false,
    })).toBe(true);
    expect(shouldBypassTriageForPendingWork({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
      isDirectMessage: true,
    })).toBe(false);
  });

  it('does not hard-skip or back off routine triggers while high-priority work exists', () => {
    expect(canHardSkipRoutineTrigger({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
    })).toBe(false);
    expect(shouldApplyNoopBackoff({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
      lastCycleHadSchedule: false,
    })).toBe(false);
  });

  it('still allows noop backoff when there is no high-priority work', () => {
    expect(shouldApplyNoopBackoff({
      hasPendingHighPriority: false,
      trueNoopStreak: 3,
      lastCycleHadSchedule: false,
    })).toBe(true);
  });

  it('keeps trueNoopStreak at zero after empty cycles if high-priority work remains pending', () => {
    expect(nextTrueNoopStreakAfterCycle({
      hasPendingHighPriority: true,
      trueNoopStreak: 20,
      hadAgentActivity: false,
    })).toBe(0);
  });
});
