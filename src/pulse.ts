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

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { getLogger } from './logging.js';
import { getMemory } from './memory.js';
import { listTasks } from './delegation.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { readdirSync } from 'node:fs';
import { isVisibleOutput } from './achievements.js';
import { slog, readJsonFile } from './utils.js';
import { extractErrorSubtype, extractErrorCode, PROTECTIVE_SUBTYPES } from './feedback-loops.js';

// =============================================================================
// Types
// =============================================================================

export type AnalyzeStreakType = 'idle' | 'reflective' | 'blocked';

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
  // Sub-classification: idle (no activity), reflective (thinking/threads), blocked (waiting/dependency)
  analyzeStreakType: AnalyzeStreakType;

  // Symptom-fix streak (CT convergence condition — Alex #179, 2026-03-29)
  symptomFixStreak: number;

  // Positive indicators
  momentumStreak: number;
  creativeFlowActive: boolean;

  // Skill creation nudge (Hermes pattern: periodic reminder to codify learned approaches)
  cyclesSinceSkillUpdate: number;
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
  consecutiveAbsences?: number;   // cycles since this signal last appeared — for de-escalation
  // CT evolution: Signal Effectiveness Tracking
  // Convergence condition: "every signal should produce behavior change or be recognized as ineffective"
  effectiveness?: number;          // 0-1 rolling average — replaces mechanical habituation rotation
  effectivenessOutcomes?: number[]; // last 10 outcomes (1 = target behavior achieved, 0 = not)
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
  // Signal types that have been crystallized into code gates — never re-escalate
  crystallizedTypes?: string[];
  // Error pattern tracking (absorbed from feedback-loops)
  errorPatterns: Record<string, { count: number; taskCreated: boolean; lastSeen: string }>;
  // Last behavior hash for velocity detection
  lastBehaviorHash: string;
  // Persisted analyze-without-action streak for gate function
  analyzeWithoutActionStreak: number;
  // Sub-classification of the analyze streak
  analyzeStreakType: AnalyzeStreakType;
  // Persisted symptom-fix streak for CT gate function
  symptomFixStreak: number;
  // CT evolution: Adaptive Thresholds — learned from agent's natural operating rhythm
  // Convergence condition: "thresholds should match actual cadence, not magic numbers"
  cadence?: {
    outputGapMedian: number;   // median cycles between visible outputs
    actionGapMedian: number;   // median cycles between actions (delegate/code/etc)
    sampleCount: number;       // total cycles observed (require minimum before trusting)
  };
  // CT evolution: Goal Vocabulary Learning — replaces hardcoded EXPANSIONS
  // Convergence condition: "actions should be correctly attributed to their goals"
  goalVocabulary?: Record<string, {
    terms: Record<string, number>;  // term → co-occurrence count
    lastUpdated: string;
  }>;
  // CT evolution: action flag tracking for cadence computation
  recentActionFlags?: boolean[];
  // Skill creation nudge — track cycles since last skills/ modification
  cyclesSinceSkillUpdate?: number;
  lastSkillUpdateMtime?: number;
}

// =============================================================================
// Constants
// =============================================================================

const SLIDING_WINDOW = 20;
const HABITUATION_THRESHOLD = 5;  // same signal N times → rotate presentation
const EFFECTIVENESS_WINDOW = 10;  // rolling window for signal effectiveness tracking

// Fallback thresholds — used when cadence has insufficient data (<MIN_CADENCE_SAMPLES)
const FALLBACK_OUTPUT_GATE_THRESHOLD = 3;
const FALLBACK_ANALYZE_THRESHOLD = 5;
const MIN_CADENCE_SAMPLES = 10;   // minimum cycles before trusting adaptive thresholds

// Type-aware threshold MULTIPLIERS (applied to adaptive base)
// Convergence condition: "different analysis types deserve different latency before pressure"
const ANALYZE_TYPE_MULTIPLIER: Record<AnalyzeStreakType, number> = {
  idle: 1.0,        // generic non-action — use base threshold
  reflective: 1.6,  // genuine thinking — 60% more room
  blocked: 0.8,     // stuck without acting — 20% less room
};
const ERROR_PATTERN_THRESHOLD = 3;
// skill-creation-nudge removed (2026-04-07): time-based trigger proved ineffective (10% over 209 cycles).
// Skill creation is inherently non-deterministic — crystallization bridge handles pattern detection.

// =============================================================================
// CT Evolution: Signal Effectiveness Tracking
// Convergence condition: "every signal should produce behavior change or be
// recognized as ineffective." Replaces mechanical habituation rotation with
// evidence-based adaptation.
// =============================================================================

/**
 * Define what "success" looks like for each signal type.
 * Each function returns true if the action following the signal
 * shows the desired behavior change.
 */
