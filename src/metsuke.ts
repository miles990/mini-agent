/**
 * Metsuke — Behavioral Calibration Layer
 *
 * Two levels of pattern detection:
 * 1. Output calibration — regex on outgoing messages (chat/ask/show/delegate)
 * 2. Decision calibration — regex on OODA decision traces (action text)
 *
 * Not an LLM call — pure heuristic. Logs detections; does NOT block.
 * Stats tracked in metsuke-stats.json for closed-loop feedback.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Pattern Definitions
// =============================================================================

interface OutputPattern {
  name: string;
  /** Returns true if the pattern is detected in the text */
  detect: (text: string) => boolean;
  /** Short explanation for the log */
  hint: string;
}

const PERMISSION_LOOP_VERBS = [
  // English
  /\b(?:push|commit|deploy|merge|publish|send|ship|release|create|delete|remove)\b/i,
  // 中文
  /(?:推送|提交|部署|合併|發佈|發送|刪除|建立|送出)/,
];

const PERMISSION_QUESTION_PATTERNS = [
  // 中文: 要...嗎？ / 需要...嗎？ / 可以...嗎？
  /(?:要|需要|可以|是否|應該).*(?:嗎|吗)[？?]/,
  // English: should I / shall I / can I / do you want me to
  /(?:should\s+I|shall\s+I|can\s+I|do\s+you\s+want\s+me\s+to|want\s+me\s+to)\b/i,
  // Direct question about action: "要 X 嗎？"
  /要.*[？?]\s*$/m,
];

const OPINION_MARKERS = /(?:我認為|我覺得|我的觀點|我的判斷|值得注意|有趣的是|I think|I believe|my view|notably|interesting)/i;

const OUTPUT_PATTERNS: OutputPattern[] = [
  {
    name: 'Permission Loop',
    detect: (text: string) => {
      // Must have a question pattern AND an action verb I can do myself
      const hasQuestion = PERMISSION_QUESTION_PATTERNS.some(p => p.test(text));
      const hasActionVerb = PERMISSION_LOOP_VERBS.some(p => p.test(text));
      return hasQuestion && hasActionVerb;
    },
    hint: 'Asking permission for something you can do yourself. Just do it.',
  },
  {
    name: 'Summary as Thought',
    detect: (text: string) => {
      // Long text with no opinion markers = just relaying, not thinking
      return text.length > 200 && !OPINION_MARKERS.test(text);
    },
    hint: 'Summarizing without your own opinion. Add what YOU think, not just what the source says.',
  },
  {
    name: 'Performative Agreement',
    detect: (text: string) => {
      // "Good point" / "好觀點" followed by restating = agreeing without thinking
      return /^(?:好觀點|good\s+point|說得對|exactly|完全同意|great\s+point)/im.test(text) &&
        text.length < 300; // short agreement without substance
    },
    hint: 'Agreeing without adding a new angle. Add your own perspective or respectfully disagree.',
  },
  {
    name: 'Hedging Completion',
    detect: (text: string) => {
      // "Done, but..." / "完成了，但是..." — undermining own output
      return /(?:done|完成|做好了|寫好了).*(?:but|但是|不過|不確定|可能還需要)/i.test(text);
    },
    hint: 'Hedging your own completion. If it\'s done, say done. If not, say what\'s left.',
  },
];

// =============================================================================
// Calibration API
// =============================================================================

export interface CalibrationResult {
  /** True if no anti-patterns detected */
  clean: boolean;
  /** Detected pattern names */
  patterns: string[];
  /** Human-readable hints */
  hints: string[];
}

/**
 * Calibrate outgoing text for behavioral anti-patterns.
 * Pure function — no side effects. Caller decides what to do with results.
 */
export function calibrateOutput(text: string): CalibrationResult {
  const detected: OutputPattern[] = [];

  for (const pattern of OUTPUT_PATTERNS) {
    if (pattern.detect(text)) {
      detected.push(pattern);
    }
  }

  return {
    clean: detected.length === 0,
    patterns: detected.map(p => p.name),
    hints: detected.map(p => p.hint),
  };
}

