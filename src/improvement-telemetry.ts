import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveMemoryPath } from './memory-paths.js';

export type ImprovementOutcome =
  | 'visible-output'
  | 'internal-progress'
  | 'foreground-action'
  | 'no-action'
  | 'reallocated-hold';

export interface ImprovementTelemetryEntry {
  ts: string;
  cycle: number;
  trigger: string | null;
  outcome: ImprovementOutcome;
  action: string;
  tags: string[];
  sideEffects: string[];
  noopStreak: number;
  trueNoopStreak: number;
  autonomousTaskRatio: string;
  repeatRate: string;
  efficiencySignals: string[];
  correctnessSignals: string[];
}

export interface BuildImprovementTelemetryInput {
  cycle: number;
  trigger: string | null;
  action: string | null;
  tags: string[];
  sideEffects: string[];
  noopStreak: number;
  trueNoopStreak: number;
  autonomousTaskRatio: string;
  repeatRate: string;
  hasMainVisibleOutput: boolean;
  hadForegroundAction: boolean;
  outcomeOverride?: ImprovementOutcome;
  note?: string;
}

const MAX_ENTRIES = 1000;

export function buildImprovementTelemetry(input: BuildImprovementTelemetryInput): ImprovementTelemetryEntry {
  const outcome = input.outcomeOverride ?? inferOutcome(input);
  const efficiencySignals = inferEfficiencySignals(input, outcome);
  const correctnessSignals = inferCorrectnessSignals(input, outcome);
  if (input.note) efficiencySignals.push(input.note);

  return {
    ts: new Date().toISOString(),
    cycle: input.cycle,
    trigger: input.trigger,
    outcome,
    action: summarizeAction(input.action),
    tags: input.tags,
    sideEffects: input.sideEffects,
    noopStreak: input.noopStreak,
    trueNoopStreak: input.trueNoopStreak,
    autonomousTaskRatio: input.autonomousTaskRatio,
    repeatRate: input.repeatRate,
    efficiencySignals,
    correctnessSignals,
  };
}

export function recordImprovementTelemetry(entry: ImprovementTelemetryEntry): void {
  try {
    const file = getTelemetryPath();
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
    compactTelemetryFile(file);
  } catch { /* telemetry must never block the agent */ }
}

export function readImprovementTelemetry(date?: string, limit = 100): ImprovementTelemetryEntry[] {
  const file = getTelemetryPath();
  if (!existsSync(file)) return [];
  const day = date ?? new Date().toISOString().slice(0, 10);
  try {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const entries: ImprovementTelemetryEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ImprovementTelemetryEntry;
        if (entry.ts?.startsWith(day)) entries.push(entry);
      } catch { /* skip malformed */ }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export function formatImprovementLearning(entry: ImprovementTelemetryEntry): {
  timestamp: string;
  what: string;
  why: string;
  changed: string;
  verified: string;
  urls: string[];
  full: string;
} {
  const efficiency = entry.efficiencySignals.join('; ') || 'no efficiency signal';
  const correctness = entry.correctnessSignals.join('; ') || 'no correctness signal';
  return {
    timestamp: entry.ts,
    what: `${entry.outcome}: ${entry.action}`,
    why: `Measure whether the agent is doing more useful work with the same token budget.`,
    changed: efficiency,
    verified: correctness,
    urls: [],
    full: `Cycle #${entry.cycle} outcome=${entry.outcome} repeat=${entry.repeatRate} noop=${entry.noopStreak}/${entry.trueNoopStreak} ratio=${entry.autonomousTaskRatio}\n${entry.action}`,
  };
}

function getTelemetryPath(): string {
  return resolveMemoryPath('state', 'improvement-telemetry.jsonl');
}

function inferOutcome(input: BuildImprovementTelemetryInput): ImprovementOutcome {
  if (input.hasMainVisibleOutput) return 'visible-output';
  if (input.hadForegroundAction) return 'foreground-action';
  if (input.tags.length > 0 || input.sideEffects.length > 0 || input.action) return 'internal-progress';
  return 'no-action';
}

function inferEfficiencySignals(input: BuildImprovementTelemetryInput, outcome: ImprovementOutcome): string[] {
  const signals: string[] = [];
  if (outcome === 'reallocated-hold') signals.push('confirmed hold parked by code path; LLM budget reallocated');
  if (outcome === 'visible-output') signals.push('cycle produced visible output');
  if (outcome === 'internal-progress') signals.push('cycle produced internal progress without external chatter');
  if (outcome === 'foreground-action') signals.push('foreground work counted as agent activity');
  if (outcome === 'no-action') signals.push('no-action cycle recorded for trend tracking');
  if (input.repeatRate === '0%') signals.push('repeat rate is currently 0%');
  if (input.trueNoopStreak === 0) signals.push('true noop streak is clear');
  return signals;
}

function inferCorrectnessSignals(input: BuildImprovementTelemetryInput, outcome: ImprovementOutcome): string[] {
  const signals: string[] = [];
  const action = input.action ?? '';
  if (/verified|falsifier|resolved|merged|shipped|pass/i.test(action)) {
    signals.push('action reports verification or terminal evidence');
  }
  if (outcome === 'reallocated-hold') {
    signals.push('avoids re-reasoning on confirmed wait state');
  }
  if (input.tags.some(tag => ['DONE', 'COMMIT', 'VERIFY', 'ACTION'].includes(tag.toUpperCase()))) {
    signals.push('cycle emitted completion/verification/action tag');
  }
  return signals;
}

function summarizeAction(action: string | null): string {
  if (!action) return 'no action';
  const first = action.split('\n').find(line => line.trim() && !line.trim().startsWith('#')) ?? action;
  return first.trim().slice(0, 240);
}

function compactTelemetryFile(file: string): void {
  try {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    writeFileSync(file, lines.slice(-MAX_ENTRIES).join('\n') + '\n', 'utf-8');
  } catch { /* best effort */ }
}
