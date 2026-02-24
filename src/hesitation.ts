/**
 * Hesitation Signal — 確定性 Meta-Cognitive 約束
 *
 * 在 parseTags() 和 tag execution 之間的確定性猶豫點。
 * 零 API call、零 token。用正則匹配 + 計數產生 hesitation score，
 * 高分時修改行為（hold tags、加 hedge、注入反思）。
 *
 * 設計哲學：跟 L2 Router 同構 — 確定性、零成本、能中斷、能調節。
 * 這是 Ritual 約束：不過濾內容，而是轉化推理者狀態。
 *
 * Proposal: memory/proposals/2026-02-24-hesitation-signal.md
 * Issue: #58
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { slog } from './utils.js';
import type { ParsedTags } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface HesitationSignal {
  type: 'overconfidence' | 'error-pattern' | 'no-source' | 'no-hedge' | 'absolute-claim';
  detail: string;
  weight: number;
}

export interface HesitationResult {
  score: number;           // 0-100, higher = more uncertain
  confident: boolean;      // score < threshold
  signals: HesitationSignal[];
  suggestion: string;      // reflection hint for next cycle
}

export interface ErrorPattern {
  id: string;
  keywords: string[];
  description: string;
  source: 'alex-correction' | 'self-review' | 'external';
  createdAt: string;
  triggerCount: number;
}

interface HeldTag {
  type: 'chat' | 'remember' | 'task';
  data: unknown;
  hesitation: { score: number; signals: string[] };
  heldAt: string;
}

interface HesitationState {
  heldTags: HeldTag[];
  errorPatterns: ErrorPattern[];
}

// =============================================================================
// Constants
// =============================================================================

const THRESHOLD = 30;

const ABSOLUTE_TERMS_RE = /一定|不可能|顯然|毫無疑問|肯定是|clearly|obviously|definitely|impossible|certainly|undoubtedly/gi;
const SOURCE_RE = /來源|source|ref:|https?:\/\//i;
const HEDGE_RE = /我不確定|也許|可能|但我不太肯定|需要確認|我的理解是|not sure|maybe|might|I think|perhaps|arguably/i;
const CONCLUSION_RE = /所以|因此|結論|答案是|therefore|conclusion|the answer|總之|簡言之/gi;
const REASONING_RE = /因為|考慮到|另一方面|但是|however|because|on the other hand|alternatively|不過|雖然|儘管/gi;

// =============================================================================
// Core: hesitate() — Pure function, zero side effects
// =============================================================================

export function hesitate(
  response: string,
  tags: ParsedTags,
  errorPatterns: ErrorPattern[],
): HesitationResult {
  const signals: HesitationSignal[] = [];

  // Signal 1: Absolute claims without sources
  const absoluteMatches = response.match(ABSOLUTE_TERMS_RE);
  const hasSources = SOURCE_RE.test(response);
  if (absoluteMatches && !hasSources) {
    signals.push({
      type: 'absolute-claim',
      detail: `${absoluteMatches.length} absolute claim(s) without source`,
      weight: 20,
    });
  }

  // Signal 2: Matches past error patterns
  if (errorPatterns.length > 0) {
    const responseLower = response.toLowerCase();
    for (const pattern of errorPatterns) {
      if (pattern.keywords.some(kw => responseLower.includes(kw.toLowerCase()))) {
        signals.push({
          type: 'error-pattern',
          detail: `matches past error: ${pattern.description}`,
          weight: 30,
        });
        break; // only first match
      }
    }
  }

  // Signal 3: Long [CHAT] response without hedging
  if (tags.chats.length > 0) {
    const chatText = tags.chats.map(c => c.text).join(' ');
    if (!HEDGE_RE.test(chatText) && chatText.length > 200) {
      signals.push({
        type: 'no-hedge',
        detail: 'long CHAT response with no hedging language',
        weight: 15,
      });
    }
  }

  // Signal 4: More conclusions than reasoning
  const conclusionCount = (response.match(CONCLUSION_RE) || []).length;
  const reasoningCount = (response.match(REASONING_RE) || []).length;
  if (conclusionCount > 2 && reasoningCount < conclusionCount) {
    signals.push({
      type: 'overconfidence',
      detail: `${conclusionCount} conclusions vs ${reasoningCount} reasoning qualifiers`,
      weight: 15,
    });
  }

  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));

  return {
    score,
    confident: score < THRESHOLD,
    signals,
    suggestion: signals.length > 0
      ? `Hesitation (score=${score}): ${signals.map(s => s.type).join(', ')}`
      : '',
  };
}

// =============================================================================
// Behavior Modulation: applyHesitation() — Mutates tags in place
// =============================================================================

/**
 * Apply hesitation to parsed tags. Mutates tags:
 * - score >= 50: hold risky tags (chat/remember/task), schedule short review cycle
 * - score >= 30: add uncertainty markers
 *
 * Returns held tags (if any) and whether a short cycle should be scheduled.
 */
