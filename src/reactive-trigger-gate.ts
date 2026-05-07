/**
 * Reactive trigger gate.
 *
 * Cheap pre-context guard for routine triggers. It exists to stop workspace /
 * heartbeat noise from spending a full OODA context build when a lightweight
 * probe says there is no new actionable work.
 */

export type ReactiveTriggerSource =
  | 'workspace'
  | 'heartbeat'
  | 'mobile'
  | 'telegram'
  | 'room'
  | 'chat'
  | 'alert'
  | 'cron'
  | 'delegation-complete'
  | 'delegation-batch'
  | 'continuation'
  | 'manual'
  | 'startup'
  | 'unknown';

export interface ReactiveTriggerProbe {
  source: ReactiveTriggerSource;
  nowMs?: number;
  path?: string;
  perceptionChanged: boolean;
  pendingHighPriority: number;
  pendingInbox: number;
  pendingDelegationResults: boolean;
  pendingPriority: boolean;
  lastAction?: string | null;
  trueNoopStreak: number;
}

export interface ReactiveTriggerGateOptions {
  workspaceCooldownMs: number;
  heartbeatIdleCooldownMs: number;
  estimatedContextChars: number;
}

export interface ReactiveTriggerDecision {
  action: 'wake' | 'skip';
  reason: string;
  savedContextChars: number;
}

export interface ReactiveTriggerGateMetrics {
  skipped: number;
  woken: number;
  savedContextChars: number;
  lastDecision: {
    action: 'wake' | 'skip';
    source: ReactiveTriggerSource;
    reason: string;
    ts: string;
  } | null;
}

const DEFAULT_OPTIONS: ReactiveTriggerGateOptions = {
  workspaceCooldownMs: 5 * 60 * 1000,
  heartbeatIdleCooldownMs: 5 * 60 * 1000,
  estimatedContextChars: 25_000,
};

const BYPASS_SOURCES = new Set<ReactiveTriggerSource>([
  'telegram',
  'room',
  'chat',
  'alert',
  'cron',
  'delegation-complete',
  'delegation-batch',
  'continuation',
  'manual',
  'startup',
]);

export class ReactiveTriggerGate {
  private readonly options: ReactiveTriggerGateOptions;
  private lastWorkspaceWakeByKey = new Map<string, number>();
  private lastHeartbeatIdleSkipAt = 0;
  private metrics: ReactiveTriggerGateMetrics = {
    skipped: 0,
    woken: 0,
    savedContextChars: 0,
    lastDecision: null,
  };

