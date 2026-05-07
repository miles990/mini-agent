import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { appendMemoryIndexEntry, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import {
  readSkillUsage,
  suggestPatternPromotions,
  type PatternPromotionCandidate,
  type SkillUsageEvent,
} from './agent-skill-manager.js';

const LEDGER_FILE = 'skill-promotion-autopilot.jsonl';
const ACTIVE_TASK_STATUSES = ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'];
const TERMINAL_TASK_STATUSES = ['completed', 'done', 'abandoned', 'dropped', 'deleted'];

export type SkillPromotionStatus = 'queued' | 'observing' | 'accepted' | 'iterate' | 'dismissed';

export interface SkillPromotionObservationPolicy {
  nextUses: number;
  minSuccessRate: number;
}

export interface SkillPromotionAutopilotRecord {
  type: 'skill_promotion_autopilot';
  id: string;
  pattern: string;
  service: string;
  recommendedKind: PatternPromotionCandidate['recommendedKind'];
  status: SkillPromotionStatus;
  queuedAt: string;
  queuedTaskId?: string;
  implementedAt?: string;
  decidedAt?: string;
  observedUses?: number;
  observedSuccessRate?: number;
  observationPolicy: SkillPromotionObservationPolicy;
  rationale: string[];
  verifier: string;
  candidate: PatternPromotionCandidate['suggestedCapability'];
  note?: string;
}

export interface SkillPromotionAutopilotOptions {
  now?: Date;
  triggerReason?: string | null;
  maxActive?: number;
  dryRun?: boolean;
  observationPolicy?: Partial<SkillPromotionObservationPolicy>;
}

export interface SkillPromotionAutopilotResult {
  queued: boolean;
  reason: string;
  candidate?: PatternPromotionCandidate;
  task?: MemoryIndexEntry;
  record?: SkillPromotionAutopilotRecord;
}

export interface SkillPromotionBacktestResult {
  updated: number;
  accepted: number;
  iterate: number;
  dismissed: number;
  records: SkillPromotionAutopilotRecord[];
}

export interface SkillPromotionAutopilotSummary {
  ledger: string;
  candidates: PatternPromotionCandidate[];
  records: SkillPromotionAutopilotRecord[];
  active: SkillPromotionAutopilotRecord[];
  observing: SkillPromotionAutopilotRecord[];
  accepted: SkillPromotionAutopilotRecord[];
  iterate: SkillPromotionAutopilotRecord[];
  dismissed: SkillPromotionAutopilotRecord[];
  nextCandidate?: PatternPromotionCandidate;
  policy: string;
}

export async function maybeQueueSkillPromotion(
  memoryDir: string,
  opts: SkillPromotionAutopilotOptions = {},
): Promise<SkillPromotionAutopilotResult> {
  if (!isPromotionTrigger(opts.triggerReason ?? '')) {
    return { queued: false, reason: 'not-promotion-trigger' };
  }

  const maxActive = opts.maxActive ?? 1;
  const activeTasks = activePromotionTasks(memoryDir);
  if (activeTasks.length >= maxActive) {
    return { queued: false, reason: 'active-promotion-task-exists' };
  }

  const latest = latestRecords(memoryDir);
  const candidate = nextPromotionCandidate(memoryDir, latest);
  if (!candidate) return { queued: false, reason: 'no-eligible-candidate' };

  const record = createQueuedRecord(candidate, opts);
  if (opts.dryRun) return { queued: true, reason: 'dry-run', candidate, record };

  const task = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'pending',
    summary: promotionTaskTitle(candidate),
    tags: ['skill-promotion', 'autopilot', candidate.recommendedKind],
    refs: ['memory/state/skill-usage.jsonl', `pattern:${candidate.pattern}`],
    payload: {
      origin: 'skill-promotion-autopilot',
      priority: 1,
      pattern: candidate.pattern,
      recommended_kind: candidate.recommendedKind,
      suggested_capability: candidate.suggestedCapability,
      required_skills: candidate.skills,
      acceptance_criteria: promotionAcceptance(candidate, record.observationPolicy),
      verify_command: 'pnpm typecheck && pnpm test && pnpm check:autonomy-closure -- --json',
      effect_backtest: {
        ledger: `memory/state/${LEDGER_FILE}`,
        next_uses: record.observationPolicy.nextUses,
        min_success_rate: record.observationPolicy.minSuccessRate,
      },
    },
  });

  const persisted = { ...record, queuedTaskId: task.id };
  appendPromotionRecord(memoryDir, persisted);
  eventBus.emit('action:task', {
    event: 'skill-promotion-queued',
    taskId: task.id,
    pattern: candidate.pattern,
    recommendedKind: candidate.recommendedKind,
    service: candidate.suggestedCapability.service,
  });

  return { queued: true, reason: 'queued', candidate, task, record: persisted };
}