export function applyHesitation(
  tags: ParsedTags,
  hesitation: HesitationResult,
): { held: HeldTag[]; scheduleReview: boolean } {
  if (hesitation.confident) {
    return { held: [], scheduleReview: false };
  }

  const held: HeldTag[] = [];
  const now = new Date().toISOString();
  const signalNames = hesitation.signals.map(s => s.type);

  // ── [CHAT] ──
  if (tags.chats.length > 0) {
    if (hesitation.score >= 50) {
      // High uncertainty: hold all chats
      for (const chat of tags.chats) {
        held.push({ type: 'chat', data: chat, hesitation: { score: hesitation.score, signals: signalNames }, heldAt: now });
      }
      tags.chats = [];
    } else {
      // Medium uncertainty: append hedge
      for (const chat of tags.chats) {
        chat.text += '\n\n（⚠️ 我對這個回答不太確定，可能需要更多思考）';
      }
    }
  }

  // ── [REMEMBER] — more dangerous than CHAT (silent long-term corruption) ──
  if (tags.remembers.length > 0) {
    if (hesitation.score >= 50) {
      for (const rem of tags.remembers) {
        held.push({ type: 'remember', data: rem, hesitation: { score: hesitation.score, signals: signalNames }, heldAt: now });
      }
      tags.remembers = [];
    } else {
      for (const rem of tags.remembers) {
        rem.content = `⚠️ [hesitation score=${hesitation.score}] ${rem.content}`;
      }
    }
  }

  // ── [TASK] ──
  if (tags.tasks.length > 0) {
    if (hesitation.score >= 50) {
      for (const task of tags.tasks) {
        held.push({ type: 'task', data: task, hesitation: { score: hesitation.score, signals: signalNames }, heldAt: now });
      }
      tags.tasks = [];
    } else {
      for (const task of tags.tasks) {
        task.content = `[needs-review] ${task.content}`;
      }
    }
  }

  // ── [ASK] — asking IS hesitating, no modulation needed ──
  // ── [ACTION] — append hesitation info to decision trace ──
  // (handled by caller via hesitation.suggestion in action log)

  return { held, scheduleReview: held.length > 0 };
}

// =============================================================================
// State Management
// =============================================================================

function getStatePath(): string {
  try {
    return path.join(getInstanceDir(getCurrentInstanceId()), 'hesitation-state.json');
  } catch {
    return '';
  }
}

function getLogPath(): string {
  try {
    return path.join(getInstanceDir(getCurrentInstanceId()), 'hesitation-log.jsonl');
  } catch {
    return '';
  }
}

function loadState(): HesitationState {
  const p = getStatePath();
  if (!p) return { heldTags: [], errorPatterns: [] };
  try {
    if (!existsSync(p)) return { heldTags: [], errorPatterns: [] };
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return { heldTags: [], errorPatterns: [] };
  }
}

function saveState(state: HesitationState): void {
  const p = getStatePath();
  if (!p) return;
  try {
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  } catch { /* best effort */ }
}

// =============================================================================
// Public API
// =============================================================================

/** Load error patterns from state file */
export function loadErrorPatterns(): ErrorPattern[] {
  return loadState().errorPatterns;
}

/** Save held tags for review in next cycle */
export function saveHeldTags(held: HeldTag[]): void {
  if (held.length === 0) return;
  const state = loadState();
  state.heldTags = held; // replace, not append — only latest hold matters
  saveState(state);
  slog('HESITATION', `Held ${held.length} tag(s) for review: ${held.map(h => h.type).join(', ')}`);
}

/** Get and clear held tags (for next cycle to review) */
export function drainHeldTags(): HeldTag[] {
  const state = loadState();
  if (state.heldTags.length === 0) return [];
  const held = state.heldTags;
  state.heldTags = [];
  saveState(state);
  return held;
}

/** Build review prompt for held tags */
export function buildHeldTagsPrompt(held: HeldTag[]): string {
  if (held.length === 0) return '';

  const lines = ['## ⚠️ Hesitation Review — 上個 cycle 猶豫後 hold 的內容', ''];
  lines.push('以下內容因 hesitation score 過高被暫緩。請重新審視後決定：');
  lines.push('- 確認正確 → 重新輸出相同 tag');
  lines.push('- 發現問題 → 修改後輸出，或放棄');
  lines.push('');

  for (const h of held) {
    const signals = h.hesitation.signals.join(', ');
    lines.push(`### Held [${h.type.toUpperCase()}] (score=${h.hesitation.score}, signals: ${signals})`);
    if (h.type === 'chat') {
      const chat = h.data as { text: string; reply: boolean };
      lines.push('```');
      lines.push(chat.text.slice(0, 500));
      lines.push('```');
    } else if (h.type === 'remember') {
      const rem = h.data as { content: string; topic?: string };
      lines.push(`Topic: ${rem.topic ?? 'MEMORY.md'}`);
      lines.push('```');
      lines.push(rem.content.slice(0, 500));
      lines.push('```');
    } else if (h.type === 'task') {
      const task = h.data as { content: string };
      lines.push('```');
      lines.push(task.content.slice(0, 500));
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Log hesitation event for audit trail */
export function logHesitation(
  hesitation: HesitationResult,
  action: string,
  cycleCount: number,
): void {
  const p = getLogPath();
  if (!p) return;
  try {
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      score: hesitation.score,
      signals: hesitation.signals.map(s => s.type),
      action,
      cycleId: cycleCount,
    });
    appendFileSync(p, entry + '\n');
  } catch { /* best effort */ }
}

/** Add a new error pattern (Phase 2 — called when corrections detected) */
export function addErrorPattern(pattern: Omit<ErrorPattern, 'id' | 'triggerCount' | 'createdAt'>): void {
  const state = loadState();
  const id = `ep-${Date.now()}`;
  state.errorPatterns.push({
    ...pattern,
    id,
    createdAt: new Date().toISOString(),
    triggerCount: 0,
  });
  // Keep max 50 patterns
  if (state.errorPatterns.length > 50) {
    state.errorPatterns = state.errorPatterns.slice(-50);
  }
  saveState(state);
  slog('HESITATION', `New error pattern: ${pattern.description}`);
}