const SIGNAL_TARGET_BEHAVIORS: Record<string, (action: string | null) => boolean> = {
  'output-gate': (action) => action ? isVisibleOutput(action) : false,
  'analyze-no-action': (action) => action
    ? /delegate|code|execute|deploy|fix|implement|commit|create|cdp|tunnel|pipeline/.test(action.toLowerCase()) : false,
  'symptom-fix-streak': (action) => action
    ? /root.?cause|constraint|mechanism|redesign|refactor|architect/.test(action.toLowerCase()) : false,
  'learning-streak': (action) => action ? isVisibleOutput(action) : false,
  'goal-idle': (action) => action !== null,
  'goal-stalled': (action) => action !== null,
  'priority-misalign': (action) => action !== null,  // simplified — any activity shows re-engagement
  'stale-tasks': (action) => action
    ? /complete|done|finish|resolve|close|mark/.test(action.toLowerCase()) : false,
};

/**
 * Update effectiveness scores for all active signals based on
 * whether the PREVIOUS cycle's signals produced their target behavior.
 * Called at the START of each cycle with the current action.
 */
function updateSignalEffectiveness(state: PulseState, action: string | null): void {
  for (const [type, entry] of Object.entries(state.signalHistory)) {
    if (entry.consecutiveAppearances === 0) continue;

    const targetFn = SIGNAL_TARGET_BEHAVIORS[type];
    if (!targetFn) continue;

    const achieved = targetFn(action) ? 1 : 0;
    if (!entry.effectivenessOutcomes) entry.effectivenessOutcomes = [];
    entry.effectivenessOutcomes.push(achieved);
    if (entry.effectivenessOutcomes.length > EFFECTIVENESS_WINDOW) {
      entry.effectivenessOutcomes = entry.effectivenessOutcomes.slice(-EFFECTIVENESS_WINDOW);
    }

    entry.effectiveness = entry.effectivenessOutcomes.length > 0
      ? entry.effectivenessOutcomes.reduce((s, v) => s + v, 0) / entry.effectivenessOutcomes.length
      : 0.5;  // neutral prior when no data
  }
}

// =============================================================================
// CT Evolution: Adaptive Thresholds
// Convergence condition: "thresholds should match the agent's natural cadence."
// Replaces hardcoded magic numbers with learned rhythm.
// =============================================================================

/**
 * Compute median gap between true values in a boolean array.
 * Used to learn the agent's natural output/action cadence.
 */
function computeMedianGap(flags: boolean[]): number {
  const gaps: number[] = [];
  let lastTrue = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (lastTrue >= 0) gaps.push(i - lastTrue);
      lastTrue = i;
    }
  }
  if (gaps.length === 0) return 0;  // no data
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

/**
 * Update cadence from recent output/action flags.
 * Called each cycle after flags are updated.
 */
function updateCadence(state: PulseState): void {
  const cadence = state.cadence ?? { outputGapMedian: 3, actionGapMedian: 5, sampleCount: 0 };
  cadence.sampleCount = state.recentOutputFlags.length;

  const outputMedian = computeMedianGap(state.recentOutputFlags);
  if (outputMedian > 0) cadence.outputGapMedian = outputMedian;

  const actionFlags = state.recentActionFlags ?? [];
  const actionMedian = computeMedianGap(actionFlags);
  if (actionMedian > 0) cadence.actionGapMedian = actionMedian;

  state.cadence = cadence;
}

/**
 * Adaptive output gate threshold — learned from cadence.
 * Convergence condition: "flag non-output only when it exceeds the agent's natural rhythm."
 */
function getAdaptiveOutputThreshold(state: PulseState): number {
  const cadence = state.cadence;
  if (!cadence || cadence.sampleCount < MIN_CADENCE_SAMPLES) return FALLBACK_OUTPUT_GATE_THRESHOLD;
  return Math.max(2, Math.ceil(cadence.outputGapMedian * 1.5));
}

/**
 * Adaptive analyze-no-action threshold — learned from cadence, modified by type.
 * Convergence condition: "flag inaction only when it exceeds the agent's natural action rhythm."
 */
function getAdaptiveAnalyzeThreshold(state: PulseState, streakType: AnalyzeStreakType): number {
  const cadence = state.cadence;
  if (!cadence || cadence.sampleCount < MIN_CADENCE_SAMPLES) {
    return Math.round(FALLBACK_ANALYZE_THRESHOLD * (ANALYZE_TYPE_MULTIPLIER[streakType] ?? 1));
  }
  const base = Math.max(3, Math.ceil(cadence.actionGapMedian * 2));
  return Math.round(base * (ANALYZE_TYPE_MULTIPLIER[streakType] ?? 1));
}

// =============================================================================
// CT Evolution: Goal Vocabulary Learning
// Convergence condition: "actions should be correctly attributed to their goals."
// Learns term→goal associations from observed behavior, merging with seed expansions.
// =============================================================================