export async function sweepSkillPromotionBacktests(
  memoryDir: string,
  opts: SkillPromotionAutopilotOptions = {},
): Promise<SkillPromotionBacktestResult> {
  const now = (opts.now ?? new Date()).toISOString();
  const records = latestRecords(memoryDir);
  const usage = readSkillUsage(memoryDir);
  let updated = 0;
  let accepted = 0;
  let iterate = 0;
  let dismissed = 0;
  const written: SkillPromotionAutopilotRecord[] = [];
  const eligiblePromotionIds = new Set(suggestPatternPromotions(memoryDir).map(promotionId));

  for (const record of records.values()) {
    if (record.status === 'queued') {
      const task = record.queuedTaskId
        ? queryMemoryIndexSync(memoryDir, { id: record.queuedTaskId, limit: 1 })[0]
        : undefined;
      if (!eligiblePromotionIds.has(record.id)) {
        if (task && ACTIVE_TASK_STATUSES.includes(String(task.status))) {
          const payload = (task.payload ?? {}) as Record<string, unknown>;
          await updateMemoryIndexEntry(memoryDir, task.id, {
            status: 'abandoned',
            payload: {
              ...payload,
              autoAbandoned: true,
              abandoned_reason: 'skill-promotion-insufficient-impact-evidence',
              abandoned_at: now,
              ticksSinceLastProgress: 0,
            },
          });
        }
        const next: SkillPromotionAutopilotRecord = {
          ...record,
          status: 'dismissed',
          decidedAt: now,
          note: 'promotion dismissed because the pattern no longer has measurable token/time impact evidence',
        };
        appendPromotionRecord(memoryDir, next);
        written.push(next);
        updated++;
        dismissed++;
        continue;
      }
      if (!task || !TERMINAL_TASK_STATUSES.includes(String(task.status))) continue;
      if (!['completed', 'done'].includes(String(task.status))) {
        const next: SkillPromotionAutopilotRecord = {
          ...record,
          status: 'iterate',
          decidedAt: now,
          note: `implementation task ended as ${task.status}; revise promotion before retrying`,
        };
        appendPromotionRecord(memoryDir, next);
        written.push(next);
        updated++;
        iterate++;
        continue;
      }
      const next: SkillPromotionAutopilotRecord = {
        ...record,
        status: 'observing',
        implementedAt: now,
        note: 'implementation task completed; observing next skill-usage events',
      };
      appendPromotionRecord(memoryDir, next);
      written.push(next);
      updated++;
      continue;
    }

    if (record.status !== 'observing' || !record.implementedAt) continue;
    const observed = observedUsage(record, usage);
    if (observed.uses < record.observationPolicy.nextUses) continue;

    const status: SkillPromotionStatus = observed.successRate >= record.observationPolicy.minSuccessRate
      ? 'accepted'
      : 'iterate';
    const next: SkillPromotionAutopilotRecord = {
      ...record,
      status,
      decidedAt: now,
      observedUses: observed.uses,
      observedSuccessRate: observed.successRate,
      note: status === 'accepted'
        ? 'promotion backtest passed'
        : 'promotion backtest failed; revise or disable promoted capability',
    };
    appendPromotionRecord(memoryDir, next);
    written.push(next);
    updated++;
    if (status === 'accepted') accepted++;
    if (status === 'iterate') iterate++;
  }

  return { updated, accepted, iterate, dismissed, records: written };
}

export function summarizeSkillPromotionAutopilot(memoryDir: string): SkillPromotionAutopilotSummary {
  const candidates = suggestPatternPromotions(memoryDir);
  const records = [...latestRecords(memoryDir).values()]
    .sort((a, b) => (b.decidedAt ?? b.implementedAt ?? b.queuedAt).localeCompare(a.decidedAt ?? a.implementedAt ?? a.queuedAt));
  const active = records.filter(record => record.status === 'queued');
  const observing = records.filter(record => record.status === 'observing');
  const accepted = records.filter(record => record.status === 'accepted');
  const iterate = records.filter(record => record.status === 'iterate');
  const dismissed = records.filter(record => record.status === 'dismissed');
  return {
    ledger: `memory/state/${LEDGER_FILE}`,
    candidates,
    records,
    active,
    observing,
    accepted,
    iterate,
    dismissed,
    nextCandidate: nextPromotionCandidate(memoryDir, latestRecords(memoryDir)),
    policy: 'Queue at most one skill-promotion task with measurable token/time impact evidence; dismiss queued promotions that lose eligibility; after implementation, observe the next 3 matching skill-usage events and accept only if successRate >= 0.67.',
  };
}

