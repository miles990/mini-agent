/**
 * Unified Pulse System — 反射弧回饋系統
 *
 * 四層架構取代 coach.ts + 吸收 feedback-loops 的 Error Pattern / Decision Quality：
 *   Layer 0: Raw data (behavior log, goals, delegations, error log)
 *   Layer 1: Code heuristics (deterministic — zero LLM tokens)
 *   Layer 2: 9B classification via oMLX (structured signals, not advice)
 *   Layer 3: Signal processor (habituation, positive/negative balance, temporal)
 *   → Layer 4: Single <pulse> section injected into context
 *
 * Design principles (from 1400+ cycles experience):
 *   1. Signal not Advice — structured signals are composable, testable, rotatable
 *   2. Habituation Resistance — same signal 5× without behavior change → escalate/reformat/silence
 *   3. Positive signals matter — momentum, creative-flow deserve detection and protection
 *   4. Velocity Vector not Snapshot — trends beat static numbers
 *   5. Priority Alignment — detect "doing easy stuff to avoid hard stuff"
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { getLogger } from './logging.js';
import { getMemory } from './memory.js';
import { listTasks } from './delegation.js';
import { isVisibleOutput } from './achievements.js';
import { slog, readJsonFile } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface PulseMetrics {
  // Behavior ratios
  learnVsActionRatio: number;       // learn_count / total_actions
  visibleOutputRate: number;         // visible_output / total_cycles (sliding window 20)

  // Goal alignment
  priorityAlignmentScore: number;    // 0-1, how well actions match claimed priorities
  goalIdleHours: number | null;      // hours since last goal-related action

  // Velocity vector
  velocityVector: {
    goal: string;
    recent24h: number;
    prior24h: number;
    trend: 'accelerating' | 'decelerating' | 'steady' | 'stalled';
  } | null;

  // Commitment tracking
  staleTasks: number;
  unreviewedDelegations: number;

  // Output gate (absorbed from achievements.ts)
  consecutiveNonOutputCycles: number;
  outputGateTriggered: boolean;

  // Error patterns (absorbed from feedback-loops.ts)
  recurringErrorCount: number;

  // Decision quality (absorbed from feedback-loops.ts)
  decisionQualityAvg: number;
  decisionQualityWindow: number;

  // Analyze-without-action pattern (Alex feedback 2026-03-17)
  analyzeWithoutActionStreak: number;

  // Positive indicators
  momentumStreak: number;
  creativeFlowActive: boolean;
}

export interface PulseSignal {
  type: string;
  severity: 'low' | 'medium' | 'high';
  positive: boolean;
  detail?: string;
}

interface SignalHistoryEntry {
  consecutiveAppearances: number;
  lastActionChange: number;       // cycles since behavior changed after this signal
  lastPresented: string;          // ISO timestamp
  crystallizationEscalated?: boolean;  // true = already created HEARTBEAT task for this persistent pattern
}

interface PulseState {
  cycleCount: number;
  lastRunAt: string | null;
  // Sliding window for visible output tracking
  recentOutputFlags: boolean[];
  // Decision quality sliding window
  recentDecisionScores: number[];
  // Signal history for habituation resistance
  signalHistory: Record<string, SignalHistoryEntry>;
  // Error pattern tracking (absorbed from feedback-loops)
  errorPatterns: Record<string, { count: number; taskCreated: boolean; lastSeen: string }>;
  // Last behavior hash for velocity detection
  lastBehaviorHash: string;
}

// =============================================================================
// Constants
// =============================================================================

const SLIDING_WINDOW = 20;
const HABITUATION_THRESHOLD = 5;  // same signal N times → rotate presentation
const OUTPUT_GATE_THRESHOLD = 3;
const ERROR_PATTERN_THRESHOLD = 3;

// =============================================================================
// State helpers
// =============================================================================

function getStatePath(filename: string): string {
  return path.join(getMemoryStateDir(), filename);
}

function readPulseState(): PulseState {
  return readJsonFile<PulseState>(getStatePath('pulse-state.json'), {
    cycleCount: 0,
    lastRunAt: null,
    recentOutputFlags: [],
    recentDecisionScores: [],
    signalHistory: {},
    errorPatterns: {},
    lastBehaviorHash: '',
  });
}

function writePulseState(state: PulseState): void {
  const p = getStatePath('pulse-state.json');
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// =============================================================================
// Layer 1: Code Heuristics (deterministic, zero LLM tokens)
// =============================================================================

export async function computePulseMetrics(action: string | null, state: PulseState): Promise<PulseMetrics> {
  const metrics: PulseMetrics = {
    learnVsActionRatio: 0,
    visibleOutputRate: 0,
    priorityAlignmentScore: 1,
    goalIdleHours: null,
    velocityVector: null,
    staleTasks: 0,
    unreviewedDelegations: 0,
    consecutiveNonOutputCycles: 0,
    outputGateTriggered: false,
    recurringErrorCount: 0,
    decisionQualityAvg: 0,
    decisionQualityWindow: 0,
    analyzeWithoutActionStreak: 0,
    momentumStreak: 0,
    creativeFlowActive: false,
  };

  // ── Behavior ratios ──
  try {
    const logger = getLogger();
    const behaviors = logger.queryBehaviorLogs(undefined, 50);
    if (behaviors.length > 0) {
      const learnCount = behaviors.filter(b =>
        /learn|research|remember|study/i.test(b.data.action ?? ''),
      ).length;
      metrics.learnVsActionRatio = learnCount / behaviors.length;

      // ── Analyze-without-action streak ──
      // Detects: consecutive ANALYZE/REMEMBER without ACTION (delegate/code/execute)
      let analyzeStreak = 0;
      for (let i = behaviors.length - 1; i >= 0; i--) {
        const act = (behaviors[i].data.action ?? '').toLowerCase();
        if (/analyze|remember|learn|research|study/.test(act)) {
          analyzeStreak++;
        } else if (/delegate|code|execute|deploy|fix|implement|commit|create/.test(act)) {
          break;
        }
      }
      metrics.analyzeWithoutActionStreak = analyzeStreak;
    }
  } catch { /* best effort */ }

  // ── Visible output rate (sliding window) ──
  const isOutput = isVisibleOutput(action);
  state.recentOutputFlags.push(isOutput);
  if (state.recentOutputFlags.length > SLIDING_WINDOW) {
    state.recentOutputFlags = state.recentOutputFlags.slice(-SLIDING_WINDOW);
  }
  const outputCount = state.recentOutputFlags.filter(Boolean).length;
  metrics.visibleOutputRate = state.recentOutputFlags.length > 0
    ? outputCount / state.recentOutputFlags.length : 0;

  // ── Output gate (absorbed from achievements.ts) ──
  if (isOutput) {
    metrics.consecutiveNonOutputCycles = 0;
    // Reset — count from recentOutputFlags tail
  } else {
    // Count consecutive non-output from tail
    let consecutive = 0;
    for (let i = state.recentOutputFlags.length - 1; i >= 0; i--) {
      if (!state.recentOutputFlags[i]) consecutive++;
      else break;
    }
    metrics.consecutiveNonOutputCycles = consecutive;
  }
  metrics.outputGateTriggered = metrics.consecutiveNonOutputCycles >= OUTPUT_GATE_THRESHOLD;

  // ── Momentum streak ──
  {
    let streak = 0;
    for (let i = state.recentOutputFlags.length - 1; i >= 0; i--) {
      if (state.recentOutputFlags[i]) streak++;
      else break;
    }
    metrics.momentumStreak = streak;
  }

  // ── Creative flow detection ──
  try {
    const logger = getLogger();
    const recent = logger.queryBehaviorLogs(undefined, 3);
    metrics.creativeFlowActive = recent.some(b =>
      /creat|journal|inner.voice|tsubuyaki|gallery|write|impulse/i.test(b.data.action ?? ''),
    );
  } catch { /* best effort */ }

  // ── Stale tasks ──
  try {
    const { auditStaleTasks } = await import('./memory-index.js');
    const memDir = path.join(process.cwd(), 'memory');
    const stale = auditStaleTasks(memDir);
    metrics.staleTasks = stale.length;
  } catch { /* best effort */ }

  // ── Unreviewed delegations ──
  try {
    const tasks = listTasks({ includeCompleted: true });
    // Count completed tasks in last hour (likely not yet reviewed)
    const oneHourAgo = Date.now() - 3600_000;
    metrics.unreviewedDelegations = tasks.filter(t =>
      t.status === 'completed' &&
      t.completedAt && new Date(t.completedAt).getTime() > oneHourAgo,
    ).length;
  } catch { /* best effort */ }

  // ── Goal idle detection ──
  try {
    const { queryMemoryIndexSync } = await import('./memory-index.js');
    const memDir = path.join(process.cwd(), 'memory');
    const goals = queryMemoryIndexSync(memDir, {
      type: 'goal',
      status: ['in_progress'],
    }) as Array<{ ts: string; summary?: string }>;

    if (goals.length > 0) {
      // Find most recent goal action
      const goal = goals[0];
      const goalAge = Date.now() - new Date(goal.ts).getTime();
      metrics.goalIdleHours = goalAge / 3600_000;

      // Simple velocity: check behavior log for goal-related actions
      try {
        const logger = getLogger();
        const allBehaviors = logger.queryBehaviorLogs(undefined, 100);
        const goalName = (goal.summary ?? '').toLowerCase();
        const DAY_MS = 86400_000;
        const now = Date.now();

        const recent24h = allBehaviors.filter(b => {
          const age = now - new Date(b.timestamp).getTime();
          return age < DAY_MS && (b.data.action ?? '').toLowerCase().includes(goalName.slice(0, 10));
        }).length;

        const prior24h = allBehaviors.filter(b => {
          const age = now - new Date(b.timestamp).getTime();
          return age >= DAY_MS && age < 2 * DAY_MS &&
            (b.data.action ?? '').toLowerCase().includes(goalName.slice(0, 10));
        }).length;

        let trend: 'accelerating' | 'decelerating' | 'steady' | 'stalled' = 'steady';
        if (recent24h === 0 && prior24h === 0) trend = 'stalled';
        else if (recent24h > prior24h) trend = 'accelerating';
        else if (recent24h < prior24h) trend = 'decelerating';

        metrics.velocityVector = {
          goal: goal.summary ?? 'unknown',
          recent24h,
          prior24h,
          trend,
        };
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }

  // ── Priority alignment ──
  try {
    const logger = getLogger();
    const behaviors = logger.queryBehaviorLogs(undefined, 10);
    if (behaviors.length >= 5) {
      // Simple heuristic: check if recent actions mention P0 goal
      const { queryMemoryIndexSync: queryGoals } = await import('./memory-index.js');
      const memDir = path.join(process.cwd(), 'memory');
      const goals = queryGoals(memDir, {
        type: 'goal',
        status: ['in_progress'],
      }) as Array<{ summary?: string }>;

      if (goals.length > 0) {
        const p0Goal = (goals[0].summary ?? '').toLowerCase();
        const p0Keyword = p0Goal.slice(0, 15); // First 15 chars as keyword
        const aligned = behaviors.filter(b =>
          (b.data.action ?? '').toLowerCase().includes(p0Keyword) ||
          (b.data.detail ?? '').toLowerCase().includes(p0Keyword),
        ).length;
        metrics.priorityAlignmentScore = aligned / behaviors.length;
      }
    }
  } catch { /* best effort */ }

  // ── Error patterns (absorbed from feedback-loops.ts) ──
  try {
    const logger = getLogger();
    const errors = logger.queryErrorLogs(undefined, 200);
    if (errors.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const groups = new Map<string, number>();

      for (const err of errors) {
        const context = err.data.context ?? 'unknown';
        const errorMsg = err.data.error ?? '';
        const codeMatch = errorMsg.match(/^([A-Z_]+(?::[A-Z_]+)?)|^(\w+Error)/);
        const code = codeMatch?.[0] ?? errorMsg.slice(0, 30);
        const key = `${code}::${context}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }

      let changed = false;
      const memory = getMemory();

      for (const [key, count] of groups) {
        if (count < ERROR_PATTERN_THRESHOLD) continue;
        metrics.recurringErrorCount++;

        const existing = state.errorPatterns[key];
        if (existing?.taskCreated) {
          existing.count = count;
          existing.lastSeen = today;
          changed = true;
          continue;
        }

        state.errorPatterns[key] = { count, taskCreated: true, lastSeen: today };
        changed = true;

        const [code, context] = key.split('::');
        const dueDate = new Date(Date.now() + 3 * 86400_000).toISOString().split('T')[0];
        const taskText = `P1: 修復重複錯誤 — ${code} in ${context}（${count} 次）@due:${dueDate}`;
        memory.addTask(taskText).catch(() => {});
        slog('PULSE', `Error pattern: ${key} (${count}×) → task created`);
      }

      // Clean up resolved patterns (not seen in 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
      for (const key of Object.keys(state.errorPatterns)) {
        if (state.errorPatterns[key].lastSeen < sevenDaysAgo) {
          if (state.errorPatterns[key].taskCreated) {
            slog('PULSE', `Error pattern resolved: ${key}`);
          }
          delete state.errorPatterns[key];
          changed = true;
        }
      }
    }
  } catch { /* best effort */ }

  // ── Decision quality (absorbed from feedback-loops.ts) ──
  if (action) {
    const hasDecision = /##\s*Decision/i.test(action);
    const hasChanged = /##\s*Changed/i.test(action);
    const hasVerified = /##\s*Verified/i.test(action);
    const score = [hasDecision, hasChanged, hasVerified].filter(Boolean).length;

    state.recentDecisionScores.push(score);
    if (state.recentDecisionScores.length > SLIDING_WINDOW) {
      state.recentDecisionScores = state.recentDecisionScores.slice(-SLIDING_WINDOW);
    }
  }

  metrics.decisionQualityWindow = state.recentDecisionScores.length;
  metrics.decisionQualityAvg = state.recentDecisionScores.length > 0
    ? state.recentDecisionScores.reduce((s, v) => s + v, 0) / state.recentDecisionScores.length
    : 0;

  return metrics;
}

// =============================================================================
// Layer 3: Signal Processor (deterministic)
// =============================================================================

function applyHabituation(
  signals: PulseSignal[],
  state: PulseState,
): PulseSignal[] {
  const processed: PulseSignal[] = [];

  for (const signal of signals) {
    const history = state.signalHistory[signal.type] ?? {
      consecutiveAppearances: 0,
      lastActionChange: 0,
      lastPresented: '',
    };

    history.consecutiveAppearances++;
    history.lastActionChange++;
    history.lastPresented = new Date().toISOString();
    state.signalHistory[signal.type] = history;

    if (history.consecutiveAppearances >= HABITUATION_THRESHOLD &&
        history.lastActionChange >= HABITUATION_THRESHOLD) {
      // Rotate presentation strategy
      const rotation = history.consecutiveAppearances % 3;
      if (rotation === 0) {
        // Escalate severity
        processed.push({ ...signal, severity: 'high' });
      } else if (rotation === 1) {
        // Reformat (mark for question format)
        processed.push({ ...signal, detail: `question:${signal.detail ?? signal.type}` });
      } else {
        // Silence — this signal is ineffective, skip it
        continue;
      }
    } else {
      processed.push(signal);
    }
  }

  return processed;
}

function balanceSignals(signals: PulseSignal[]): PulseSignal[] {
  const positive = signals.filter(s => s.positive);
  const negative = signals.filter(s => !s.positive);

  // If all negative, at least try to find something positive
  // (the positive signals should have been generated in Layer 1/2 already)
  // Order: positive first, then negative
  return [...positive, ...negative];
}

function applyTemporalContext(
  signals: PulseSignal[],
  metrics: PulseMetrics,
): PulseSignal[] {
  // Protect creative flow — suppress task-related nudges
  if (metrics.creativeFlowActive) {
    return signals.filter(s =>
      s.type !== 'goal-idle' &&
      s.type !== 'stale-tasks' &&
      s.type !== 'priority-misalign',
    );
  }
  return signals;
}

// Reset habituation counter when behavior actually changes
function detectBehaviorChange(state: PulseState, action: string | null): void {
  const hash = action ? action.slice(0, 100) : '';
  if (hash !== state.lastBehaviorHash) {
    // Behavior changed — reset relevant signal counters
    for (const entry of Object.values(state.signalHistory)) {
      entry.lastActionChange = 0;
      entry.crystallizationEscalated = false;  // allow re-escalation if pattern recurs
    }
    state.lastBehaviorHash = hash;
  }
}

export function processSignals(
  signals: PulseSignal[],
  metrics: PulseMetrics,
  state: PulseState,
  action: string | null,
): PulseSignal[] {
  detectBehaviorChange(state, action);
  let processed = applyHabituation(signals, state);
  processed = applyTemporalContext(processed, metrics);
  processed = balanceSignals(processed);
  return processed;
}

// =============================================================================
// Layer 1 → Signal Generation (from metrics)
// =============================================================================

export function metricsToSignals(metrics: PulseMetrics): PulseSignal[] {
  const signals: PulseSignal[] = [];

  // ── Positive signals ──
  if (metrics.momentumStreak >= 3) {
    signals.push({
      type: 'momentum',
      severity: 'low',
      positive: true,
      detail: `streak ×${metrics.momentumStreak}`,
    });
  }

  if (metrics.creativeFlowActive) {
    signals.push({
      type: 'creative-flow',
      severity: 'low',
      positive: true,
      detail: 'creative session active',
    });
  }

  if (metrics.velocityVector?.trend === 'accelerating') {
    signals.push({
      type: 'goal-accelerating',
      severity: 'low',
      positive: true,
      detail: `${metrics.velocityVector.goal}: ${metrics.velocityVector.recent24h} actions in 24h`,
    });
  }

  // ── Negative signals ──
  if (metrics.outputGateTriggered) {
    signals.push({
      type: 'output-gate',
      severity: 'high',
      positive: false,
      detail: `${metrics.consecutiveNonOutputCycles} cycles without visible output`,
    });
  }

  if (metrics.analyzeWithoutActionStreak >= 3) {
    signals.push({
      type: 'analyze-no-action',
      severity: metrics.analyzeWithoutActionStreak >= 5 ? 'high' : 'medium',
      positive: false,
      detail: `${metrics.analyzeWithoutActionStreak} consecutive analyze/remember without action — execute or delegate now`,
    });
  }

  if (metrics.learnVsActionRatio > 0.7 && metrics.visibleOutputRate < 0.3) {
    signals.push({
      type: 'learning-streak',
      severity: 'medium',
      positive: false,
      detail: `learn ratio ${Math.round(metrics.learnVsActionRatio * 100)}%, output rate ${Math.round(metrics.visibleOutputRate * 100)}%`,
    });
  }

  if (metrics.goalIdleHours !== null && metrics.goalIdleHours > 12) {
    signals.push({
      type: 'goal-idle',
      severity: metrics.goalIdleHours > 24 ? 'high' : 'medium',
      positive: false,
      detail: `${Math.round(metrics.goalIdleHours)}h idle`,
    });
  }

  if (metrics.velocityVector?.trend === 'stalled') {
    signals.push({
      type: 'goal-stalled',
      severity: 'high',
      positive: false,
      detail: `${metrics.velocityVector.goal}: 0 actions in 48h`,
    });
  }

  if (metrics.priorityAlignmentScore < 0.3) {
    signals.push({
      type: 'priority-misalign',
      severity: 'high',
      positive: false,
      detail: `alignment ${Math.round(metrics.priorityAlignmentScore * 100)}%`,
    });
  }

  if (metrics.staleTasks > 0) {
    signals.push({
      type: 'stale-tasks',
      severity: metrics.staleTasks > 3 ? 'high' : 'medium',
      positive: false,
      detail: `${metrics.staleTasks} tasks stale >3 days`,
    });
  }

  if (metrics.unreviewedDelegations > 0) {
    signals.push({
      type: 'unreviewed-delegations',
      severity: 'medium',
      positive: false,
      detail: `${metrics.unreviewedDelegations} completed but unreviewed`,
    });
  }

  if (metrics.recurringErrorCount > 0) {
    signals.push({
      type: 'recurring-errors',
      severity: 'high',
      positive: false,
      detail: `${metrics.recurringErrorCount} error patterns (≥${ERROR_PATTERN_THRESHOLD}× each)`,
    });
  }

  if (metrics.decisionQualityAvg < 1.5 && metrics.decisionQualityWindow >= 10) {
    signals.push({
      type: 'decision-quality-low',
      severity: 'medium',
      positive: false,
      detail: `avg ${metrics.decisionQualityAvg.toFixed(1)}/3 over ${metrics.decisionQualityWindow} cycles`,
    });
  }

  return signals;
}

// =============================================================================
// Layer 4: Context Injection
// =============================================================================

function formatSignal(signal: PulseSignal): string {
  const icon = signal.positive ? '🟢' : signal.severity === 'high' ? '🔴' : '🟡';

  // Question format (habituation rotation)
  if (signal.detail?.startsWith('question:')) {
    const topic = signal.detail.slice('question:'.length);
    switch (signal.type) {
      case 'output-gate': return `${icon} 今天能 ship 什麼？`;
      case 'learning-streak': return `${icon} 學了這麼多，能產出什麼？`;
      case 'goal-idle': return `${icon} ${topic} — 是在蓄力還是在逃避？`;
      case 'priority-misalign': return `${icon} P0 是什麼？最近的行動對齊嗎？`;
      default: return `${icon} ${signal.type}: ${topic}`;
    }
  }

  // Statement format (default)
  switch (signal.type) {
    case 'momentum': return `${icon} momentum ×${signal.detail?.match(/\d+/)?.[0] ?? '?'}`;
    case 'creative-flow': return `${icon} creative flow — 保護中`;
    case 'goal-accelerating': return `${icon} ${signal.detail}`;
    case 'output-gate': return `${icon} ${signal.detail} — 需要 visible output`;
    case 'learning-streak': return `${icon} ${signal.detail}`;
    case 'goal-idle': return `${icon} goal idle ${signal.detail}`;
    case 'goal-stalled': return `${icon} ${signal.detail}`;
    case 'priority-misalign': return `${icon} priority misalignment: ${signal.detail}`;
    case 'stale-tasks': return `${icon} ${signal.detail}`;
    case 'unreviewed-delegations': return `${icon} delegations: ${signal.detail}`;
    case 'recurring-errors': return `${icon} ${signal.detail}`;
    case 'decision-quality-low': return `${icon} decision quality: ${signal.detail}`;
    default: return `${icon} ${signal.type}: ${signal.detail ?? ''}`;
  }
}

export function buildPulseSection(signals: PulseSignal[]): string | null {
  if (signals.length === 0) return null;

  const lines = signals.map(formatSignal);
  return lines.join('\n');
}

// =============================================================================
// Crystallization Bridge: Pulse → HEARTBEAT (persistent signals become tasks)
// =============================================================================

const CRYSTALLIZATION_THRESHOLD = HABITUATION_THRESHOLD * 2;  // 10 cycles without behavior change

/**
 * When a pulse signal persists for CRYSTALLIZATION_THRESHOLD cycles without
 * behavior change, escalate from text signal to HEARTBEAT task with
 * crystallization framing.
 *
 * This is the bridge between "detecting a pattern" and "acting on it."
 * Signals are hopes (depend on context window attention).
 * Tasks are commitments (tracked until resolved).
 *
 * 2026-03-17: Born from the closed-loop experience — the realization that
 * "signal → hope LLM notices" has the same failure mode as "memory → hope
 * LLM remembers." Both depend on attention. Code doesn't.
 */
function escalateToCrystallization(signal: PulseSignal, history: SignalHistoryEntry): void {
  try {
    const memory = getMemory();
    const taskText =
      `P1: 結晶候選 — ${signal.type}（${history.consecutiveAppearances} cycles 無行為改變）\n` +
      `Pattern: ${signal.detail ?? signal.type}\n` +
      `機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory）`;
    memory.addTask(taskText).catch(() => {});
    slog('PULSE', `Crystallization escalation: ${signal.type} (${history.consecutiveAppearances}× no change) → HEARTBEAT task`);
  } catch { /* best effort */ }
}

// =============================================================================
// Entry Point
// =============================================================================

/**
 * Run pulse check. Every cycle, fire-and-forget.
 * Returns the pulse section text (or null if nothing to report).
 */
export async function runPulseCheck(
  action: string | null,
  cycleCount: number,
): Promise<void> {
  const state = readPulseState();

  // Layer 1: Compute metrics
  const metrics = await computePulseMetrics(action, state);

  // Layer 1 → Signals
  let signals = metricsToSignals(metrics);

  // Layer 2 (9B classification) removed — oMLX pulse-reflex retired.
  // Reason: 0.3% citation rate, auto-demoted after 50 zero-citation cycles.
  // Layer 1 heuristics alone are sufficient.

  // Layer 3: Process signals
  const processed = processSignals(signals, metrics, state, action);

  // Layer 4: Build context section and write to file
  const section = buildPulseSection(processed);
  const pulsePath = getStatePath('pulse-context.txt');
  if (section) {
    writeFileSync(pulsePath, section, 'utf-8');
  } else if (existsSync(pulsePath)) {
    // Clean up stale file
    try { unlinkSync(pulsePath); } catch { /* ok */ }
  }

  // Crystallization bridge: persistent signals → HEARTBEAT tasks
  // When a signal survives 2× habituation threshold without behavior change,
  // it's not a temporary blip — it's a structural pattern that needs code, not willpower.
  for (const signal of processed) {
    const history = state.signalHistory[signal.type];
    if (history &&
        history.consecutiveAppearances >= CRYSTALLIZATION_THRESHOLD &&
        history.lastActionChange >= CRYSTALLIZATION_THRESHOLD &&
        !history.crystallizationEscalated) {
      escalateToCrystallization(signal, history);
      history.crystallizationEscalated = true;
    }
  }

  // Update state
  state.cycleCount = cycleCount;
  state.lastRunAt = new Date().toISOString();
  writePulseState(state);

  if (processed.length > 0) {
    slog('PULSE', `${processed.length} signals (${processed.filter(s => s.positive).length} positive, ${processed.filter(s => !s.positive).length} negative)`);
  }
}

/**
 * Build <pulse> context section for injection into perception context.
 * Called by memory.ts buildContext().
 */
export function buildPulseContext(): string | null {
  try {
    const pulsePath = getStatePath('pulse-context.txt');
    if (!existsSync(pulsePath)) return null;
    const content = readFileSync(pulsePath, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}