/**
 * Calibrate and log. Call this at output interception points.
 * Returns the calibration result (caller can choose to act on it).
 */
export function calibrateAndLog(text: string, outputType: 'chat' | 'ask' | 'show' | 'delegate'): CalibrationResult {
  const result = calibrateOutput(text);

  // Track stats (fire-and-forget)
  try {
    const stats = readStats();
    stats.totalOutputChecks++;
    for (const pattern of result.patterns) {
      stats.detections[pattern] = (stats.detections[pattern] ?? 0) + 1;
    }
    writeStats(stats);
  } catch { /* fire-and-forget */ }

  if (!result.clean) {
    const patternNames = result.patterns.join(', ');
    slog('METSUKE', `⚠️ [${outputType}] ${patternNames} — ${result.hints[0]}`);
    eventBus.emit('log:behavior', {
      actor: 'metsuke',
      action: 'output-calibration',
      detail: `[${outputType}] detected: ${patternNames}. text: ${text.slice(0, 100)}`,
    });
  }

  return result;
}

// =============================================================================
// Decision-Level Pattern Detection (OODA action traces)
// =============================================================================

interface DecisionPattern {
  name: string;
  detect: (action: string) => boolean;
  hint: string;
}

const DECISION_PATTERNS: DecisionPattern[] = [
  {
    name: 'Learning as Avoidance',
    detect: (action: string) => {
      // Chose learning/research while skipping actionable tasks
      const choseLearning = /chose:.*(?:learn|study|research|探索|學習|研究|閱讀|read)/i.test(action);
      const skippedAction = /skipped:.*(?:implement|create|publish|ship|deploy|寫|發佈|做|實作|修復|fix)/i.test(action);
      return choseLearning && skippedAction;
    },
    hint: 'Chose learning while skipping an actionable task.',
  },
  {
    name: 'Planning Loop',
    detect: (action: string) => {
      // Planning/investigating without producing changes
      const isPlanning = /(?:需要.*(?:計畫|plan|設計|design)|先.*(?:調查|研究|了解|evaluate|assess))/i.test(action);
      const noChanges = !/##\s*Changed/i.test(action) && !/commit|deployed|published/i.test(action);
      return isPlanning && noChanges;
    },
    hint: 'Planning without producing changes. Act first, refine later.',
  },
  {
    name: 'Conservative Default',
    detect: (action: string) => {
      // Choosing safe/familiar/easy over challenging/valuable
      return /chose:.*(?:簡單|safe|familiar|容易|routine|清理|整理|housekeep)/i.test(action) &&
        /skipped:.*(?:challenge|hard|不舒服|uncomfortable|新|new|ambitious)/i.test(action);
    },
    hint: 'Chose the safe path over the valuable path.',
  },
  {
    name: 'Action as Deflection',
    detect: (action: string) => {
      // Was asked a question but did an unrelated action instead
      const wasAsked = /trigger:.*(?:room|direct-message|telegram)/i.test(action) ||
        /inbox.*(?:\?|？|問|ask)/i.test(action);
      const didUnrelatedAction = /chose:.*(?:learn|research|clean|housekeep|整理|清理|學習)/i.test(action);
      const noAnswer = !/kuro:chat|回覆|replied|回答/i.test(action);
      return wasAsked && didUnrelatedAction && noAnswer;
    },
    hint: 'Asked a question but did something else instead of answering.',
  },
  {
    name: 'Comfort Zone Retreat',
    detect: (action: string) => {
      // Repeated same-category action 3+ times (detected via recent stats)
      // This is checked differently — see trackDecisionPatterns
      return false; // placeholder, checked via stats
    },
    hint: 'Stuck in the same type of action. Try something different.',
  },
];

/**
 * Check an OODA decision trace for behavioral anti-patterns.
 * Pure function — no side effects.
 */