export function readSkillPromotionRecords(memoryDir: string): SkillPromotionAutopilotRecord[] {
  const filePath = promotionLedgerPath(memoryDir);
  if (!fs.existsSync(filePath)) return [];
  const records: SkillPromotionAutopilotRecord[] = [];
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SkillPromotionAutopilotRecord;
      if (parsed.type === 'skill_promotion_autopilot' && parsed.id && parsed.pattern && parsed.status) {
        records.push(parsed);
      }
    } catch {
      // Ignore malformed telemetry. The autopilot remains best-effort.
    }
  }
  return records;
}

function nextPromotionCandidate(
  memoryDir: string,
  latest: Map<string, SkillPromotionAutopilotRecord>,
): PatternPromotionCandidate | undefined {
  return suggestPatternPromotions(memoryDir).find(candidate => {
    const id = promotionId(candidate);
    const record = latest.get(id);
    if (!record) return true;
    return record.status === 'iterate';
  });
}

function activePromotionTasks(memoryDir: string): MemoryIndexEntry[] {
  return queryMemoryIndexSync(memoryDir, { type: ['task'], status: ACTIVE_TASK_STATUSES })
    .filter(task => {
      const payload = (task.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'skill-promotion-autopilot'
        || (task.summary ?? '').includes('skill promotion:');
    });
}

function createQueuedRecord(
  candidate: PatternPromotionCandidate,
  opts: SkillPromotionAutopilotOptions,
): SkillPromotionAutopilotRecord {
  const policy = {
    nextUses: opts.observationPolicy?.nextUses ?? 3,
    minSuccessRate: opts.observationPolicy?.minSuccessRate ?? 0.67,
  };
  return {
    type: 'skill_promotion_autopilot',
    id: promotionId(candidate),
    pattern: candidate.pattern,
    service: candidate.suggestedCapability.service,
    recommendedKind: candidate.recommendedKind,
    status: 'queued',
    queuedAt: (opts.now ?? new Date()).toISOString(),
    observationPolicy: policy,
    rationale: candidate.rationale,
    verifier: candidate.suggestedCapability.verifier,
    candidate: candidate.suggestedCapability,
  };
}

function appendPromotionRecord(memoryDir: string, record: SkillPromotionAutopilotRecord): void {
  const filePath = promotionLedgerPath(memoryDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

function latestRecords(memoryDir: string): Map<string, SkillPromotionAutopilotRecord> {
  const latest = new Map<string, SkillPromotionAutopilotRecord>();
  for (const record of readSkillPromotionRecords(memoryDir)) latest.set(record.id, record);
  return latest;
}

function observedUsage(record: SkillPromotionAutopilotRecord, usage: SkillUsageEvent[]): { uses: number; successRate: number } {
  const since = Date.parse(record.implementedAt ?? '');
  const observed = usage.filter(event => {
    if (Number.isFinite(since) && Date.parse(event.ts ?? '') < since) return false;
    return normalizePattern(event.pattern ?? '') === normalizePattern(record.pattern)
      || event.skill === record.service
      || event.combinedWith?.includes(record.service);
  });
  const success = observed.filter(event => event.outcome === 'success').length;
  return {
    uses: observed.length,
    successRate: observed.length > 0 ? success / observed.length : 0,
  };
}

function promotionTaskTitle(candidate: PatternPromotionCandidate): string {
  return `P1 skill promotion: turn ${candidate.pattern.slice(0, 90)} into ${candidate.recommendedKind}`;
}

function promotionAcceptance(candidate: PatternPromotionCandidate, policy: SkillPromotionObservationPolicy): string {
  return [
    `Implement ${candidate.suggestedCapability.service} as ${candidate.recommendedKind} using the lowest-overhead durable form.`,
    `Impact evidence: savedTokens=${Math.round(candidate.savedTokensEstimate)}, savedMinutes=${Math.round(candidate.savedMinutesEstimate)}.`,
    `Required loop: code/script/workflow change -> PR -> review consensus -> merge -> deploy -> record skill usage.`,
    `Backtest: next ${policy.nextUses} matching skill-usage events must keep successRate >= ${policy.minSuccessRate}.`,
    `Verifier: ${candidate.suggestedCapability.verifier}`,
  ].join(' ');
}

function promotionId(candidate: PatternPromotionCandidate): string {
  return `skill-promotion:${candidate.suggestedCapability.service}`;
}

function promotionLedgerPath(memoryDir: string): string {
  return path.join(memoryDir, 'state', LEDGER_FILE);
}

function isPromotionTrigger(trigger: string): boolean {
  return trigger === ''
    || trigger.includes('heartbeat')
    || trigger.startsWith('workspace')
    || trigger.includes('skill-promotion')
    || trigger.includes('self-improvement');
}

function normalizePattern(pattern: string): string {
  return pattern.toLowerCase().replace(/\s+/g, ' ').trim();
}
