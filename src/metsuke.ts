/**
 * Metsuke — Output Calibration Layer
 *
 * Lightweight pattern detection on outgoing messages (chat, ask, delegate).
 * Not an LLM call — pure heuristic regex matching.
 * Logs detections to behavior trail; does NOT block output.
 *
 * Design: calibration at output time, not just decision time.
 * The gap metsuke-self-check.md covers = OODA decision phase.
 * This module covers = action micro-operations (chat/ask/show/delegate).
 */

import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

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