  constructor(options: Partial<ReactiveTriggerGateOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  decide(probe: ReactiveTriggerProbe): ReactiveTriggerDecision {
    const now = probe.nowMs ?? Date.now();
    const source = normalizeSource(probe.source);
    const actionable = actionableProbeReasons(probe);
    let decision: ReactiveTriggerDecision;

    if (BYPASS_SOURCES.has(source)) {
      decision = { action: 'wake', reason: `bypass:${source}`, savedContextChars: 0 };
    } else if (actionable.length > 0) {
      decision = { action: 'wake', reason: `probe:${actionable.join('+')}`, savedContextChars: 0 };
    } else if (source === 'workspace') {
      decision = this.workspaceDecision(probe, now);
    } else if (source === 'heartbeat') {
      decision = this.heartbeatDecision(probe, now);
    } else {
      decision = { action: 'wake', reason: 'not-routine', savedContextChars: 0 };
    }

    this.record(source, decision, now);
    return decision;
  }

  getMetrics(): ReactiveTriggerGateMetrics {
    return {
      ...this.metrics,
      lastDecision: this.metrics.lastDecision ? { ...this.metrics.lastDecision } : null,
    };
  }

  formatStatus(): string {
    const last = this.metrics.lastDecision;
    const lastText = last ? ` last=${last.action}:${last.source}:${last.reason}` : '';
    return `ReactiveTriggerGate: skipped=${this.metrics.skipped} woken=${this.metrics.woken} saved≈${this.metrics.savedContextChars} chars${lastText}`;
  }

  reset(): void {
    this.lastWorkspaceWakeByKey.clear();
    this.lastHeartbeatIdleSkipAt = 0;
    this.metrics = {
      skipped: 0,
      woken: 0,
      savedContextChars: 0,
      lastDecision: null,
    };
  }

  private workspaceDecision(probe: ReactiveTriggerProbe, now: number): ReactiveTriggerDecision {
    const key = workspaceKey(probe.path);
    const lastWake = this.lastWorkspaceWakeByKey.get(key) ?? 0;
    if (lastWake > 0 && now - lastWake < this.options.workspaceCooldownMs) {
      return {
        action: 'skip',
        reason: `workspace-cooldown:${key}`,
        savedContextChars: this.options.estimatedContextChars,
      };
    }

    this.lastWorkspaceWakeByKey.set(key, now);
    return { action: 'wake', reason: `workspace-probe:${key}`, savedContextChars: 0 };
  }

  private heartbeatDecision(probe: ReactiveTriggerProbe, now: number): ReactiveTriggerDecision {
    const idleLastAction = !probe.lastAction || /no action|穩態|無需行動|nothing to do/i.test(probe.lastAction);
    if (idleLastAction || probe.trueNoopStreak > 0 || !probe.perceptionChanged) {
      if (this.lastHeartbeatIdleSkipAt === 0) {
        this.lastHeartbeatIdleSkipAt = now;
        return {
          action: 'skip',
          reason: 'heartbeat-idle-probe',
          savedContextChars: this.options.estimatedContextChars,
        };
      }
      if (now - this.lastHeartbeatIdleSkipAt < this.options.heartbeatIdleCooldownMs) {
        return {
          action: 'skip',
          reason: 'heartbeat-idle-cooldown',
          savedContextChars: this.options.estimatedContextChars,
        };
      }
      this.lastHeartbeatIdleSkipAt = now;
      return { action: 'wake', reason: 'heartbeat-periodic-scout', savedContextChars: 0 };
    }
    return { action: 'wake', reason: 'heartbeat-probe', savedContextChars: 0 };
  }

  private record(source: ReactiveTriggerSource, decision: ReactiveTriggerDecision, now: number): void {
    if (decision.action === 'skip') {
      this.metrics.skipped++;
      this.metrics.savedContextChars += decision.savedContextChars;
    } else {
      this.metrics.woken++;
    }
    this.metrics.lastDecision = {
      action: decision.action,
      source,
      reason: decision.reason,
      ts: new Date(now).toISOString(),
    };
  }
}

export function parseReactiveTriggerSource(triggerReason: string | null | undefined): ReactiveTriggerSource {
  const reason = (triggerReason ?? '').trim();
  if (!reason) return 'unknown';
  if (reason.startsWith('telegram-user') || reason.startsWith('telegram')) return 'telegram';
  if (reason.startsWith('room')) return 'room';
  if (reason.startsWith('chat')) return 'chat';
  if (reason.startsWith('workspace')) return 'workspace';
  if (reason.startsWith('heartbeat')) return 'heartbeat';
  if (reason.startsWith('mobile')) return 'mobile';
  if (reason.startsWith('alert')) return 'alert';
  if (reason.startsWith('cron')) return 'cron';
  if (reason.startsWith('delegation-complete')) return 'delegation-complete';
  if (reason.startsWith('delegation-batch')) return 'delegation-batch';
  if (reason.startsWith('continuation')) return 'continuation';
  if (reason.startsWith('manual')) return 'manual';
  if (reason.startsWith('startup')) return 'startup';
  if (reason.startsWith('direct-message')) return 'chat';
  return 'unknown';
}

export function extractTriggerPath(triggerReason: string | null | undefined): string | undefined {
  const reason = triggerReason ?? '';
  const match = reason.match(/"path"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

function actionableProbeReasons(probe: ReactiveTriggerProbe): string[] {
  const reasons: string[] = [];
  if (probe.pendingPriority) reasons.push('pending-priority');
  if (probe.pendingDelegationResults) reasons.push('delegation-results');
  if (probe.pendingInbox > 0) reasons.push('pending-inbox');
  if (probe.pendingHighPriority > 0 && probe.trueNoopStreak < 3) reasons.push('high-priority-work');
  return reasons;
}

function workspaceKey(triggerPath: string | undefined): string {
  if (!triggerPath) return 'workspace';
  if (triggerPath.startsWith('memory/handoffs/')) return triggerPath;
  return triggerPath.split('/').slice(0, 2).join('/') || triggerPath;
}

function normalizeSource(source: ReactiveTriggerSource): ReactiveTriggerSource {
  return source === 'mobile' ? 'heartbeat' : source;
}

export const reactiveTriggerGate = new ReactiveTriggerGate();