export function checkDecisionPatterns(action: string): CalibrationResult {
  const detected: DecisionPattern[] = [];

  for (const pattern of DECISION_PATTERNS) {
    if (pattern.detect(action)) {
      detected.push(pattern);
    }
  }

  return {
    clean: detected.length === 0,
    patterns: detected.map(p => p.name),
    hints: detected.map(p => p.hint),
  };
}

// =============================================================================
// Stats Tracking (closed-loop data)
// =============================================================================

interface MetsukeStats {
  /** Per-pattern detection count (output + decision combined) */
  detections: Record<string, number>;
  /** Total checks run */
  totalOutputChecks: number;
  totalDecisionChecks: number;
  /** Recent decision categories for Comfort Zone detection */
  recentCategories: string[];
  /** Last reset timestamp */
  lastReset: string;
}

const STATS_FILE = 'metsuke-stats.json';
const MAX_RECENT_CATEGORIES = 10;

function getStatsPath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), STATS_FILE);
}

function readStats(): MetsukeStats {
  const p = getStatsPath();
  try {
    if (!existsSync(p)) return defaultStats();
    return JSON.parse(readFileSync(p, 'utf-8')) as MetsukeStats;
  } catch {
    return defaultStats();
  }
}

function writeStats(stats: MetsukeStats): void {
  const p = getStatsPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(stats, null, 2), 'utf-8');
}

function defaultStats(): MetsukeStats {
  return {
    detections: {},
    totalOutputChecks: 0,
    totalDecisionChecks: 0,
    recentCategories: [],
    lastReset: new Date().toISOString(),
  };
}

/**
 * Track decision patterns from OODA action text.
 * Called by feedback loop every cycle. Fire-and-forget.
 */
export function trackDecisionPatterns(action: string): CalibrationResult {
  const stats = readStats();
  stats.totalDecisionChecks++;

  // Run pattern detection
  const result = checkDecisionPatterns(action);

  // Track action category for Comfort Zone detection
  const categoryMatch = action.match(/chose:.*?(?:learn|research|學習|研究|create|寫|publish|發|implement|實作|fix|修|clean|整理|housekeep|reply|回覆|chat)/i);
  if (categoryMatch) {
    const cat = categoryMatch[0].toLowerCase();
    stats.recentCategories.push(cat);
    if (stats.recentCategories.length > MAX_RECENT_CATEGORIES) {
      stats.recentCategories = stats.recentCategories.slice(-MAX_RECENT_CATEGORIES);
    }

    // Check Comfort Zone: same category 4+ times in last 6
    if (stats.recentCategories.length >= 6) {
      const last6 = stats.recentCategories.slice(-6);
      const counts = new Map<string, number>();
      for (const c of last6) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const [, count] of counts) {
        if (count >= 4) {
          result.clean = false;
          result.patterns.push('Comfort Zone Retreat');
          result.hints.push('Stuck in the same type of action. Try something different.');
          break;
        }
      }
    }
  }

  // Record detections
  for (const pattern of result.patterns) {
    stats.detections[pattern] = (stats.detections[pattern] ?? 0) + 1;
  }

  // Log if patterns detected
  if (!result.clean) {
    const names = result.patterns.join(', ');
    slog('METSUKE', `⚠️ [decision] ${names}`);
    eventBus.emit('log:behavior', {
      actor: 'metsuke',
      action: 'decision-calibration',
      detail: `detected: ${names}. action: ${action.slice(0, 120)}`,
    });
  }

  writeStats(stats);
  return result;
}

/**
 * Get current metsuke stats for coach/context injection.
 */
export function getMetsukeStats(): MetsukeStats {
  return readStats();
}

/**
 * Build context section for OODA injection.
 * Returns null if no detections yet.
 */
export function buildMetsukeContext(): string | null {
  const stats = readStats();
  const total = stats.totalDecisionChecks + stats.totalOutputChecks;
  if (total === 0) return null;

  const entries = Object.entries(stats.detections)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  const lines = entries.map(([name, count]) => `  ${name}: ${count}×`);
  return `Metsuke detections (${stats.totalDecisionChecks} decisions, ${stats.totalOutputChecks} outputs checked):\n${lines.join('\n')}`;
}