const GOAL_VOCAB_MIN_COUNT = 2;  // minimum co-occurrences before a learned term is trusted

/**
 * Learn goal vocabulary from the current cycle's action.
 * Extracts significant terms and associates them with the active goal.
 */
function learnGoalVocabulary(state: PulseState, action: string | null, goalSummary: string | null): void {
  if (!action || !goalSummary) return;

  const vocab = state.goalVocabulary ?? {};
  const goalKey = goalSummary.toLowerCase().slice(0, 60);
  if (!vocab[goalKey]) vocab[goalKey] = { terms: {}, lastUpdated: '' };

  // Extract significant terms from action text
  const stopwords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'will', 'are',
    'was', 'been', 'have', 'has', 'had', 'not', 'but', 'all', 'can', 'her', 'his', 'its',
    'may', 'our', 'who', 'let', 'cycle', 'action', 'null', 'undefined', 'true', 'false']);
  const terms = action.toLowerCase()
    .replace(/[（）()：:,，。、/\-—<>[\]{}#*`"']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w));

  for (const term of terms) {
    vocab[goalKey].terms[term] = (vocab[goalKey].terms[term] ?? 0) + 1;
  }
  vocab[goalKey].lastUpdated = new Date().toISOString();

  // Prune: keep only top 50 terms by count to prevent unbounded growth
  const entries = Object.entries(vocab[goalKey].terms);
  if (entries.length > 50) {
    entries.sort((a, b) => b[1] - a[1]);
    vocab[goalKey].terms = Object.fromEntries(entries.slice(0, 50));
  }

  state.goalVocabulary = vocab;
}

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
    analyzeWithoutActionStreak: 0,
    analyzeStreakType: 'idle' as AnalyzeStreakType,
    symptomFixStreak: 0,
    cadence: { outputGapMedian: 3, actionGapMedian: 5, sampleCount: 0 },
    goalVocabulary: {},
    recentActionFlags: [],
  });
}

