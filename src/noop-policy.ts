export interface NoopPolicyInput {
  hasPendingHighPriority: boolean;
  trueNoopStreak: number;
  lastCycleHadSchedule?: boolean;
}

export function effectiveTrueNoopStreak(input: NoopPolicyInput): number {
  return input.hasPendingHighPriority ? 0 : Math.max(0, input.trueNoopStreak);
}

export function shouldBypassTriageForPendingWork(input: NoopPolicyInput & { isDirectMessage: boolean }): boolean {
  return input.hasPendingHighPriority && !input.isDirectMessage;
}

export function canHardSkipRoutineTrigger(input: NoopPolicyInput): boolean {
  return !input.hasPendingHighPriority;
}

export function shouldApplyNoopBackoff(input: NoopPolicyInput): boolean {
  return !input.hasPendingHighPriority
    && !input.lastCycleHadSchedule
    && input.trueNoopStreak >= 3;
}

export function nextTrueNoopStreakAfterCycle(input: NoopPolicyInput & { hadAgentActivity: boolean }): number {
  if (input.hasPendingHighPriority) return 0;
  if (input.hadAgentActivity) return 0;
  return Math.max(0, input.trueNoopStreak) + 1;
}
