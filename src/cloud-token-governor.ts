import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SchedulingDecision, IncomingEvent } from './scheduler.js';
import type { CycleMode } from './memory.js';

export type CloudPromptBucket =
  | 'heartbeat-cron'
  | 'open-cycle/discovery'
  | 'autonomy-closure/scheduler'
  | 'continue-current'
  | 'foreground/status-room'
  | 'delegation-absorb'
  | 'other';

export interface CloudPromptUsageBucket {
  calls: number;
  promptChars: number;
  estInputTokens: number;
  durationMs: number;
  lastSeenAt: string | null;
}

export type CloudPromptUsage = Record<CloudPromptBucket, CloudPromptUsageBucket>;

export interface CloudTokenGovernorInput {
  decision: SchedulingDecision;
  events: IncomingEvent[];
  cycleMode: CycleMode;
  promptChars: number;
  hasPendingTasks: boolean;
  hasHighPriorityTasks: boolean;
  trueNoopStreak: number;
  date?: string;
  now?: Date;
  logsRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CloudTokenGovernorDecision {
  action: 'call-cloud' | 'deterministic-probe';
  reason: string;
  bucket?: CloudPromptBucket;
  usage?: CloudPromptUsageBucket;
  cooldownMs?: number;
}

const BUCKETS: CloudPromptBucket[] = [
  'heartbeat-cron',
  'open-cycle/discovery',
  'autonomy-closure/scheduler',
  'continue-current',
  'foreground/status-room',
  'delegation-absorb',
  'other',
];

const DIRECT_TRIGGER_SOURCES = new Set(['telegram', 'room', 'chat', 'direct-message']);
const ROUTINE_TRIGGER_SOURCES = new Set(['heartbeat', 'cron', 'startup', 'workspace', 'continuation']);

export function classifyCloudPrompt(prompt: string): CloudPromptBucket {
  const p = prompt.toLowerCase();
  if (p.includes('check heartbeat.md for pending tasks')) return 'heartbeat-cron';
  if (p.includes('binding="open-cycle"') || p.includes('open cycle')) return 'open-cycle/discovery';
  if (p.includes('binding="scheduler"') || p.includes('scheduler task') || p.includes('autonomy closure')) return 'autonomy-closure/scheduler';
  if (p.includes('continue-current') || p.includes('binding="continue"')) return 'continue-current';
  if (p.includes('telegram-user') || p.includes('chat-room-inbox') || p.includes('room-priority')) return 'foreground/status-room';
  if (p.includes('delegation') || p.includes('background-completed')) return 'delegation-absorb';
  return 'other';
}

export function readCloudPromptUsage(
  date: string,
  logsRoot = path.join(os.homedir(), '.mini-agent', 'instances'),
): CloudPromptUsage {
  const usage = emptyUsage();
  if (!fs.existsSync(logsRoot)) return usage;

  for (const entry of fs.readdirSync(logsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(logsRoot, entry.name, 'logs', 'claude', `${date}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as {
          timestamp?: string;
          data?: { input?: { userMessage?: string }; duration?: number };
          metadata?: { duration?: number };
        };
        const prompt = row.data?.input?.userMessage ?? '';
        if (!prompt) continue;
        const bucket = classifyCloudPrompt(prompt);
        const current = usage[bucket];
        current.calls += 1;
        current.promptChars += prompt.length;
        current.estInputTokens += Math.round(prompt.length / 4);
        const duration = Number(row.data?.duration ?? row.metadata?.duration ?? 0);
        if (Number.isFinite(duration)) current.durationMs += duration;
        if (row.timestamp && (!current.lastSeenAt || row.timestamp > current.lastSeenAt)) {
          current.lastSeenAt = row.timestamp;
        }
      } catch {
        // Ignore malformed log rows; the governor must not break the loop.
      }
    }
  }
  return usage;
}

export function decideCloudTokenRoute(input: CloudTokenGovernorInput): CloudTokenGovernorDecision {
  const env = input.env ?? process.env;
  if (env.MINI_AGENT_CLOUD_TOKEN_GOVERNOR === '0') {
    return { action: 'call-cloud', reason: 'governor disabled by MINI_AGENT_CLOUD_TOKEN_GOVERNOR=0' };
  }

  if (input.events.some(event => event.isAlexDirectMessage || DIRECT_TRIGGER_SOURCES.has(event.source))) {
    return { action: 'call-cloud', reason: 'direct user-visible signal deserves cloud reasoning budget' };
  }

  if (input.decision.taskId || input.hasPendingTasks || input.hasHighPriorityTasks || input.cycleMode === 'task' || input.cycleMode === 'respond') {
    return { action: 'call-cloud', reason: 'bound or pending work deserves cloud reasoning budget' };
  }

  const routine = input.events.length === 0 || input.events.some(event => ROUTINE_TRIGGER_SOURCES.has(event.source));
  if (!routine) return { action: 'call-cloud', reason: 'non-routine trigger' };

  const date = input.date ?? (input.now ?? new Date()).toISOString().slice(0, 10);
  const usage = readCloudPromptUsage(date, input.logsRoot);
  const openCycleUsage = usage['open-cycle/discovery'];
  const totalTokens = BUCKETS.reduce((sum, bucket) => sum + usage[bucket].estInputTokens, 0);
  const dailyBudget = readIntEnv(env, 'MINI_AGENT_DAILY_CLOUD_TOKEN_BUDGET', 350_000);
  const cooldownMs = readIntEnv(env, 'MINI_AGENT_OPEN_CYCLE_CLOUD_COOLDOWN_MS', 6 * 60 * 60_000);

  if (input.decision.action === 'idle') {
    return {
      action: 'deterministic-probe',
      reason: 'routine idle cycle has no bound work; use code probes instead of cloud LLM',
      bucket: 'open-cycle/discovery',
      usage: openCycleUsage,
      cooldownMs,
    };
  }

  if (input.decision.action === 'discovery') {
    // The discovery slot is Kuro's creative trunk — a primary track of being.
    // It must be able to think (cloud LLM): you cannot create with a code
    // probe. The 6h cooldown / open-cycle sub-budget / noop-streak gates
    // throttled it down to ~1 real cycle per 6h and starved creativity. The
    // only limit kept is the daily hard token budget, so total cost stays
    // bounded without singling creativity out as the thing to cut.
    if (totalTokens >= dailyBudget) {
      return {
        action: 'deterministic-probe',
        reason: `daily cloud prompt budget reached (${totalTokens} >= ${dailyBudget}); reserve cloud for direct or bound work`,
        bucket: 'open-cycle/discovery',
        usage: openCycleUsage,
        cooldownMs,
      };
    }
    return {
      action: 'call-cloud',
      reason: 'creative trunk (discovery slot) — a primary trunk gets cloud reasoning to actually create',
    };
  }

  return { action: 'call-cloud', reason: 'within cloud budget and cooldown' };
}

function emptyUsage(): CloudPromptUsage {
  return Object.fromEntries(BUCKETS.map(bucket => [bucket, {
    calls: 0,
    promptChars: 0,
    estInputTokens: 0,
    durationMs: 0,
    lastSeenAt: null,
  }])) as CloudPromptUsage;
}

function readIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