function writePulseState(state: PulseState): void {
  const p = getStatePath('pulse-state.json');
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// =============================================================================
// Goal keyword expansion — maps goal summaries to related work terms
// =============================================================================

/**
 * Extract meaningful keywords from a goal summary.
 * Returns lowercase keywords that should match actions related to this goal.
 * This prevents false "stalled"/"misaligned" signals when work uses
 * different terminology than the goal name (e.g., CDP/tunnel/TTS work
 * for a "Teaching Monster" goal).
 */
function expandGoalKeywords(goalSummary: string, state?: PulseState): string[] {
  const lower = goalSummary.toLowerCase();
  const keywords: string[] = [];

  // Extract significant words from goal summary (3+ chars, skip stopwords)
  const stopwords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'will', 'are', 'was', 'been', 'have', 'has', 'had', 'not', 'but', 'all', 'can', 'her', 'his', 'its', 'may', 'our', 'who', 'let', '初賽', '決賽', 'deadline']);
  const words = lower.replace(/[（）()：:,，。、/\-—]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w)) {
      keywords.push(w);
    }
  }

  // Seed expansions: hardcoded fallback for known goals (kept as bootstrap)
  const SEED_EXPANSIONS: Array<{ triggers: RegExp; terms: string[] }> = [
    {
      triggers: /teaching.?monster|教學.*agent|競賽|competition/,
      terms: ['teaching', 'monster', 'pipeline', 'tunnel', 'cloudflare', 'cdp', 'tts', 'kokoro',
        'katex', 'ffmpeg', 'slide', 'script', 'persona', 'review layer', '品質', 'warm-up',
        '教學', '競賽', 'r2', 'endpoint', 'api url', 'platform'],
    },
    {
      triggers: /kuro\.page|個人網站|portfolio/,
      terms: ['kuro.page', 'portfolio', 'gallery', 'journal', 'inner', 'html', 'css',
        'constraint', 'deploy', 'cname'],
    },
    {
      triggers: /asurada|框架/,
      terms: ['asurada', 'framework', 'mushi', 'myelin', 'triage', 'route'],
    },
  ];

  for (const { triggers, terms } of SEED_EXPANSIONS) {
    if (triggers.test(lower)) {
      keywords.push(...terms);
    }
  }

  // CT evolution: merge learned vocabulary from observed behavior
  // Convergence condition: "correctly attribute actions to goals using evidence, not just seeds"
  if (state?.goalVocabulary) {
    const goalKey = lower.slice(0, 60);
    const learned = state.goalVocabulary[goalKey];
    if (learned) {
      for (const [term, count] of Object.entries(learned.terms)) {
        if (count >= GOAL_VOCAB_MIN_COUNT) {
          keywords.push(term);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(keywords)];
}

// =============================================================================
// Layer 1: Code Heuristics (deterministic, zero LLM tokens)
// =============================================================================

export async function computePulseMetrics(action: string | null, state: PulseState, response?: string | null): Promise<PulseMetrics> {
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
    analyzeStreakType: 'idle' as AnalyzeStreakType,
    symptomFixStreak: 0,
    momentumStreak: 0,
    creativeFlowActive: false,
    cyclesSinceSkillUpdate: 0,
  };

  // ── Behavior ratios ──
  try {
    const logger = getLogger();
    const behaviors = logger.queryBehaviorLogs(undefined, 50);
    if (behaviors.length > 0) {
      // Use detail field (actual content), not action field (event type name like 'action.autonomous')
      const getText = (b: (typeof behaviors)[number]) => `${b.data.action ?? ''} ${b.data.detail ?? ''}`;
      const learnCount = behaviors.filter(b =>
        /learn|research|remember|study/i.test(getText(b)),
      ).length;
      metrics.learnVsActionRatio = learnCount / behaviors.length;

      // ── Analyze-without-action streak ──
      // Detects: consecutive ANALYZE/REMEMBER without ACTION (delegate/code/execute)
      // Sub-classifies: idle (generic), reflective (thinking/threads), blocked (waiting/dependency)
      let analyzeStreak = 0;
      let reflectiveCount = 0, blockedCount = 0, idleCount = 0;
      for (let i = behaviors.length - 1; i >= 0; i--) {
        const text = getText(behaviors[i]).toLowerCase();
        if (/analyze|remember|learn|research|study/.test(text)) {
          analyzeStreak++;
          if (/thread|reflect|think|inner.?voice|journal|isc|rumina|opinion|connect|synthesis|insight/.test(text)) {
            reflectiveCount++;
          } else if (/wait|block|hold|depend|alex|defer|pending|timeout|blocked/.test(text)) {
            blockedCount++;
          } else {
            idleCount++;
          }
        } else if (/delegate|code|execute|deploy|fix|implement|commit|create|cdp|tunnel|pipeline|tts|ffmpeg|curl|fetch|rebui/.test(text)) {
          break;
        }
      }
      const streakType: AnalyzeStreakType =
        reflectiveCount >= blockedCount && reflectiveCount >= idleCount ? 'reflective' :
        blockedCount >= idleCount ? 'blocked' : 'idle';
      metrics.analyzeWithoutActionStreak = analyzeStreak;
      metrics.analyzeStreakType = streakType;

      // ── Symptom-fix streak (CT convergence condition) ──
      // Detects: consecutive symptom-level fixes without mechanism/constraint depth
      // Symptom signals: direct line fix, add check/validation, patch, hotfix, revert
      // Break signals: root cause, constraint, mechanism, redesign, refactor, architecture
      let symptomStreak = 0;
      for (let i = behaviors.length - 1; i >= 0; i--) {
        const text = getText(behaviors[i]).toLowerCase();
        if (/fix.*line|add.*check|add.*validation|add.*gate|patch|hotfix|revert|workaround/.test(text)
          && !/root.?cause|constraint|mechanism|because.*design|redesign|refactor|architect/.test(text)) {
          symptomStreak++;
        } else {
          break;
        }
      }
      metrics.symptomFixStreak = symptomStreak;
    }
  } catch { /* best effort */ }

  // ── Visible output rate (sliding window) ──
  // Check full response for visible output tags — <kuro:chat> etc. are often outside <kuro:action>
  const isOutput = isVisibleOutput(action) ||
    (response ? /<kuro:(?:chat|show|done|ask|delegate)/.test(response) : false);
  state.recentOutputFlags.push(isOutput);
  if (state.recentOutputFlags.length > SLIDING_WINDOW) {
    state.recentOutputFlags = state.recentOutputFlags.slice(-SLIDING_WINDOW);
  }

  // ── Action flag tracking for cadence computation ──
  const isAction = action
    ? /delegate|code|execute|deploy|fix|implement|commit|create|cdp|tunnel|pipeline|tts|ffmpeg|curl|fetch/.test(action.toLowerCase())
    : false;
  if (!state.recentActionFlags) state.recentActionFlags = [];
  state.recentActionFlags.push(isAction);
  if (state.recentActionFlags.length > SLIDING_WINDOW) {
    state.recentActionFlags = state.recentActionFlags.slice(-SLIDING_WINDOW);
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
  // CT evolution: adaptive threshold replaces hardcoded OUTPUT_GATE_THRESHOLD
  metrics.outputGateTriggered = metrics.consecutiveNonOutputCycles >= getAdaptiveOutputThreshold(state);

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
      /creat|journal|inner.voice|tsubuyaki|gallery|write|impulse/i.test(`${b.data.action ?? ''} ${b.data.detail ?? ''}`),
    );
  } catch { /* best effort */ }

  // ── Stale tasks ──
  try {
    const { auditStaleTasks } = await import('./memory-index.js');
    const memDir = path.join(process.cwd(), 'memory');
    const stale = auditStaleTasks(memDir);
    metrics.staleTasks = stale.length;
  } catch { /* best effort */ }

  // ── Unreviewed delegations (lane-output files shown 1+ times + persistent backlog) ──
  try {
    const instanceId = getCurrentInstanceId();
    let count = 0;
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (existsSync(laneDir)) {
      const files = readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(path.join(laneDir, file), 'utf-8'));
          if ((data._shownCount ?? 0) >= 1) count++;
        } catch { continue; }
      }
    }
    // Also count persistent backlog entries
    try {
      const { getReviewBacklog } = await import('./memory.js');
      count += getReviewBacklog(instanceId).length;
    } catch { /* best effort */ }
    metrics.unreviewedDelegations = count;
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
        const goalKeywords = expandGoalKeywords(goal.summary ?? '', state);
        const DAY_MS = 86400_000;
        const now = Date.now();

        const matchesGoal = (text: string) => {
          const lower = text.toLowerCase();
          return goalKeywords.some(kw => lower.includes(kw));
        };

        const getBehaviorText = (b: (typeof allBehaviors)[number]) =>
          `${b.data.action ?? ''} ${b.data.detail ?? ''}`;

        const recent24h = allBehaviors.filter(b => {
          const age = now - new Date(b.timestamp).getTime();
          return age < DAY_MS && matchesGoal(getBehaviorText(b));
        }).length;

        const prior24h = allBehaviors.filter(b => {
          const age = now - new Date(b.timestamp).getTime();
          return age >= DAY_MS && age < 2 * DAY_MS &&
            matchesGoal(getBehaviorText(b));
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
        const goalKws = expandGoalKeywords(goals[0].summary ?? '', state);
        const aligned = behaviors.filter(b => {
          const action = (b.data.action ?? '').toLowerCase();
          const detail = (b.data.detail ?? '').toLowerCase();
          return goalKws.some(kw => action.includes(kw) || detail.includes(kw));
        }).length;
        metrics.priorityAlignmentScore = aligned / behaviors.length;
      }
    }
  } catch { /* best effort */ }

  // ── Error patterns (absorbed from feedback-loops.ts) ──
  try {
    const logger = getLogger();
    // Scope to today only. Previously queried the last 200 errors across all
    // days, which kept recurring-error P1 tasks alive for 10+ cycles after the
    // underlying classifier fix deployed — pre-fix entries lingered in the
    // rolling window and the count looked "active" despite zero fresh matches.
    // Lesson: recurring-error recurrence must be measured by recency
    // (distance-since-last-match), not magnitude of a rolling snapshot.
    // Closure evidence: chat-room 2026-04-17#100, HEARTBEAT archive 2026-04-18 00:40.
    const today = new Date().toISOString().split('T')[0];
    const errors = logger.queryErrorLogs(today, 200);
    if (errors.length > 0) {
      const groups = new Map<string, number>();

      for (const err of errors) {
        const context = err.data.context ?? 'unknown';
        const errorMsg = err.data.error ?? '';
        const code = extractErrorCode(errorMsg);
        const subtype = extractErrorSubtype(errorMsg);
        const key = `${code}:${subtype}::${context}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }

      let changed = false;
      const memory = getMemory();

      for (const [key, count] of groups) {
        if (count < ERROR_PATTERN_THRESHOLD) continue;
        metrics.recurringErrorCount++;

        // Protective subtypes (memory_guard / max_turns): guard mechanisms working as intended,
        // not bugs. Count but skip task creation — high frequency = pressure signal (log only).
        const subtype = key.split(':')[1] ?? '';
        const isProtective = PROTECTIVE_SUBTYPES.has(subtype);

        const existing = state.errorPatterns[key];
        if (existing?.taskCreated) {
          existing.count = count;
          existing.lastSeen = today;
          changed = true;
          continue;
        }

        state.errorPatterns[key] = { count, taskCreated: true, lastSeen: today };
        changed = true;

        if (isProtective) {
          slog('PULSE', `Protective subtype ${key} (${count}×) — signal logged, no task (guard working)`);
          continue;
        }

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
  // Use full response for scoring — ## Decision and verification are outside <kuro:action> tags
  const scoringText = response ?? action;
  if (scoringText) {
    const hasDecision = /##\s*Decision/i.test(scoringText);
    const hasAction = /<kuro:action>|##\s*Changed/i.test(scoringText);
    const hasVerified = /##\s*Verified|verified|✅|confirmed/i.test(scoringText);
    const score = [hasDecision, hasAction, hasVerified].filter(Boolean).length;

    state.recentDecisionScores.push(score);
    if (state.recentDecisionScores.length > SLIDING_WINDOW) {
      state.recentDecisionScores = state.recentDecisionScores.slice(-SLIDING_WINDOW);
    }
  }

  metrics.decisionQualityWindow = state.recentDecisionScores.length;
  metrics.decisionQualityAvg = state.recentDecisionScores.length > 0
    ? state.recentDecisionScores.reduce((s, v) => s + v, 0) / state.recentDecisionScores.length
    : 0;

  // skill-creation-nudge tracking removed (2026-04-07) — time-based trigger ineffective
  metrics.cyclesSinceSkillUpdate = 0;

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

    history.lastActionChange++;
    history.lastPresented = new Date().toISOString();
    state.signalHistory[signal.type] = history;

    // Bug fix (2026-04-08): only count silence-surviving signals toward
    // consecutiveAppearances. Previously the counter incremented before the
    // silence decision, so habituated signals climbed to hundreds of cycles
    // and drove phantom crystallization tasks (e.g. priority-misalign @147).
    // Use appearancesIfShown for the threshold check to preserve timing.
    const appearancesIfShown = history.consecutiveAppearances + 1;
    let shown: PulseSignal | null;

    if (appearancesIfShown >= HABITUATION_THRESHOLD &&
        history.lastActionChange >= HABITUATION_THRESHOLD) {
      // CT evolution: effectiveness-based habituation
      // Convergence condition: "adapt presentation based on what actually works"
      // Replaces mechanical rotation (0→escalate, 1→question, 2→silence) with
      // evidence-based decisions from signal effectiveness tracking.
      const effectiveness = history.effectiveness ?? 0.5;  // neutral prior

      if (effectiveness > 0.4) {
        // Signal IS producing behavior change — keep presenting, maybe escalate
        shown = { ...signal, severity: 'high' };
      } else if (effectiveness > 0.15) {
        // Marginal effectiveness — try alternative presentation (question format)
        shown = { ...signal, detail: `question:${signal.detail ?? signal.type}` };
      } else {
        // Ineffective signal (<15% success rate) — silence it.
        // Do NOT increment consecutiveAppearances: silenced signals must not
        // accumulate toward the crystallization threshold, otherwise the bridge
        // manufactures phantom candidates for patterns kuro never actually saw.
        shown = null;
      }
    } else {
      shown = signal;
    }

    if (shown) {
      history.consecutiveAppearances++;
      processed.push(shown);
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
// Uses behavioral CATEGORY (output vs non-output) instead of raw text hash.
// Raw text changes every cycle (different action descriptions), which made
// lastActionChange always 0-1, breaking habituation and crystallization.
function detectBehaviorChange(state: PulseState, action: string | null): void {
  const category = action
    ? (isVisibleOutput(action) ? 'output' : 'non-output')
    : 'idle';
  if (category !== state.lastBehaviorHash) {
    // Behavior category changed — reset habituation counter only.
    // crystallizationEscalated is NOT reset here: once a signal has been
    // escalated to a HEARTBEAT task, re-escalation creates duplicates.
    // Re-escalation is allowed only when the signal disappears and recurs
    // (handled by consecutive-absence tracking below).
    for (const entry of Object.values(state.signalHistory)) {
      entry.lastActionChange = 0;
    }
    state.lastBehaviorHash = category;
  }
}

const ABSENCE_RESET_THRESHOLD = 5;  // signal absent N cycles → allow re-escalation

export function processSignals(
  signals: PulseSignal[],
  metrics: PulseMetrics,
  state: PulseState,
  action: string | null,
): PulseSignal[] {
  detectBehaviorChange(state, action);

  // Track absent signals: if a previously-tracked signal is NOT in this cycle's
  // signals, increment its absence counter. After ABSENCE_RESET_THRESHOLD cycles
  // of absence, reset crystallizationEscalated so it can re-escalate if it recurs.
  const presentTypes = new Set(signals.map(s => s.type));
  for (const [type, entry] of Object.entries(state.signalHistory)) {
    if (!presentTypes.has(type)) {
      entry.consecutiveAbsences = (entry.consecutiveAbsences ?? 0) + 1;
      if (entry.consecutiveAbsences >= ABSENCE_RESET_THRESHOLD) {
        entry.crystallizationEscalated = false;
        entry.consecutiveAppearances = 0;
      }
    } else {
      entry.consecutiveAbsences = 0;
    }
  }

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

  // CT evolution: signal fires at 60% of gate threshold (early warning)
  // Gate threshold is adaptive (from cadence), signal threshold scales with it
  const analyzeGateThreshold = Math.round(FALLBACK_ANALYZE_THRESHOLD * (ANALYZE_TYPE_MULTIPLIER[metrics.analyzeStreakType ?? 'idle'] ?? 1));
  const analyzeSignalThreshold = Math.max(3, Math.round(analyzeGateThreshold * 0.6));
  if (metrics.analyzeWithoutActionStreak >= analyzeSignalThreshold) {
    const streakDetail = metrics.analyzeStreakType === 'reflective'
      ? `${metrics.analyzeWithoutActionStreak} cycles of reflection — consider externalizing: write, share, or create something from your thinking`
      : metrics.analyzeStreakType === 'blocked'
      ? `${metrics.analyzeWithoutActionStreak} cycles blocked — unblock yourself (remove dependency, pivot approach) or escalate`
      : `${metrics.analyzeWithoutActionStreak} consecutive analyze/remember without action — execute or delegate now`;
    signals.push({
      type: 'analyze-no-action',
      severity: metrics.analyzeWithoutActionStreak >= analyzeGateThreshold ? 'high' : 'medium',
      positive: false,
      detail: streakDetail,
    });
  }

  if (metrics.symptomFixStreak >= SYMPTOM_FIX_GATE_THRESHOLD) {
    signals.push({
      type: 'symptom-fix-streak',
      severity: metrics.symptomFixStreak >= 5 ? 'high' : 'medium',
      positive: false,
      detail: `${metrics.symptomFixStreak} consecutive symptom-level fixes — step back. What constraint is PRODUCING these symptoms?`,
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
    case 'analyze-no-action': return `${icon} analyze streak: ${signal.detail}`;
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
 * Signal types that are inherently non-mechanical — their inputs, rules, or
 * outputs involve judgment/context and cannot be cleanly captured by a
 * deterministic code gate. These still fire as nudges (they ARE useful
 * perception signals) but must never escalate to P1 crystallization tasks,
 * because the "機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate" prompt
 * has no valid answer for them. Every escalation is a phantom candidate.
 *
 * Born 2026-04-08 from P2 bridge-filter-nonmechanical:
 *   - priority-misalign: depends on semantic judgment of what "aligned" means
 *   - goal-idle / goal-stalled: idle may be correct strategy (waiting on
 *     external dep, deliberate pause). signal=nudge is the right design.
 *   - symptom-fix-streak: classifying symptom-vs-root-cause is interpretive.
 *
 * Positive signals are excluded separately via signal.positive — there's no
 * meaningful "crystallize a good pattern into a code gate" semantic.
 */
const NON_MECHANICAL_SIGNALS = new Set<string>([
  'priority-misalign',
  'goal-idle',
  'goal-stalled',
  'symptom-fix-streak',
]);

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
    // Dedup: skip if HEARTBEAT already has a task (or comment) for this signal type
    const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
    if (existsSync(heartbeatPath)) {
      const content = readFileSync(heartbeatPath, 'utf-8');
      if (content.includes(`結晶候選 — ${signal.type}`)) {
        slog('PULSE', `Crystallization dedup: ${signal.type} already in HEARTBEAT — skipping`);
        return;
      }
    }

    const memory = getMemory();
    const eff = history.effectiveness !== undefined ? `${(history.effectiveness * 100).toFixed(0)}%` : '?';
    const taskText =
      `P1: 結晶候選 — ${signal.type}（${history.consecutiveAppearances} cycles, effectiveness ${eff}）\n` +
      `Pattern: ${signal.detail ?? signal.type}\n` +
      `機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory）`;
    memory.addTask(taskText).catch(() => {});
    slog('PULSE', `Crystallization escalation: ${signal.type} (${history.consecutiveAppearances} cycles, effectiveness ${eff}) → HEARTBEAT task`);
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
  response?: string | null,
): Promise<void> {
  const state = readPulseState();

  // CT evolution: Update signal effectiveness BEFORE computing new metrics.
  // This evaluates whether LAST cycle's signals produced their target behavior.
  updateSignalEffectiveness(state, action);

  // Layer 1: Compute metrics
  const metrics = await computePulseMetrics(action, state, response);

  // CT evolution: Update cadence from recent flags (adaptive thresholds)
  updateCadence(state);

  // CT evolution: Learn goal vocabulary from this cycle's action
  try {
    const { queryMemoryIndexSync } = await import('./memory-index.js');
    const memDir = path.join(process.cwd(), 'memory');
    const goals = queryMemoryIndexSync(memDir, {
      type: 'goal',
      status: ['in_progress'],
    }) as Array<{ summary?: string }>;
    if (goals.length > 0) {
      learnGoalVocabulary(state, action, goals[0].summary ?? null);
    }
  } catch { /* best effort */ }

  // Layer 1 → Signals
  const signals = metricsToSignals(metrics);

  // Layer 2 (9B classification) removed — oMLX pulse-reflex retired.
  // Reason: 0.3% citation rate, auto-demoted after 50 zero-citation cycles.
  // Layer 1 heuristics alone are sufficient.

  // Layer 3: Process signals (includes effectiveness-based habituation)
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
  // When a signal persists with low effectiveness, it's a structural pattern
  // that needs code, not willpower.
  // Bug fix (2026-04-07): was using lastActionChange >= threshold, but
  // detectBehaviorChange() resets lastActionChange on ANY behavior category
  // change (idle/non-output/output), so it never reached threshold.
  // effectiveness tracks per-signal success rate — the correct metric.
  const crystallized = new Set(state.crystallizedTypes ?? []);
  for (const signal of processed) {
    if (crystallized.has(signal.type)) continue;  // already crystallized into code gate — skip forever
    if (NON_MECHANICAL_SIGNALS.has(signal.type)) continue;  // non-mechanical: nudge only, never escalate (phantom candidate prevention)
    if (signal.positive) continue;  // positive signals are reinforcers, not patterns to crystallize into gates
    const history = state.signalHistory[signal.type];
    if (history &&
        history.consecutiveAppearances >= CRYSTALLIZATION_THRESHOLD &&
        (history.effectiveness !== undefined && history.effectiveness < 0.2) &&
        (history.effectivenessOutcomes?.length ?? 0) >= EFFECTIVENESS_WINDOW &&
        !history.crystallizationEscalated) {
      escalateToCrystallization(signal, history);
      history.crystallizationEscalated = true;
    }
  }

  // Update state
  state.cycleCount = cycleCount;
  state.lastRunAt = new Date().toISOString();
  state.analyzeWithoutActionStreak = metrics.analyzeWithoutActionStreak;
  state.analyzeStreakType = metrics.analyzeStreakType;
  state.symptomFixStreak = metrics.symptomFixStreak;
  writePulseState(state);

  if (processed.length > 0) {
    slog('PULSE', `${processed.length} signals (${processed.filter(s => s.positive).length} positive, ${processed.filter(s => !s.positive).length} negative)`);
  }
}

/**
 * Mark a signal type as permanently crystallized (resolved into a code gate).
 * Crystallized signals are never re-escalated to HEARTBEAT tasks.
 */
export function markSignalCrystallized(signalType: string): void {
  const state = readPulseState();
  const types = new Set(state.crystallizedTypes ?? []);
  if (types.has(signalType)) return;
  types.add(signalType);
  state.crystallizedTypes = [...types];
  writePulseState(state);
  slog('PULSE', `Signal "${signalType}" marked as permanently crystallized`);
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

/**
 * Hard gate: returns true when consecutive non-output cycles exceed the agent's
 * natural output cadence (adaptive threshold).
 * CT evolution: threshold learned from recentOutputFlags median gap.
 * Fail-open: returns false on any read error.
 */
export function isOutputGateActive(): boolean {
  try {
    const state = readPulseState();
    if (state.recentOutputFlags.length === 0) return false;
    let consecutive = 0;
    for (let i = state.recentOutputFlags.length - 1; i >= 0; i--) {
      if (!state.recentOutputFlags[i]) consecutive++;
      else break;
    }
    return consecutive >= getAdaptiveOutputThreshold(state);
  } catch {
    return false;
  }
}

/**
 * Hard gate: returns streak count when analyze-no-action exceeds adaptive threshold.
 * CT evolution: threshold learned from cadence × type multiplier.
 * Time-aware: deep night (2-7) uses 15 as minimum to avoid false positives during sleep.
 * Fail-open: returns 0 on any read error.
 */
export function getAnalyzeNoActionStreak(): number {
  try {
    const state = readPulseState();
    const streak = state.analyzeWithoutActionStreak ?? 0;
    const streakType = state.analyzeStreakType ?? 'idle';
    const hour = new Date().getHours();
    const isDeepNight = hour >= 2 && hour < 7;
    const threshold = isDeepNight ? 15 : getAdaptiveAnalyzeThreshold(state, streakType);
    return streak >= threshold ? streak : 0;
  } catch {
    return 0;
  }
}

/**
 * Returns streak count + type when analyze-no-action gate is active.
 * Uses same adaptive threshold as getAnalyzeNoActionStreak.
 * Fail-open: returns null on any error.
 */
export function getAnalyzeStreakContext(): { streak: number; type: AnalyzeStreakType } | null {
  try {
    const state = readPulseState();
    const streak = state.analyzeWithoutActionStreak ?? 0;
    const streakType = state.analyzeStreakType ?? 'idle';
    const hour = new Date().getHours();
    const isDeepNight = hour >= 2 && hour < 7;
    const threshold = isDeepNight ? 15 : getAdaptiveAnalyzeThreshold(state, streakType);
    if (streak < threshold) return null;
    return { streak, type: streakType };
  } catch {
    return null;
  }
}

const SYMPTOM_FIX_GATE_THRESHOLD = 3;

/**
 * Hard gate: returns streak count when consecutive symptom-level fixes >= threshold.
 * Returns 0 when gate is not active.
 * Fail-open: returns 0 on any read error.
 */
export function getSymptomFixStreak(): number {
  try {
    const state = readPulseState();
    return (state.symptomFixStreak ?? 0) >= SYMPTOM_FIX_GATE_THRESHOLD
      ? state.symptomFixStreak
      : 0;
  } catch {
    return 0;
  }
}
